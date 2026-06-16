import { gameRequestHeaders } from "../gameplay/gameRequestHeaders.js";
import { getActiveGameId } from "../gameplay/activeGameId.js";
import type { ApiError } from "../../shared/contracts.js";

const DEFAULT_TIMEOUT_MS = 12000;
/** Matchmaking timeout: tabs can exhaust HTTP/1.1 slots (SSE + boot). */
const MATCHMAKING_TIMEOUT_MS = 90_000;
const GENERIC_REQUEST_ERROR = "Request failed. Please try again.";
const NETWORK_REQUEST_ERROR = "Unable to reach the server. Please try again.";
const TIMEOUT_REQUEST_ERROR = "The request timed out. Please try again.";

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

type JsonResponse = Record<string, unknown>;
type UserResponse = {
  id?: string;
  username?: string;
  photo_url?: string | null;
};
type AuthResponse = JsonResponse & { user?: UserResponse | null };
type AuthSessionResponse = JsonResponse & { authenticated?: boolean; user?: UserResponse | null };
type BotProfileResponse = JsonResponse & { user?: UserResponse | null };
type ChatQueueResponse = JsonResponse & {
  chat_queue?: {
    accepting?: boolean;
    depth?: number;
    max?: number;
    ready?: boolean;
  };
};

function withTimeout(timeoutMs: number): { controller: AbortController; timer: number } {
  const controller = new AbortController();
  const timer = window.setTimeout(() => {
    controller.abort();
  }, Math.max(1, Number(timeoutMs || DEFAULT_TIMEOUT_MS)));
  return { controller, timer };
}


export async function requestJson(path: string, options: RequestOptions = {}): Promise<JsonResponse> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, ...fetchOptions } = options;
  const { controller, timer } = withTimeout(timeoutMs);
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json", ...gameRequestHeaders(), ...headers },
      ...fetchOptions,
      signal: controller.signal,
    });
    const contentType = String(response.headers.get("Content-Type") || "").toLowerCase();
    const expectsJson = contentType.includes("application/json");
    let payload: JsonResponse | null = null;
    if (expectsJson) {
      try {
        payload = await response.json() as JsonResponse;
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const baseMessage = String(payload?.error || `${response.status} ${response.statusText}`).trim();
      const err = new Error(baseMessage || GENERIC_REQUEST_ERROR) as ApiError;
      err.status = response.status;
      err.payload = payload && typeof payload === "object" ? payload : null;
      throw err;
    }
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid server response.");
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(TIMEOUT_REQUEST_ERROR);
    }
    const rawMessage = error instanceof Error ? error.message.trim() : "";
    const lowered = rawMessage.toLowerCase();
    if (
      lowered.includes("failed to fetch")
      || lowered.includes("networkerror")
      || lowered.includes("load failed")
    ) {
      throw new Error(NETWORK_REQUEST_ERROR);
    }
    if (rawMessage) throw new Error(rawMessage);
    throw new Error(GENERIC_REQUEST_ERROR);
  } finally {
    window.clearTimeout(timer);
  }
}


export function postJson(
  path: string,
  body: unknown,
  fetchOverrides: RequestOptions = {},
): Promise<JsonResponse> {
  const { headers: extraHeaders = {}, ...rest } = fetchOverrides;
  return requestJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body ?? {}),
    ...rest,
  });
}

export function registerUser(username: string, password: string, photoUrl: string | null): Promise<AuthResponse> {
  return postJson("/api/auth/register", {
    username,
    password,
    photo_url: photoUrl || null,
  }) as Promise<AuthResponse>;
}


export function loginUser(username: string, password: string): Promise<AuthResponse> {
  return postJson("/api/auth/login", { username, password }) as Promise<AuthResponse>;
}


export function logoutUser() {
  return postJson("/api/auth/logout", {});
}


export function fetchAuthSession(): Promise<AuthSessionResponse> {
  return requestJson("/api/auth/session") as Promise<AuthSessionResponse>;
}


export function updateProfile(username: string, photoUrl: string | null) {
  return postJson("/api/profile/update", {
    username,
    photo_url: photoUrl ?? null,
  });
}


export function fetchProfileStats() {
  return requestJson("/api/profile/stats");
}


export function fetchLeaderboard() {
  return requestJson("/api/leaderboard");
}


export function fetchChat(sinceId: string | number | null = null, gameId: string | null = null) {
  const params = new URLSearchParams();
  if (sinceId != null) params.set("since_id", String(sinceId));
  const activeGameId = gameId || getActiveGameId();
  if (activeGameId) params.set("game_id", String(activeGameId));
  const q = params.toString();
  return requestJson(q ? `/api/chat?${q}` : "/api/chat");
}


export function postChat(message: string, gameId: string | null = null) {
  const body: { game_id?: string; message: string } = { message };
  const activeGameId = gameId || getActiveGameId();
  if (activeGameId) body.game_id = activeGameId;
  return postJson("/api/chat", body);
}


export function fetchChatQueueStatus(gameId: string | null = null): Promise<ChatQueueResponse> {
  const params = new URLSearchParams();
  const activeGameId = gameId || getActiveGameId();
  if (activeGameId) params.set("game_id", String(activeGameId));
  const q = params.toString();
  return requestJson(q ? `/api/chat/queue?${q}` : "/api/chat/queue") as Promise<ChatQueueResponse>;
}


export function pingPresence() {
  return postJson("/api/presence/ping", {});
}


export function fetchOnlinePlayers() {
  return requestJson("/api/players/online");
}


export function fetchBotProfile(): Promise<BotProfileResponse> {
  return requestJson("/api/bot/profile") as Promise<BotProfileResponse>;
}


export async function joinMatchmaking() {
  const mmOpts = { timeoutMs: MATCHMAKING_TIMEOUT_MS };
  try {
    return await postJson("/api/matchmaking/join", {}, mmOpts);
  } catch (e) {
    if (e instanceof Error && e.message === TIMEOUT_REQUEST_ERROR) {
      await new Promise((r) => setTimeout(r, 300));
      return await postJson("/api/matchmaking/join", {}, mmOpts);
    }
    throw e;
  }
}


export function fetchMatchmakingStatus() {
  return requestJson("/api/matchmaking/status", { timeoutMs: MATCHMAKING_TIMEOUT_MS });
}


export function cancelMatchmaking() {
  return postJson("/api/matchmaking/cancel", {}, { timeoutMs: MATCHMAKING_TIMEOUT_MS });
}


export function fetchActivePvpGame() {
  return requestJson("/api/active-pvp-game");
}


export function surrenderGame(gameId: string | null = null) {
  return postJson("/api/game/surrender", gameId ? { game_id: gameId } : {});
}


export function createInvite() {
  return postJson("/api/invite/create", {});
}


export function fetchInviteStatus() {
  return requestJson("/api/invite/status");
}


export function joinInvite(code: string) {
  return postJson("/api/invite/join", { code });
}
