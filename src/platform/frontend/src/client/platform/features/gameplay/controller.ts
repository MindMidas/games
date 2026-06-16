import { gameIdFromRoute, syncRoute, isGameId } from "../../shared/lib/routes.js";
import { gameJsonRequest } from "../../game/jsonClient.js";
import { focusGameBoardAfterRematch } from "./syncGameShell.js";
import type { ApiError } from "../../shared/contracts.js";

interface EnterOptions {
  game_id?: string;
  mode?: string;
  onReady?: () => void;
  skipGameLoadingOverlay?: boolean;
}

interface StoredSession {
  gameId: string | null;
  mode: string | null;
}

interface NewGameExtra {
  match_id?: string;
}

interface NewGameResponse {
  game_id?: string;
  reused_existing_game?: boolean;
}

interface GameState {
  mode?: string;
  status?: string;
  table?: { game_over?: boolean };
}

interface GameStore {
  getState(): unknown;
  dispatch(action: unknown): unknown;
}

interface GameSession {
  teardown(): void;
  store?: GameStore;
  refreshProfilePhotos?(): Promise<void>;
}

interface BootOptions {
  gameId: string;
  currentUser: Record<string, unknown> | null;
  startRematch(gameId: string): Promise<void>;
}

interface BootContext {
  session: GameSession;
  currentGameId: string;
  currentMode: string;
  setCurrentMode(mode: string): void;
  currentUser: Record<string, unknown> | null;
  syncShell: ((state: GameState) => void) | null;
}

interface ResetContext {
  session: GameSession | null;
  currentGameId: string;
  currentMode: string;
}

interface GameplayControllerConfig {
  storageKey: string;
  offlineMode: string;
  pvpMode?: string;
  gameBoot(options: BootOptions): Promise<GameSession>;
  confirmDialog?: ((message: string, options: { title: string }) => Promise<boolean>) | null;
  onBackToLobby?: (() => void) | null;
  onGameNotFound?: (() => void) | null;
  beforeBoot?: ((gameId: string) => void | Promise<void>) | null;
  afterBoot?: ((context: BootContext) => void | Promise<void>) | null;
  onReset?: ((context: ResetContext) => void) | null;
  syncShell?: ((state: GameState) => void) | null;
  postSurrender?: ((gameId: string) => Promise<unknown>) | null;
  terminalActionType?: string | null;
  dispatchTerminal?: ((response: unknown, session: GameSession) => void) | null;
}

interface BootSessionOptions {
  forceReboot?: boolean;
}

interface StartModeOptions {
  forceFresh?: boolean;
}

function errorValue(error: unknown, key: "message" | "status"): unknown {
  return error && typeof error === "object" && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

function asGameState(value: unknown): GameState | null {
  return value && typeof value === "object" ? value as GameState : null;
}

export function hideAppLoadingOverlay(): void {
  const loader = document.getElementById("app-loading-screen");
  if (loader) loader.classList.add("fade-out");
}


export function isMissingGameError(error: unknown): boolean {
  const status = Number(errorValue(error, "status"));
  if (status === 404 || status === 410) return true;
  const msg = String(errorValue(error, "message") || error || "").toLowerCase();
  return (
    msg.includes("game not found")
    || msg.includes("no active")
    || msg.includes("invalid game")
    || msg.includes("no board snapshot")
  );
}


function gameLinkRequested(opts: EnterOptions, urlGameId: string): boolean {
  const explicitId = String(opts?.game_id || "").trim();
  return isGameId(explicitId) || isGameId(urlGameId);
}


function createSessionStorage(storageKey: string) {
  return {
    persist(gameId: string, mode: string): void {
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify({ gameId, mode }));
      } catch { /* noop */ }
    },
    restore(): StoredSession {
      try {
        const raw = window.sessionStorage.getItem(storageKey);
        if (!raw) return { gameId: null, mode: null };
        const parsed = JSON.parse(raw);
        return {
          gameId: parsed && typeof parsed.gameId === "string" ? parsed.gameId : null,
          mode: parsed && typeof parsed.mode === "string" ? parsed.mode : null,
        };
      } catch {
        return { gameId: null, mode: null };
      }
    },
    clear(): void {
      try { window.sessionStorage.removeItem(storageKey); } catch { /* noop */ }
    },
  };
}


export async function postNewGame(
  mode: string,
  fallbackMode: string,
  extra: NewGameExtra = {},
): Promise<NewGameResponse> {
  const payload: { mode: string; match_id?: string } = { mode: mode || fallbackMode };
  if (extra && typeof extra === "object") {
    const mid = String(extra.match_id || "").trim();
    if (mid) payload.match_id = mid;
  }
  return gameJsonRequest("/api/new-game", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}


export function createGameplayController(config: GameplayControllerConfig) {
  const {
    storageKey,
    offlineMode,
    pvpMode = "pvp",
    gameBoot,
    confirmDialog = null,
    onBackToLobby = null,
    onGameNotFound = null,
    beforeBoot = null,
    afterBoot = null,
    onReset = null,
    syncShell = null,
    postSurrender = null,
    terminalActionType = null,
    dispatchTerminal = null,
  } = config;

  const sessionStorage = createSessionStorage(storageKey);
  const validModes = [offlineMode, pvpMode];

  let session: GameSession | null = null;
  let currentUser: Record<string, unknown> | null = null;
  let currentMode = offlineMode;
  let currentGameId = "";
  let booting = false;
  /** @type {Promise<void> | null} */
  let bootPromise: Promise<void> | null = null;
  const BOOT_TIMEOUT_MS = 45000;

  function init(): void { /* eager init noop */ }

  function resetSession(): void {
    if (typeof onReset === "function") onReset({ session, currentGameId, currentMode });
    if (session) {
      try { session.teardown(); } catch { /* noop */ }
      session = null;
    }
    currentGameId = "";
  }

  function setUser(user: Record<string, unknown> | null): void {
    currentUser = user || null;
  }

  function normalizeMode(mode: string | null | undefined): string {
    return mode === pvpMode ? pvpMode : offlineMode;
  }

  async function runBootSession(gameId: string, mode: string): Promise<void> {
    if (!isGameId(gameId)) {
      throw new Error("Invalid game id.");
    }
    booting = true;
    const prevGameId = currentGameId;
    resetSession();
    currentGameId = String(gameId || "");
    currentMode = mode || currentMode || offlineMode;
    sessionStorage.persist(currentGameId, currentMode);
    const routeChanged = isGameId(prevGameId) && prevGameId !== currentGameId;
    let timeoutId: number | null = null;
    try {
      const bootWork = async () => {
        if (typeof beforeBoot === "function") {
          await beforeBoot(currentGameId);
        }
        const bootOpts = {
          gameId: currentGameId,
          currentUser,
          startRematch: (newGameId: string) => startRematch(newGameId),
        };
        session = await gameBoot(bootOpts);
        const loaded = asGameState(session?.store?.getState?.());
        if (!loaded || typeof loaded !== "object") {
          const err = new Error("Game not found") as ApiError;
          err.status = 404;
          throw err;
        }
        if (loaded.mode && validModes.includes(loaded.mode)) {
          currentMode = loaded.mode;
          sessionStorage.persist(currentGameId, currentMode);
        }
        const shellGame = String(document.documentElement?.getAttribute("data-game") || "").trim();
        syncRoute("game", {
          gameId: currentGameId,
          push: routeChanged,
          gameType: shellGame === "chezz" || shellGame === "pool" ? shellGame : undefined,
        });
        if (typeof afterBoot === "function") {
          await afterBoot({
            session,
            currentGameId,
            currentMode,
            setCurrentMode: (mode: string) => { currentMode = mode; },
            currentUser,
            syncShell,
          });
        }
        if (typeof syncShell === "function") {
          syncShell(loaded);
        }
      };
      await Promise.race([
        bootWork(),
        new Promise<void>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error("Game load timed out. Check your connection and try again."));
          }, BOOT_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      sessionStorage.clear();
      currentGameId = "";
      resetSession();
      throw err;
    } finally {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      booting = false;
      hideAppLoadingOverlay();
    }
  }

  async function createFreshGame(wanted: string): Promise<NewGameResponse> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const created = await postNewGame(wanted, offlineMode);
      if (!created?.reused_existing_game) return created;
      const reusedId = String(created?.game_id || "").trim();
      if (reusedId && postSurrender) {
        try {
          await postSurrender(reusedId);
        } catch {
          /* noop - still retry new-game */
        }
        if (attempt + 1 < 3) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 80 * (attempt + 1));
          });
          continue;
        }
      }
      return created;
    }
    return postNewGame(wanted, offlineMode);
  }

  async function bootSession(
    gameId: string,
    mode: string,
    opts: BootSessionOptions = {},
  ): Promise<void> {
    const targetId = String(gameId || "");
    if (!isGameId(targetId)) {
      throw new Error("Invalid game id.");
    }
    const forceReboot = opts.forceReboot === true;

    if (bootPromise) {
      await bootPromise.catch(() => {});
      if (!forceReboot && currentGameId === targetId && session?.store) {
        hideAppLoadingOverlay();
        return;
      }
    }

    bootPromise = runBootSession(targetId, mode);
    try {
      await bootPromise;
    } finally {
      bootPromise = null;
    }
  }

  async function startMode(
    mode: string,
    onReady: (() => void) | null = null,
    _suppressLoadingOverlay = false,
    opts: StartModeOptions = {},
  ): Promise<void> {
    const wanted = normalizeMode(mode);
    const forceFresh = opts.forceFresh === true;
    try {
      const created = forceFresh
        ? await createFreshGame(wanted)
        : await postNewGame(wanted, offlineMode);
      const newId = String(created?.game_id || "").trim();
      if (!newId) throw new Error("Server did not return a game_id.");
      await bootSession(newId, wanted, { forceReboot: forceFresh });
      if (typeof onReady === "function") onReady();
    } catch (err) {
      console.error("[gameplay] startMode failed:", err);
      if (typeof onReady === "function") onReady();
      throw err;
    }
  }

  function resolveBootMode(gameId: string, opts: EnterOptions, saved: StoredSession): string {
    if (opts.mode && validModes.includes(opts.mode)) {
      return normalizeMode(opts.mode);
    }
    if (saved.gameId === gameId && saved.mode && validModes.includes(saved.mode)) {
      return normalizeMode(saved.mode);
    }
    return offlineMode;
  }

  async function onEnter(options: EnterOptions = {}): Promise<void> {
    const opts = options || {};
    const urlGameId = gameIdFromRoute();
    const explicitId = String(opts.game_id || "").trim();
    const freshMode = opts.mode && validModes.includes(opts.mode) && !isGameId(explicitId)
      ? opts.mode
      : "";
    const saved = sessionStorage.restore();

    try {
      if (isGameId(explicitId)) {
        await bootSession(explicitId, resolveBootMode(explicitId, opts, saved));
        if (typeof opts.onReady === "function") opts.onReady();
        return;
      }
      if (freshMode) {
        await startMode(freshMode, opts.onReady, !!opts.skipGameLoadingOverlay);
        return;
      }
      const resumeId = isGameId(urlGameId)
        ? urlGameId
        : String(saved.gameId || "").trim();
      if (resumeId && isGameId(resumeId)) {
        const mode = !isGameId(urlGameId) && saved.gameId === resumeId && saved.mode
          ? normalizeMode(saved.mode)
          : offlineMode;
        await bootSession(resumeId, mode);
        if (typeof opts.onReady === "function") opts.onReady();
        return;
      }
      hideAppLoadingOverlay();
      if (typeof opts.onReady === "function") opts.onReady();
      if (gameLinkRequested(opts, urlGameId) && onGameNotFound) {
        onGameNotFound();
      } else if (onBackToLobby) {
        onBackToLobby();
      }
    } catch (err) {
      console.error("[gameplay] onEnter failed:", err);
      hideAppLoadingOverlay();
      if (typeof opts.onReady === "function") opts.onReady();
      if (onGameNotFound && (isMissingGameError(err) || gameLinkRequested(opts, urlGameId))) {
        onGameNotFound();
      } else if (onBackToLobby) {
        onBackToLobby();
      }
    }
  }

  function onExit(): void {
    if (session) {
      try { session.teardown(); } catch { /* noop */ }
      session = null;
    }
    currentGameId = "";
  }

  async function refreshNow(): Promise<void> {
    if (currentGameId) await bootSession(currentGameId, currentMode);
  }

  async function startRematch(newGameId: string): Promise<void> {
    const id = String(newGameId || "").trim();
    if (!id) return;
    try {
      await bootSession(id, pvpMode);
      focusGameBoardAfterRematch();
    } catch (err) {
      console.error("[gameplay] startRematch failed:", err);
      throw err;
    }
  }

  async function newGameSameMode(): Promise<void> {
    await startMode(currentMode === pvpMode ? pvpMode : offlineMode, null, true);
  }

  /** Match is over - no need to confirm surrender before Play Again / New Game. */


  function isMatchEnded(state: GameState | null | undefined): boolean {
    if (!state) return false;
    const st = String(state.status || "").toLowerCase();
    if (st === "finished" || st === "draw") return true;
    return Boolean(state.table?.game_over);
  }

  async function ensureSurrenderIfActive(): Promise<boolean> {
    if (!session?.store || !currentGameId || !postSurrender) return true;
    const s = asGameState(session.store.getState());
    if (!s || isMatchEnded(s) || s.status !== "active") return true;

    const offline = currentMode !== pvpMode;
    const title = offline ? "End game?" : "Surrender?";
    const message = offline
      ? "Starting a new game will end the current game. Continue?"
      : "Starting a new game ends this one as a resignation (surrender). Continue?";
    const ok = confirmDialog
      ? await confirmDialog(message, { title })
      : window.confirm(message);
    if (!ok) return false;
    try {
      const res = await postSurrender(currentGameId);
      if (res && session?.store) {
        if (typeof dispatchTerminal === "function") {
          dispatchTerminal(res, session);
        } else if (terminalActionType) {
          session.store.dispatch({ type: terminalActionType, payload: res });
        }
      }
    } catch { /* ignore */ }
    return true;
  }

  function getCurrentMode(): string {
    return currentMode === pvpMode ? pvpMode : offlineMode;
  }

  async function refreshProfileAvatars(): Promise<void> {
    if (!session || !currentGameId || !currentUser) {
      return;
    }
    if (typeof session.refreshProfilePhotos !== "function") {
      return;
    }
    try {
      await session.refreshProfilePhotos();
    } catch {
      /* ignore - stale avatar is non-fatal */
    }
  }

  return {
    init,
    onEnter,
    onExit,
    setUser,
    reset: () => { sessionStorage.clear(); resetSession(); },
    startMode,
    refreshNow,
    refreshProfileAvatars,
    newGameSameMode,
    ensureSurrenderIfActive,
    getCurrentMode,
    startRematch,
    getSession: () => session,
    getCurrentGameId: () => currentGameId,
  };
}
