import {
  fetchAuthSession,
  loginUser,
  registerUser,
  logoutUser,
} from "../features/lobby/lobbyNet.js";
import { createProfileEditor } from "../features/lobby/profileEditor.js";
import {
  parseRoute,
  syncRoute,
  isHomePath,
  isMenuPath,
} from "../shared/lib/routes.js";
import { createNotificationCenter } from "../shared/ui/notifications.js";
import { safeText } from "../shared/lib/utils.js";
import {
  GAMES,
  gameIdFromRouteQuery,
  getSelectedGameId,
  lobbyUrlForGame,
  setSelectedGameId,
  clearSelectedGameId,
  stashPendingInviteCode,
  takePendingInviteCode,
} from "../../app/games.js";
import type { GameType } from "../shared/contracts.js";

type AuthMode = "signin" | "signup";
type HubScreen = "home" | "menu";
type ParsedRoute = ReturnType<typeof parseRoute>;

interface HubUser {
  id?: string;
  username?: string;
  photo_url?: string | null;
}

interface AuthPayload {
  authenticated?: boolean;
  user?: HubUser | null;
}

interface UserPayload {
  user?: HubUser | null;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function input(id: string): HTMLInputElement | null {
  return document.getElementById(id) as HTMLInputElement | null;
}

function image(id: string): HTMLImageElement | null {
  return document.getElementById(id) as HTMLImageElement | null;
}

function button(id: string): HTMLButtonElement | null {
  return document.getElementById(id) as HTMLButtonElement | null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isGameType(value: string): value is GameType {
  return value in GAMES;
}

export async function initHub(): Promise<void> {
  const refs = {
    homeScreen: byId("home-screen"),
    menuScreen: byId("game-menu-screen"),
    loader: byId("app-loading-screen"),
    notificationStack: byId("notification-stack"),
    homeBackButton: button("home-back-btn"),
    modeSigninButton: button("auth-mode-signin-btn"),
    modeSignupButton: button("auth-mode-signup-btn"),
    loginCard: byId("auth-login-card"),
    registerCard: byId("auth-register-card"),
    loginUsernameInput: input("auth-login-username-input"),
    loginPasswordInput: input("auth-login-password-input"),
    loginPasswordToggle: button("auth-login-password-toggle-btn"),
    loginButton: button("auth-login-btn"),
    registerUsernameInput: input("auth-register-username-input"),
    registerPasswordInput: input("auth-register-password-input"),
    registerPasswordToggle: button("auth-register-password-toggle-btn"),
    registerPhotoInput: input("auth-register-photo-input"),
    registerButton: button("auth-register-btn"),
    menuPoolBtn: button("game-menu-pool-btn"),
    menuChezzBtn: button("game-menu-chezz-btn"),
    menuSignOutBtn: button("game-menu-signout-btn"),
    menuUserName: byId("game-menu-user-name"),
    menuUserAvatar: image("game-menu-user-avatar"),
    menuUsernameInput: input("game-menu-settings-username-input"),
    menuPhotoInput: input("game-menu-settings-photo-input"),
    menuSaveButton: button("game-menu-settings-save-btn"),
  };

  let currentUser: HubUser | null = null;
  let currentMode: AuthMode = "signin";
  let activeScreen: HubScreen = "home";
  const notifier = createNotificationCenter(refs.notificationStack, { maxVisible: 4, duration: 3200 });

  function notify(message: unknown, isError = false): void {
    const text = safeText(message, "");
    if (!text) {
      return;
    }
    notifier.push(text, { kind: isError ? "error" : "info" });
  }

  const profile = createProfileEditor({
    refs: {
      userName: refs.menuUserName,
      userAvatar: refs.menuUserAvatar,
      usernameInput: refs.menuUsernameInput,
      photoInput: refs.menuPhotoInput,
      saveButton: refs.menuSaveButton,
    },
    notify,
    getUser: () => currentUser,
    onUserUpdated: (user: HubUser | null) => {
      currentUser = user || null;
    },
  });
  profile.bindEvents();

  function applyAuthMode(mode: AuthMode): void {
    currentMode = mode === "signup" ? "signup" : "signin";
    const signin = currentMode === "signin";
    refs.modeSigninButton?.classList.toggle("is-active", signin);
    refs.modeSignupButton?.classList.toggle("is-active", !signin);
    refs.loginCard?.classList.toggle("hidden", !signin);
    refs.registerCard?.classList.toggle("hidden", signin);
  }

  function syncPasswordToggle(
    toggleButton: HTMLButtonElement | null,
    passwordInput: HTMLInputElement | null,
  ): void {
    if (!toggleButton || !passwordInput) {
      return;
    }
    const hidden = passwordInput.type === "password";
    toggleButton.classList.toggle("is-hidden", hidden);
    toggleButton.classList.toggle("is-visible", !hidden);
  }

  function bindPasswordToggle(
    toggleButton: HTMLButtonElement | null,
    passwordInput: HTMLInputElement | null,
  ): void {
    if (!toggleButton || !passwordInput) {
      return;
    }
    toggleButton.addEventListener("click", () => {
      passwordInput.type = passwordInput.type === "password" ? "text" : "password";
      syncPasswordToggle(toggleButton, passwordInput);
    });
    syncPasswordToggle(toggleButton, passwordInput);
  }

  function clearAuthInputs(): void {
    if (refs.loginPasswordInput) {
      refs.loginPasswordInput.value = "";
      refs.loginPasswordInput.type = "password";
    }
    if (refs.registerPasswordInput) {
      refs.registerPasswordInput.value = "";
      refs.registerPasswordInput.type = "password";
    }
    syncPasswordToggle(refs.loginPasswordToggle, refs.loginPasswordInput);
    syncPasswordToggle(refs.registerPasswordToggle, refs.registerPasswordInput);
  }

  function showScreen(name: HubScreen): void {
    activeScreen = name;
    refs.homeScreen?.classList.toggle("hidden", name !== "home");
    refs.menuScreen?.classList.toggle("hidden", name !== "menu");
    if (name === "home") {
      syncRoute("home", { push: false });
    } else if (name === "menu") {
      syncRoute("menu", { push: false });
      profile.renderUser(currentUser);
    }
  }

  function goToGameLobby(gameId: GameType): void {
    const id = String(gameId || "").trim().toLowerCase();
    if (!isGameType(id)) {
      return;
    }
    setSelectedGameId(id);
    const route = parseRoute();
    const invite = route.invite || takePendingInviteCode();
    window.location.assign(lobbyUrlForGame(id, invite));
  }

  function redirectInviteToGameLobby(route: ParsedRoute, inviteCode: string): boolean {
    const game = route.gameType || gameIdFromRouteQuery() || getSelectedGameId();
    if (!game || !isGameType(game)) {
      return false;
    }
    window.location.assign(lobbyUrlForGame(game, inviteCode));
    return true;
  }

  async function login(): Promise<void> {
    const username = safeText(refs.loginUsernameInput?.value, "");
    const password = String(refs.loginPasswordInput?.value || "");
    if (!username || !password) {
      notify("Username and password are required.", true);
      return;
    }
    if (refs.loginButton) {
      refs.loginButton.disabled = true;
    }
    try {
      const result = await loginUser(username, password) as UserPayload;
      currentUser = result.user || null;
      clearAuthInputs();
      notify(`Welcome ${safeText(currentUser?.username, "Player")}.`);
      const pending = takePendingInviteCode();
      if (pending && redirectInviteToGameLobby(parseRoute(), pending)) {
        return;
      }
      showScreen("menu");
    } catch (error) {
      notify(errorMessage(error, "Login failed."), true);
      showScreen("home");
    } finally {
      if (refs.loginButton) {
        refs.loginButton.disabled = false;
      }
    }
  }

  async function register(): Promise<void> {
    const username = safeText(refs.registerUsernameInput?.value, "");
    const password = String(refs.registerPasswordInput?.value || "");
    const photoUrl = safeText(refs.registerPhotoInput?.value, "");
    if (!username || !password) {
      notify("Username and password are required.", true);
      return;
    }
    if (refs.registerButton) {
      refs.registerButton.disabled = true;
    }
    try {
      const result = await registerUser(username, password, photoUrl || null) as UserPayload;
      currentUser = result.user || null;
      clearAuthInputs();
      notify(`Account created. Welcome ${safeText(currentUser?.username, "Player")}.`);
      const pending = takePendingInviteCode();
      if (pending && redirectInviteToGameLobby(parseRoute(), pending)) {
        return;
      }
      showScreen("menu");
    } catch (error) {
      notify(errorMessage(error, "Registration failed."), true);
      showScreen("home");
    } finally {
      if (refs.registerButton) {
        refs.registerButton.disabled = false;
      }
    }
  }

  async function signOut(): Promise<void> {
    try {
      await logoutUser();
    } catch {
      /* noop */
    }
    currentUser = null;
    clearSelectedGameId();
    clearAuthInputs();
    profile.reset();
    notify("Signed out.");
    showScreen("home");
    window.location.assign("/");
  }

  refs.homeBackButton?.classList.add("hidden");
  refs.modeSigninButton?.addEventListener("click", () => applyAuthMode("signin"));
  refs.modeSignupButton?.addEventListener("click", () => applyAuthMode("signup"));
  refs.loginButton?.addEventListener("click", () => { void login(); });
  refs.registerButton?.addEventListener("click", () => { void register(); });
  bindPasswordToggle(refs.loginPasswordToggle, refs.loginPasswordInput);
  bindPasswordToggle(refs.registerPasswordToggle, refs.registerPasswordInput);
  refs.menuPoolBtn?.addEventListener("click", () => goToGameLobby("pool"));
  refs.menuChezzBtn?.addEventListener("click", () => goToGameLobby("chezz"));
  refs.menuSignOutBtn?.addEventListener("click", () => { void signOut(); });

  applyAuthMode("signin");
  showScreen("home");

  const route = parseRoute();
  const inviteCode = safeText(route.invite, "");
  if (inviteCode && !currentUser) {
    applyAuthMode("signup");
    stashPendingInviteCode(inviteCode);
    notify("Invite link detected. Sign in, then open the game you were invited to.");
    syncRoute("home", { invite: inviteCode, push: false });
  }

  try {
    const session = await fetchAuthSession() as AuthPayload;
    if (session?.authenticated && session.user) {
      currentUser = session.user;
      if (inviteCode && redirectInviteToGameLobby(route, inviteCode)) {
        return;
      }
      if (inviteCode) {
        stashPendingInviteCode(inviteCode);
        notify("Invite saved. Open Pool or Chezz to join your friend's match.");
      } else {
        notify(`Welcome back ${safeText(currentUser?.username, "Player")}.`);
      }
      if (route.screen === "menu" || isMenuPath(window.location.pathname)) {
        showScreen("menu");
      } else if (isHomePath(window.location.pathname)) {
        showScreen("menu");
      } else {
        showScreen("menu");
      }
    } else if (route.screen === "menu") {
      syncRoute("home", { push: false });
      showScreen("home");
    }
  } catch {
    notify("Could not restore session.", true);
    showScreen("home");
  } finally {
    document.body.classList.remove("booting");
    refs.loader?.classList.add("fade-out");
  }
}
