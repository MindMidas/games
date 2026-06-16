import { gameJsonRequest as request } from "../../platform/game/jsonClient.js";
import type { GameOver, GameState, MoveAccepted } from "./contracts.js";

type ActionKind = "move" | "shoot" | "fling";

interface ActionMeta {
  square?: string;
  direction?: string;
  catapult?: string;
  payload?: string;
  target?: string;
}

interface ActionRequest {
  kind: ActionKind;
  fromSq?: string;
  toSq?: string;
  meta?: ActionMeta;
}

interface SubmitMoveRequest extends ActionRequest {
  gameId: string;
  expectedSeq: number;
  clientMoveId: string;
}

interface SurrenderOptions {
  cause?: string;
}

function buildActionKey(req: ActionRequest): string {
  const kind = String(req.kind || "").toLowerCase();
  const meta = req.meta || {};
  if (kind === "shoot") {
    const sq = String(meta.square || req.fromSq || "").toLowerCase();
    const dir = String(meta.direction || "").toLowerCase();
    return `shoot:${sq}:${dir}`;
  }
  if (kind === "fling") {
    const cat = String(meta.catapult || req.fromSq || "").toLowerCase();
    const payload = String(meta.payload || "").toLowerCase();
    const target = String(meta.target || req.toSq || "").toLowerCase();
    return `fling:${cat}:${payload}>${target}`;
  }
  const from = String(req.fromSq || "").toLowerCase();
  const to = String(req.toSq || "").toLowerCase();
  return `move:${from}>${to}`;
}

export function loadState(gameId: string): Promise<GameState> {
  const q = gameId ? `?game_id=${encodeURIComponent(gameId)}` : "";
  return request<GameState>(`/api/state${q}`, { method: "GET" });
}

export function loadReplay(
  gameId: string,
  { includeEvents = true }: { includeEvents?: boolean } = {},
): Promise<unknown> {
  const gid = String(gameId || "").trim();
  const ie = includeEvents ? "1" : "0";
  const q = gid
    ? `?game_id=${encodeURIComponent(gid)}&include_events=${ie}`
    : `?include_events=${ie}`;
  return request(`/api/replay${q}`, { method: "GET" });
}

export function submitMove(args: SubmitMoveRequest): Promise<MoveAccepted | GameOver> {
  const body = {
    game_id: args.gameId,
    action_key: buildActionKey(args),
    expected_seq: Number.isFinite(args.expectedSeq) ? args.expectedSeq : -1,
    client_move_id: args.clientMoveId,
  };
  return request<MoveAccepted | GameOver>("/api/move", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function playEngineMove(gameId: string): Promise<MoveAccepted | GameOver> {
  return request<MoveAccepted | GameOver>("/api/move", {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, actor: "engine" }),
  });
}

export function surrender(gameId: string, opts: SurrenderOptions = {}): Promise<unknown> {
  const payload: { game_id: string; cause?: string } = { game_id: gameId };
  const cause = String(opts?.cause || "").trim();
  if (cause) payload.cause = cause;
  return request("/api/game/surrender", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function newGame(mode?: string): Promise<unknown> {
  return request("/api/new-game", {
    method: "POST",
    body: JSON.stringify({ mode: mode || "pve" }),
  });
}
