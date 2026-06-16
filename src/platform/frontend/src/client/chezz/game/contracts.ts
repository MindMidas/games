export type Color = "w" | "b";
export type Status = "active" | "finished";
export type Mode = "pve" | "pvp";
export type ActionKind = "move" | "shoot" | "fling";

export interface BoardHeader {
  turn: Color;
  time_taken?: number;
  max_time?: number;
  num_moves?: number;
}

export interface GameResult {
  status: Status | "draw";
  winner?: Color | "draw" | null;
  reason?: string | null;
}

export interface PlayerInfo {
  user_id?: string | null;
  username?: string;
  photo_url?: string | null;
}

export interface AnimationEvent {
  type: number;
  action?: string;
  piece?: string;
  from_piece?: string;
  to_piece?: string;
  direction?: string;
  square?: string;
  from_square?: string;
  to_square?: string;
  payload_square?: string;
  target_square?: string;
}

export interface LegalAction {
  action_key?: string;
  kind?: ActionKind;
  from?: string;
  from_sq?: string;
  to?: string;
  square?: string;
  direction?: string;
  catapult?: string;
  payload?: string;
  target?: string;
  preview_events?: AnimationEvent[];
  preview_snapshot?: EngineBoard;
}

export interface EngineBoard {
  game_type?: string;
  mode?: Mode;
  engine_name?: string;
  header: BoardHeader;
  board: Record<string, string>;
  result?: GameResult;
  winner?: Color | null;
}

export interface LegalBundle {
  cursor: string;
  actions: LegalAction[];
  premove_by_color?: Partial<Record<Color, LegalAction[]>>;
}

export interface GameState {
  game_id: string;
  mode: Mode;
  status: Status | "draw";
  result?: GameResult | null;
  players: Record<Color, PlayerInfo>;
  you_color: Color | null;
  board: EngineBoard;
  current_turn: Color;
  move_number: number;
  move_history: unknown[];
  captured: Record<Color, string[]>;
  clock_a_ms: number;
  clock_b_ms: number;
  clock_active_color: Color;
  clock_anchor_iso: string;
  stream_seq: number;
  legal?: LegalBundle;
}

export interface MoveAccepted {
  type: "move_accepted";
  game_id: string;
  next_state: GameState;
  move: Record<string, unknown>;
  animation_events: AnimationEvent[];
  last_move_seq: number;
  legal?: LegalBundle | null;
}

export interface GameOver {
  type: "game_over";
  game_id: string;
  next_state: GameState;
  result: GameResult;
}

export const ACTION = Object.freeze({
  HYDRATE: "HYDRATE",
  MOVE_ACCEPTED: "MOVE_ACCEPTED",
  OPTIMISTIC_ANIMATION: "OPTIMISTIC_ANIMATION",
  OPTIMISTIC_BOARD_PATCH: "OPTIMISTIC_BOARD_PATCH",
  OPTIMISTIC_CANCEL: "OPTIMISTIC_CANCEL",
  ANIMATION_DONE: "ANIMATION_DONE",
  TERMINAL: "TERMINAL",
  PROFILE_REFRESH: "PROFILE_REFRESH",
  RESET: "RESET",
});

export const SSE = Object.freeze({
  MOVE_ACCEPTED: "move_accepted",
  GAME_OVER: "game_over",
  CHAT_MESSAGE: "chat_message",
});

export const COLOR = Object.freeze({ W: "w" as const, B: "b" as const });

export function other(c: Color): Color {
  return c === COLOR.W ? COLOR.B : COLOR.W;
}
