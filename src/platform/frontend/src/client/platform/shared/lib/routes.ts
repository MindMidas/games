import { safeText } from "./utils.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GAME_TYPES = new Set(["pool", "chezz"]);
const APP_BASE_PATH = "/games";

const KNOWN_EXACT_PATHS = new Set(["/", "/menu", "/lobby", "/matchmaking", "/404", "/not-found"]);

export type GameType = "pool" | "chezz";

interface LocationLike {
  pathname: string;
  search: string;
}

interface RouteOptions {
  gameId?: unknown;
  gameType?: unknown;
  invite?: unknown;
  push?: boolean;
}

interface HistoryOptions {
  pushRoute?: boolean;
}

interface ParsedGamePath {
  gameType: GameType | null;
  gameId: string | null;
  invalid: boolean;
}

interface ParsedRoute {
  screen: string | null;
  gameId: string | null;
  invite: string | null;
  gameType: GameType | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePathname(pathname: unknown): string {
  const raw = safeText(pathname, "/");
  const trimmed = raw.replace(/\/+$/, "");
  const normalized = trimmed || "/";
  if (normalized === APP_BASE_PATH) {
    return "/";
  }
  if (normalized.startsWith(`${APP_BASE_PATH}/`)) {
    return normalized.slice(APP_BASE_PATH.length) || "/";
  }
  return normalized;
}

function currentAppBase(): string {
  const raw = safeText(window.location?.pathname, "/").replace(/\/+$/, "") || "/";
  return raw === APP_BASE_PATH || raw.startsWith(`${APP_BASE_PATH}/`) ? APP_BASE_PATH : "";
}

function withAppBase(path: string): string {
  const base = currentAppBase();
  if (!base) {
    return path;
  }
  return path === "/" ? `${base}/` : `${base}${path}`;
}

export function isGameId(value: unknown): boolean {
  return UUID_RE.test(safeText(value, ""));
}

export function isHomePath(pathname: unknown): boolean {
  return normalizePathname(pathname) === "/";
}

export function isMenuPath(pathname: unknown): boolean {
  return normalizePathname(pathname) === "/menu";
}

export function isHubPath(pathname: unknown): boolean {
  const path = normalizePathname(pathname);
  return path === "/" || path === "/menu";
}

export function parseGamePath(pathname: unknown): ParsedGamePath {
  const path = normalizePathname(pathname);
  const typed = path.match(/^\/game\/(pool|chezz)\/([^/]+)$/i);
  if (typed) {
    const gameType = safeText(typed[1], "").toLowerCase();
    const gameId = safeText(decodeURIComponent(typed[2]), "");
    if (GAME_TYPES.has(gameType) && isGameId(gameId)) {
      return { gameType: gameType as GameType, gameId, invalid: false };
    }
    return { gameType: null, gameId: null, invalid: true };
  }

  return path.startsWith("/game/")
    ? { gameType: null, gameId: null, invalid: true }
    : { gameType: null, gameId: null, invalid: false };
}

export function isKnownAppPath(pathname: unknown): boolean {
  const path = normalizePathname(pathname);
  if (KNOWN_EXACT_PATHS.has(path)) {
    return true;
  }
  const parsed = parseGamePath(path);
  if (parsed.invalid) {
    return false;
  }
  return Boolean(parsed.gameId);
}

export function isSpaShellPath(pathname: unknown): boolean {
  const path = normalizePathname(pathname);
  if (isKnownAppPath(path)) {
    return true;
  }
  if (path.startsWith("/api/") || path.startsWith("/static/")) {
    return false;
  }
  const leaf = path.split("/").pop() || "";
  if (leaf.includes(".")) {
    return false;
  }
  return path.length > 1;
}

export function extractInviteCode(value: unknown): string {
  const raw = safeText(value, "");
  if (!raw) return "";
  if (raw.includes("invite=")) {
    try {
      const base = raw.includes("://") ? raw : `https://local.invalid${raw.startsWith("/") ? "" : "/"}${raw}`;
      const url = new URL(base);
      const fromQuery = safeText(url.searchParams.get("invite"), "").toLowerCase();
      if (fromQuery) return fromQuery;
    } catch {
      /* fall through */
    }
    const m = raw.match(/[?&]invite=([a-z0-9]+)/i);
    if (m) return String(m[1] || "").toLowerCase();
  }
  return raw.toLowerCase();
}

export function isInviteMatchPayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const st = safeText(payload.status, "").toLowerCase();
  return (st === "matched" || st === "opponent_found") && Boolean(payload.match_id);
}

export function parseRoute(location: LocationLike = window.location): ParsedRoute {
  const pathname = normalizePathname(location.pathname);
  const params = new URLSearchParams(location.search);
  const invite = safeText(params.get("invite"), "") || null;
  const gameTypeRaw = safeText(params.get("game"), "").toLowerCase();
  const queryGameType = GAME_TYPES.has(gameTypeRaw) ? gameTypeRaw as GameType : null;

  if (pathname === "/404" || pathname === "/not-found") {
    return { screen: "notFound", gameId: null, invite, gameType: null };
  }
  if (pathname === "/menu") {
    return { screen: "menu", gameId: null, invite: null, gameType: null };
  }
  if (pathname === "/lobby") {
    return { screen: "lobby", gameId: null, invite, gameType: queryGameType };
  }
  if (pathname === "/matchmaking") {
    return { screen: "matchmaking", gameId: null, invite: null, gameType: queryGameType };
  }

  const gamePath = parseGamePath(pathname);
  if (gamePath.invalid) {
    return { screen: "notFound", gameId: null, invite, gameType: null };
  }
  if (gamePath.gameId) {
    const gameType = gamePath.gameType || queryGameType;
    return { screen: "game", gameId: gamePath.gameId, invite, gameType };
  }

  if (isHomePath(pathname)) {
    if (invite) {
      return {
        screen: "lobby",
        gameId: null,
        invite,
        gameType: queryGameType || null,
      };
    }
    return { screen: null, gameId: null, invite: null, gameType: null };
  }

  return { screen: "notFound", gameId: null, invite, gameType: null };
}

export function resolveGameTypeHint(
  options: RouteOptions = {},
  location: LocationLike = window.location,
): GameType | null {
  const fromOpts = safeText(options.gameType, "").toLowerCase();
  if (GAME_TYPES.has(fromOpts)) return fromOpts as GameType;
  const route = parseRoute(location);
  if (route.gameType) return route.gameType;
  const dom = safeText(document.documentElement?.getAttribute("data-game"), "").toLowerCase();
  if (GAME_TYPES.has(dom)) return dom as GameType;
  try {
    const stored = safeText(window.localStorage.getItem("mm_selected_game"), "").toLowerCase();
    if (GAME_TYPES.has(stored)) return stored as GameType;
  } catch {
    /* noop */
  }
  return null;
}

export function buildPath(screen: unknown, options: RouteOptions = {}): string | null {
  const invite = safeText(options.invite, "") || null;
  const gameId = safeText(options.gameId, "");
  const gameType = resolveGameTypeHint(options);

  if (screen === "game") {
    if (!isGameId(gameId)) {
      return null;
    }
    return gameType ? withAppBase(`/game/${gameType}/${encodeURIComponent(gameId)}`) : null;
  }
  if (screen === "notFound") {
    return withAppBase("/404");
  }
  if (screen === "menu") {
    return withAppBase("/menu");
  }
  if (screen === "matchmaking") {
    return withAppBase("/matchmaking");
  }
  if (screen === "lobby") {
    const qs = new URLSearchParams();
    if (gameType && GAME_TYPES.has(gameType)) {
      qs.set("game", gameType);
    }
    if (invite) {
      qs.set("invite", invite);
    }
    const q = qs.toString();
    return withAppBase(q ? `/lobby?${q}` : "/lobby");
  }
  if (screen === "home") {
    return withAppBase(invite ? `/?invite=${encodeURIComponent(invite)}` : "/");
  }
  return withAppBase("/");
}

export function syncRoute(screen: unknown, options: RouteOptions = {}): void {
  const path = buildPath(screen, options);
  if (!path) {
    return;
  }
  const state = {
    screen,
    gameId: options.gameId || null,
    invite: options.invite || null,
    gameType: options.gameType || resolveGameTypeHint(options) || null,
  };
  if (options.push) {
    window.history.pushState(state, "", path);
  } else {
    window.history.replaceState(state, "", path);
  }
}

export function shouldPushHistory(
  prevScreen: unknown,
  nextScreen: unknown,
  options: HistoryOptions = {},
): boolean {
  if (options.pushRoute === true) {
    return true;
  }
  if (options.pushRoute === false) {
    return false;
  }
  if (nextScreen === "home" || nextScreen === "menu" || prevScreen === nextScreen) {
    return false;
  }
  return true;
}

export function gameIdFromRoute(location: LocationLike = window.location): string {
  return parseRoute(location).gameId || "";
}
