import {
  fetchAuthSession,
  loginUser,
  registerUser,
  logoutUser,
} from "../lobby/lobbyNet.js";
import { createLobbyController } from "../lobby/controller.js";
import {
  createMatchmakingController,
  waitForMatchStart,
} from "../matchmaking/controller.js";
import { fetchMatchmakingStatus } from "../lobby/lobbyNet.js";
import { confirmApp } from "../ui/appConfirm.js";
import {
  parseRoute,
  syncRoute,
  shouldPushHistory,
  isGameId,
  isHomePath,
  gameIdFromRoute,
} from "../../shared/lib/routes.js";
import { clearSelectedGameId } from "../../../app/games.js";
import { createNotificationCenter } from "../../shared/ui/notifications.js";
import { assertShellMatchesExpectedGame } from "../../shared/lib/shellIntegrity.js";
import { safeText } from "../../shared/lib/utils.js";
import { postNewGame } from "../gameplay/controller.js";
import type { GameType } from "../../shared/contracts.js";
import {
  appScreen,
  clearLastScreen,
  readLastScreen,
  readSavedGameMode,
  writeLastScreen,
  type AppScreen,
} from "./shellSession.js";
import {
  createGameSetupOverlay,
  resolveOfflineOpponentAvatar,
  type SetupScreenConfig,
} from "./shellSetup.js";
import { bindEnter, createAuthForm } from "./shellAuthForm.js";
import { bindShellGameChrome } from "./shellGameChrome.js";

interface ShellUser {
  id?: string;
  username?: string;
  photo_url?: string | null;
}

interface ShellOfflinePlayConfig {
  setupTitle: string;
  opponentName: string;
  opponentAvatar?: string | null;
  statusText: string;
}

interface GameShellConfig {
  gameId: GameType;
  uiPrefix: string;
  lastScreenKey: string;
  offlineMode: string;
  offlinePlayButtonId: string;
  arenaLayoutEvent: string;
  offlinePlay: ShellOfflinePlayConfig;
  pvpSetupStatus: string;
  inviteSetupStatus: string;
  matchFoundStatus: string;
  activeGameOfflineMessage: string;
  activeGamePvpMessage: string;
  activeGameEndButtonLabel: string;
  activeGameForfeitButtonLabel: string;
  arenaNewGameTitle: string;
}

interface GameplayControllerFactoryDeps {
  notify: (message: string, isError?: boolean) => void;
  getUser: () => ShellUser | null;
  confirmDialog: (message: string, options: { title?: string }) => Promise<boolean>;
  onBackToLobby: () => void;
  onGameNotFound: () => void;
}

interface ShellAuthDeps {
  shell: GameShellConfig;
  createGameplayController(deps: GameplayControllerFactoryDeps): GameplayController;
}

interface GameplayController {
  init(): void;
  onEnter(options?: ScreenOptions): Promise<void>;
  onExit(): void;
  setUser(user: ShellUser | null): void;
  reset(): void;
  startMode(
    mode: string,
    onReady?: (() => void) | null,
    suppressLoadingOverlay?: boolean,
    options?: { forceFresh?: boolean },
  ): Promise<void>;
  refreshProfileAvatars(): Promise<void>;
  ensureSurrenderIfActive(): Promise<boolean>;
  getCurrentMode(): string;
}

interface SubController {
  init(): void;
  onEnter(): void | Promise<void>;
  onExit(): void;
  setUser(user: ShellUser | null): void;
  reset(): void;
}

interface MatchmakingController extends SubController {
  cancelQueue(notify?: boolean): Promise<void>;
}

interface LobbyController extends SubController {}

interface MatchPayload {
  match_id?: string;
}

interface RejoinPayload {
  gameId?: string;
  mode?: string;
}

interface ScreenOptions {
  game_id?: string;
  mode?: string;
  onReady?: () => void;
  skipGameLoadingOverlay?: boolean;
  pushRoute?: boolean;
  persist?: boolean;
}

interface InitialScreenOptions extends ScreenOptions {
  pushRoute: boolean;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function textInput(id: string): HTMLInputElement | null {
  return document.getElementById(id) as HTMLInputElement | null;
}

function button(id: string): HTMLButtonElement | null {
  return document.getElementById(id) as HTMLButtonElement | null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function inviteCodeFromUrl(): string {
  return parseRoute().invite || "";
}

function hubAuthUrl(invite = inviteCodeFromUrl()): string {
  return invite ? `/?invite=${encodeURIComponent(invite)}` : "/";
}

function redirectToHubAuth(invite = inviteCodeFromUrl()): void {
  window.location.assign(hubAuthUrl(invite));
}

export function createShellAuthController(deps: ShellAuthDeps): { init(): Promise<void> } {
  const {
    shell,
    createGameplayController,
  } = deps;
  const lastScreenKey = shell.lastScreenKey;
  const offlineMode = shell.offlineMode;
  // DOM references
  const refs = {
    notificationStack: byId("notification-stack"),
    homeScreen: byId("home-screen"),
    lobbyScreen: byId("lobby-screen"),
    notFoundScreen: byId("not-found-screen"),
    matchmakingScreen: byId("matchmaking-screen"),
    gameApp: byId("game-app"),
    homeBackButton: byId("home-back-btn"),
    modeSigninButton: button("auth-mode-signin-btn"),
    modeSignupButton: button("auth-mode-signup-btn"),
    loginCard: byId("auth-login-card"),
    registerCard: byId("auth-register-card"),
    loginUsernameInput: textInput("auth-login-username-input"),
    loginPasswordInput: textInput("auth-login-password-input"),
    loginPasswordToggle: button("auth-login-password-toggle-btn"),
    loginButton: button("auth-login-btn"),
    registerUsernameInput: textInput("auth-register-username-input"),
    registerPasswordInput: textInput("auth-register-password-input"),
    registerPasswordToggle: button("auth-register-password-toggle-btn"),
    registerPhotoInput: textInput("auth-register-photo-input"),
    registerButton: button("auth-register-btn"),
    gameBackLobbyBtn: button("game-back-lobby-btn"),
    gameRefreshBtn: button("refresh-btn"),
    gameNewGameBtn: button("new-game-btn"),
    gameOverCloseBtn: button("game-over-close-btn"),
    gameOverLobbyBtn: button("game-over-lobby-btn"),
    gameOverNewGameBtn: button("game-over-new-game-btn"),
    lobbyBackMenuBtn: button("lobby-back-menu-btn"),
  };

  let currentUser: ShellUser | null = null;
  /** Last screen passed to ``showScreen`` (used to avoid dismissing the global loader too early for lobby/MM). */
  let activeAppScreen: AppScreen = "home";
  let routingFromPopstate = false;
  const notifier = createNotificationCenter(refs.notificationStack, { maxVisible: 4, duration: 3200 });

  /** Chezz VS Engine: engine photo from app_users; Pool pass-and-play uses shell default. */
  const setupOverlay = createGameSetupOverlay(shell);
  const authForm = createAuthForm({
    loginCard: refs.loginCard,
    loginPasswordInput: refs.loginPasswordInput,
    loginPasswordToggle: refs.loginPasswordToggle,
    modeSigninButton: refs.modeSigninButton,
    modeSignupButton: refs.modeSignupButton,
    registerCard: refs.registerCard,
    registerPasswordInput: refs.registerPasswordInput,
    registerPasswordToggle: refs.registerPasswordToggle,
  });

  function showGameSetup(config: SetupScreenConfig): () => void {
    return setupOverlay.show(config);
  }

  // sub-controllers
  // each receives callbacks so it can trigger cross-screen transitions
  // (e.g. matchmaking.onMatched -> show game screen) without knowing about
  // the auth controller directly.
  const gameplay = createGameplayController({
    notify: (message: string, isError = false) => notify(message, isError),
    getUser: () => currentUser,
    onBackToLobby: () => {
      showScreen("lobby", { pushRoute: true });
    },
    onGameNotFound: () => {
      try {
        window.sessionStorage.removeItem(lastScreenKey);
      } catch {
        /* noop */
      }
      gameplay.onExit();
      activeAppScreen = "notFound";
      syncRoute("notFound", { push: false });
      void showScreen("notFound", { pushRoute: false });
    },
    confirmDialog: (message: string, opts: { title?: string }) => confirmApp(message, opts || {}),
  });
  const matchmaking = createMatchmakingController({
    notify: (message: string, isError = false) => notify(message, isError),
    getUser: () => currentUser,
    onCancel: () => {
      showScreen("lobby", { pushRoute: true });
    },
    onMatched: async (matchedPayload: MatchPayload) => {
      try {
        const body = await postNewGame("pvp", offlineMode, {
          match_id: matchedPayload?.match_id,
        });
        const id = String(body?.game_id || matchedPayload?.match_id || "").trim();
        if (!isGameId(id)) {
          throw new Error("Server did not return a game id.");
        }
        showScreen("game", {
          mode: "pvp",
          game_id: id,
          pushRoute: true,
        });
      } catch (err) {
        notify(errorMessage(err, "Could not start matched game."), true);
        showScreen("lobby", { pushRoute: true });
      }
    },
  }) as MatchmakingController;
  const lobby = createLobbyController({
    notify: (message: string, isError = false) => notify(message, isError),
    getUser: () => currentUser,
    onRejoinGame: async ({ gameId, mode }: RejoinPayload = {}) => {
      const id = String(gameId || "").trim();
      if (!isGameId(id)) {
        notify("No game to rejoin.", true);
        return;
      }
      const resolvedMode = mode === offlineMode ? offlineMode : "pvp";
      try {
        await showScreen("game", {
          mode: resolvedMode,
          game_id: id,
          pushRoute: true,
        });
      } catch (err) {
        console.error(`[${shell.gameId}/auth] rejoin failed:`, err);
        notify(errorMessage(err, "Could not rejoin game."), true);
        await showScreen("lobby", { pushRoute: false });
      }
    },
    onInviteMatched: async (matchedPayload: MatchPayload) => {
      try {
        const payload =
          (await waitForMatchStart(matchedPayload, fetchMatchmakingStatus)) || matchedPayload;
        const body = await postNewGame("pvp", offlineMode, {
          match_id: payload?.match_id,
        });
        const id = String(body?.game_id || payload?.match_id || "").trim();
        if (!isGameId(id)) {
          throw new Error("Server did not return a game id.");
        }
        showScreen("game", {
          mode: "pvp",
          game_id: id,
          pushRoute: true,
        });
      } catch (err) {
        notify(errorMessage(err, "Could not start invited game."), true);
        showScreen("lobby", { pushRoute: true });
      }
    },
    onPlayOffline: async () => {
      const user = currentUser;
      const opponentAvatar = await resolveOfflineOpponentAvatar(shell);
      const dismiss = showGameSetup({
        title: shell.offlinePlay.setupTitle,
        selfName: user?.username,
        selfAvatar: user?.photo_url,
        opponentName: shell.offlinePlay.opponentName,
        opponentAvatar,
        statusText: shell.offlinePlay.statusText,
      });
      showScreen("game", { mode: offlineMode, onReady: dismiss, skipGameLoadingOverlay: true, pushRoute: true });
    },
    onPlayOnline: () => {
      showScreen("matchmaking", { pushRoute: true });
    },
    offlinePlayButtonId: shell.offlinePlayButtonId,
    offlineMode,
    activeGameOfflineMessage: shell.activeGameOfflineMessage,
    activeGamePvpMessage: shell.activeGamePvpMessage,
    activeGameEndButtonLabel: shell.activeGameEndButtonLabel,
    activeGameForfeitButtonLabel: shell.activeGameForfeitButtonLabel,
    uiPrefix: shell.uiPrefix,
  }) as LobbyController;

  // screen routing

  /** Toggle visibility of the four screens and notify the entering/exiting
   * sub-controllers so they can start/stop polling, animations, etc. */
  async function showScreen(name: AppScreen, options: ScreenOptions = {}): Promise<void> {
    if (name === "home") {
      redirectToHubAuth(inviteCodeFromUrl());
      return;
    }
    if (!currentUser && name !== "notFound") {
      name = "home";
      redirectToHubAuth(inviteCodeFromUrl());
      return;
    }
    const prevScreen = activeAppScreen;
    activeAppScreen = name;
    const historyPush = !routingFromPopstate && shouldPushHistory(prevScreen, name, options);
    const loader = document.getElementById("app-loading-screen");
    const deferGlobalLoaderFade = name === "lobby" || name === "matchmaking" || name === "notFound";
    if (loader) {
      if (deferGlobalLoaderFade) {
        loader.classList.remove("fade-out");
      } else if (name === "game" && !options?.skipGameLoadingOverlay) {
        // when skipGameLoadingOverlay is set the "Opponent Found" / VS overlay
        // is already on screen acting as a loading indicator - don't cover it
        // with the global loader.
        loader.classList.remove("fade-out");
      }
    }

    const shouldPersist = options?.persist !== false;
    if (name !== "game") {
      setupOverlay.hide();
    }

    refs.homeScreen?.classList.add("hidden");
    refs.lobbyScreen?.classList.toggle("hidden", name !== "lobby");
    refs.notFoundScreen?.classList.toggle("hidden", name !== "notFound");
    const notFoundBtn = byId("not-found-lobby-btn");
    if (notFoundBtn) {
      notFoundBtn.textContent = currentUser ? "Back to lobby" : "Back to sign in";
    }
    refs.matchmakingScreen?.classList.toggle("hidden", name !== "matchmaking");
    refs.gameApp?.classList.toggle("hidden", name !== "game");
    if (name === "lobby") {
      void lobby.onEnter();
    } else {
      lobby.onExit();
    }
    if (name === "matchmaking") {
      void matchmaking.onEnter();
    } else {
      matchmaking.onExit();
    }
    if (name === "game") {
      try {
        await gameplay.onEnter(options);
      } catch (err) {
        console.error(`[${shell.gameId}/auth] gameplay.onEnter failed:`, err);
        throw err;
      } finally {
        loader?.classList.add("fade-out");
        const layoutPass = () => {
          window.dispatchEvent(new CustomEvent(shell.arenaLayoutEvent));
        };
        queueMicrotask(layoutPass);
        requestAnimationFrame(layoutPass);
      }
    } else {
      gameplay.onExit();
    }

    // persist only authenticated app screens so reload can restore them.
    if (shouldPersist && currentUser) {
      writeLastScreen(name, lastScreenKey);
    }

    if (name === "notFound") {
      syncRoute("notFound", { push: historyPush });
      return;
    }
    if (!currentUser) {
      return;
    }

    if (name === "game") {
      // onenter may redirect to /404 (missing game); do not overwrite that URL.
      if (activeAppScreen !== "game") {
        return;
      }
      const explicitId = safeText(options?.game_id, "");
      const routedId = gameIdFromRoute();
      const gameId = isGameId(explicitId) ? explicitId : (isGameId(routedId) ? routedId : "");
      if (isGameId(gameId)) {
        syncRoute("game", { gameId, gameType: shell.gameId, push: historyPush });
      }
      return;
    }

    syncRoute(name, {
      invite: name === "lobby" ? inviteCodeFromUrl() : null,
      gameType: shell.gameId,
      push: historyPush,
    });
  }

  /** Push a toast notification. Empty messages are silently ignored. */


  function notify(message: unknown, isError = false): void {
    const text = safeText(message, "");
    if (!text) {
      return;
    }
    notifier.push(text, { kind: isError ? "error" : "info" });
  }

  /** Propagate the user object to all sub-controllers at once. */


  function applyUser(user: ShellUser | null): void {
    currentUser = user || null;
    lobby.setUser(currentUser);
    gameplay.setUser(currentUser);
    matchmaking.setUser(currentUser);
  }

  // auth actions

  /** Validate inputs and POST to the login endpoint, then navigate to lobby. */
  async function login(): Promise<void> {
    const username = safeText(refs.loginUsernameInput?.value, "");
    const password = String(refs.loginPasswordInput?.value || "");
    if (!username || !password) {
      const message = "Username and password are required.";
      notify(message, true);
      return;
    }
    if (refs.loginButton) {
      refs.loginButton.disabled = true;
    }
    try {
      const result = await loginUser(username, password);
      applyUser(result.user ?? null);
      authForm.clearInputs();
      notify(`Welcome ${safeText(result?.user?.username, "Player")}.`);
      showScreen("lobby");
    } catch (error) {
      notify(errorMessage(error, "Login failed."), true);
      redirectToHubAuth();
    } finally {
      if (refs.loginButton) {
        refs.loginButton.disabled = false;
      }
    }
  }

  /** Validate inputs and POST to the registration endpoint, then navigate to lobby. */
  async function register(): Promise<void> {
    const username = safeText(refs.registerUsernameInput?.value, "");
    const password = String(refs.registerPasswordInput?.value || "");
    const photoUrl = safeText(refs.registerPhotoInput?.value, "");
    if (!username || !password) {
      const message = "Username and password are required.";
      notify(message, true);
      return;
    }
    if (refs.registerButton) {
      refs.registerButton.disabled = true;
    }
    try {
      const result = await registerUser(username, password, photoUrl || null);
      applyUser(result.user ?? null);
      authForm.clearInputs();
      notify(`Account created. Welcome ${safeText(result?.user?.username, "Player")}.`);
      showScreen("lobby");
    } catch (error) {
      notify(errorMessage(error, "Registration failed."), true);
      redirectToHubAuth();
    } finally {
      if (refs.registerButton) {
        refs.registerButton.disabled = false;
      }
    }
  }

  /** Full sign-out: cancel any active matchmaking queue, hit the logout API,
   * wipe local state across all sub-controllers, and return to the home screen. */
  async function signOut(): Promise<void> {
    try {
      await matchmaking.cancelQueue(false);
    } catch {
      // no-op
    }
    try {
      await logoutUser();
    } catch {
      // no-op
    }
    currentUser = null;
    applyUser(null);
    lobby.reset();
    matchmaking.reset();
    gameplay.reset();
    clearLastScreen(lastScreenKey);
    clearSelectedGameId();
    authForm.clearInputs();
    notify("Signed out.");
    window.location.assign("/");
  }

  // event binding helpers

  /** Attach all one-time click and keyboard listeners. */


  function bindEvents(): void {
    refs.homeBackButton?.addEventListener("click", () => {
      window.location.assign("/menu");
    });
    refs.lobbyBackMenuBtn?.addEventListener("click", () => {
      window.location.assign("/menu");
    });
    refs.modeSigninButton?.addEventListener("click", () => authForm.applyMode("signin"));
    refs.modeSignupButton?.addEventListener("click", () => authForm.applyMode("signup"));
    refs.loginButton?.addEventListener("click", () => {
      void login();
    });
    refs.registerButton?.addEventListener("click", () => {
      void register();
    });

    authForm.bindPasswordToggles();

    bindEnter(refs.loginUsernameInput, login);
    bindEnter(refs.loginPasswordInput, login);
    bindEnter(refs.registerUsernameInput, register);
    bindEnter(refs.registerPasswordInput, register);
    bindEnter(refs.registerPhotoInput, register);

    bindShellGameChrome({
      shell,
      refs,
      gameplay,
      getUser: () => currentUser,
      notify,
      showGameSetup,
      showScreen,
    });
    byId("not-found-lobby-btn")?.addEventListener("click", () => {
      if (currentUser) {
        showScreen("lobby", { pushRoute: true });
        return;
      }
      redirectToHubAuth();
    });
  }

  // bootstrap

  /** Application entry point. Binds events, initialises sub-controllers,
   * attempts to restore an existing session cookie, and routes to the
   * appropriate screen. */
  async function init(): Promise<void> {
    const loader = document.getElementById("app-loading-screen");
    const dismissLoader = () => {
      document.body.classList.remove("booting");
      loader?.classList.add("fade-out");
    };
    const loaderGuard = window.setTimeout(() => {
      console.warn(`[${shell.gameId}/auth] boot took too long — dismissing loading screen`);
      dismissLoader();
    }, 60000);

    try {
      if (!assertShellMatchesExpectedGame(shell.gameId)) {
        return;
      }
      bindEvents();
      lobby.init();
      matchmaking.init();
      gameplay.init();
      authForm.applyMode("signin");

      window.addEventListener("popstate", (event) => {
        routingFromPopstate = true;
        const hist = event.state && typeof event.state === "object" ? event.state : {};
        const route = parseRoute();
        const screen = safeText(hist.screen, "") || route.screen;

        if (!currentUser) {
          if (screen === "notFound" || route.screen === "notFound") {
            syncRoute("notFound", { push: false });
            void showScreen("notFound", { persist: false, pushRoute: false });
          } else {
            redirectToHubAuth(route.invite || inviteCodeFromUrl());
          }
          routingFromPopstate = false;
          return;
        }

        if (screen === "game" && isGameId(hist.gameId || route.gameId)) {
          void showScreen("game", {
            game_id: hist.gameId || route.gameId,
            persist: false,
            pushRoute: false,
          });
        } else if (screen === "lobby" || screen === "matchmaking" || screen === "notFound") {
          void showScreen(screen, { persist: false, pushRoute: false });
        } else if (route.screen === "lobby" || route.screen === "matchmaking" || route.screen === "notFound") {
          void showScreen(route.screen, { persist: false, pushRoute: false });
        } else if (route.screen === "game" && route.gameId) {
          void showScreen("game", { game_id: route.gameId, persist: false, pushRoute: false });
        } else {
          syncRoute("notFound", { push: false });
          void showScreen("notFound", { persist: false, pushRoute: false });
        }
        routingFromPopstate = false;
      });

      const route = parseRoute();
      const inviteCode = inviteCodeFromUrl();
      try {
        const session = await fetchAuthSession();
        if (session?.authenticated && session.user) {
          applyUser(session.user);
          notify(`Welcome back ${safeText(session.user?.username, "Player")}.`);
          let restoredScreen: AppScreen = inviteCode
            ? "lobby"
            : appScreen(route.screen, readLastScreen(lastScreenKey));
          const screenOptions: InitialScreenOptions = { pushRoute: false };
          if (route.screen === "notFound") {
            restoredScreen = "notFound";
            syncRoute("notFound", { push: false });
          } else if (route.screen === "game" && route.gameId) {
            restoredScreen = "game";
            screenOptions.game_id = route.gameId;
            const savedMode = readSavedGameMode(shell.gameId, route.gameId);
            if (savedMode === "pvp" || savedMode === offlineMode) {
              screenOptions.mode = savedMode;
            }
          } else if (route.screen === "lobby" || route.screen === "matchmaking") {
            restoredScreen = route.screen;
          }
          await showScreen(restoredScreen, screenOptions);
          if (inviteCode) {
            notify("Invite link detected. Joining match...");
          }
        } else if (route.screen === "notFound") {
          syncRoute("notFound", { push: false });
          showScreen("notFound", { persist: false, pushRoute: false });
        } else if (inviteCode) {
          redirectToHubAuth(inviteCode);
        } else {
          redirectToHubAuth();
        }
      } catch {
        notify("Could not restore session.", true);
        redirectToHubAuth();
      }
    } catch (err) {
      console.error(`[${shell.gameId}/auth] init failed:`, err);
    } finally {
      window.clearTimeout(loaderGuard);
      dismissLoader();
    }
  }

  return { init };
}
