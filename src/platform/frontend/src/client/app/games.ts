import { POOL_SHELL, CHEZZ_SHELL } from "../platform/shell/config.js";
import type { GameType } from "../platform/shared/contracts.js";

export const GAMES: Record<GameType, {
  id: GameType;
  title: string;
  shell: typeof POOL_SHELL | typeof CHEZZ_SHELL;
  bootstrap: () => Promise<unknown>;
}> = {
  pool: {
    id: "pool",
    title: "Pool",
    shell: POOL_SHELL,
    bootstrap: () => import("../pool/app/bootstrap.js"),
  },
  chezz: {
    id: "chezz",
    title: "Chezz",
    shell: CHEZZ_SHELL,
    bootstrap: () => import("../chezz/app/bootstrap.js"),
  },
};

export const GAME_STORAGE_KEY = "mm_selected_game";
const GAME_COOKIE = "mm_selected_game";

function isGameType(value: string): value is GameType {
  return value in GAMES;
}

export function getSelectedGameId(): GameType | "" {
  const raw = String(localStorage.getItem(GAME_STORAGE_KEY) || "").trim().toLowerCase();
  return isGameType(raw) ? raw : "";
}

export function setSelectedGameId(gameId: unknown): void {
  const id = String(gameId || "").trim().toLowerCase();
  if (!isGameType(id)) {
    return;
  }
  localStorage.setItem(GAME_STORAGE_KEY, id);
  document.cookie = `${GAME_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; SameSite=Lax`;
}

export function clearSelectedGameId(): void {
  localStorage.removeItem(GAME_STORAGE_KEY);
  document.cookie = `${GAME_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

export function gameIdFromRouteQuery(location: Pick<Location, "search"> = window.location): GameType | "" {
  const raw = String(new URLSearchParams(location.search).get("game") || "").trim().toLowerCase();
  return isGameType(raw) ? raw : "";
}

const PENDING_INVITE_KEY = "mm_pending_invite_code";

export function stashPendingInviteCode(code: unknown): void {
  const c = String(code || "").trim().toLowerCase();
  if (!c) return;
  try {
    sessionStorage.setItem(PENDING_INVITE_KEY, c);
  } catch {
    /* noop */
  }
}

export function takePendingInviteCode(): string {
  try {
    const c = String(sessionStorage.getItem(PENDING_INVITE_KEY) || "").trim().toLowerCase();
    sessionStorage.removeItem(PENDING_INVITE_KEY);
    return c;
  } catch {
    return "";
  }
}

export function lobbyUrlForGame(gameId: unknown, inviteCode = ""): string {
  const id = String(gameId || "").trim().toLowerCase();
  const params = new URLSearchParams();
  if (isGameType(id)) params.set("game", id);
  const invite = String(inviteCode || "").trim().toLowerCase();
  if (invite) params.set("invite", invite);
  const q = params.toString();
  return q ? `/lobby?${q}` : "/lobby";
}
