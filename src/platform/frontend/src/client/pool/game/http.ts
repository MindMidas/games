import { setActiveGameId } from "../../platform/features/gameplay/activeGameId.js";
import { gameJsonRequest as request } from "../../platform/game/jsonClient.js";
import type {
  PoolActionResponse,
  PoolReplay,
  PoolState,
  PoolTerminalResponse,
  ShotAim,
} from "./contracts.js";

interface SurrenderOptions {
  cause?: string;
}

export async function fetchState(gameId: string): Promise<PoolState> {
  return request<PoolState>(`/api/state?game_id=${encodeURIComponent(gameId)}`, { method: "GET" });
}

export async function postShot(
  gameId: string,
  xVel: number,
  yVel: number,
  cueX: number | null = null,
  cueY: number | null = null,
  aim: ShotAim | null = null,
): Promise<PoolActionResponse> {
  const payload: {
    game_id: string;
    x_vel: number;
    y_vel: number;
    cue_x?: number;
    cue_y?: number;
    aim?: ShotAim;
  } = { game_id: gameId, x_vel: xVel, y_vel: yVel };
  if (Number.isFinite(cueX) && Number.isFinite(cueY)) {
    payload.cue_x = Number(cueX);
    payload.cue_y = Number(cueY);
  }
  if (aim && typeof aim === "object") {
    payload.aim = aim;
  }
  return request<PoolActionResponse>("/api/shot", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function postValidatePlaceCue(gameId: string, x: number, y: number): Promise<PoolActionResponse> {
  return request<PoolActionResponse>("/api/place-cue", {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, x, y, validate_only: true }),
  });
}

export async function surrender(gameId: string, opts: SurrenderOptions = {}): Promise<PoolTerminalResponse> {
  const payload: { game_id: string; cause?: string } = { game_id: gameId };
  const cause = String(opts?.cause || "").trim();
  if (cause) payload.cause = cause;
  return request<PoolTerminalResponse>("/api/game/surrender", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function bindGameId(gameId: string): void {
  setActiveGameId(gameId);
}

export async function loadReplay(gameId: string): Promise<PoolReplay> {
  const q = `?game_id=${encodeURIComponent(gameId)}`;
  return request<PoolReplay>(`/api/replay${q}`, { method: "GET" });
}
