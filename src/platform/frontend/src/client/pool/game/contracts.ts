export const MODE_PVP = "pvp" as const;
export const MODE_PASS_AND_PLAY = "pnp" as const;
export type PoolMode = typeof MODE_PVP | typeof MODE_PASS_AND_PLAY;
export type PoolStatus = "active" | "finished" | "draw";
export type PoolSeat = "player1" | "player2";
export type ClockColor = "w" | "b";

export interface BallPosition {
  n: number;
  x: number;
  y: number;
}

export interface ShotAim {
  angle?: number;
  power?: number;
  cue_x?: number;
  cue_y?: number;
  [key: string]: unknown;
}

export interface TrajectorySample {
  t?: number;
  balls?: Record<string, { x: number; y: number }>;
  [key: string]: unknown;
}

export interface PoolTrajectory {
  x_vel?: number;
  y_vel?: number;
  duration?: number;
  aim?: ShotAim;
  samples?: TrajectorySample[];
  [key: string]: unknown;
}

export interface PoolTable {
  game_name?: string;
  svg?: string;
  mode?: PoolMode;
  status?: PoolStatus;
  game_over?: boolean;
  winner?: string | null;
  winner_player_id?: string | null;
  winner_message?: string;
  current_player?: string;
  current_player_id?: string;
  player1_id?: string;
  player2_id?: string;
  p1_name?: string;
  p2_name?: string;
  p1_photo_url?: string | null;
  p2_photo_url?: string | null;
  p1_playing?: string;
  p2_playing?: string;
  p1_score?: number;
  p2_score?: number;
  ball_in_hand?: boolean;
  ball_in_hand_for_player_id?: string | null;
  balls?: BallPosition[];
  [key: string]: unknown;
}

export interface PoolResult {
  status?: PoolStatus;
  winner?: string | null;
  reason?: string | null;
}

export interface PoolState {
  game_id?: string;
  mode?: PoolMode;
  status?: PoolStatus;
  table?: PoolTable;
  result?: PoolResult;
  you_seat?: PoolSeat | null;
  stream_seq?: number;
  clock_a_ms?: number;
  clock_b_ms?: number;
  clock_active_color?: ClockColor;
  clock_anchor_iso?: string;
  can_place_cue?: boolean;
  can_fire_shot?: boolean;
  [key: string]: unknown;
}

export interface PoolActionResponse extends PoolState {
  ok?: boolean;
  valid?: boolean;
  trajectory?: PoolTrajectory | null;
}

export interface PoolTerminalResponse extends Partial<PoolState> {
  type?: string;
  next_state?: Partial<PoolState>;
  game_over?: Partial<PoolState>;
}

export interface PoolReplay {
  game_id: string;
  entries: PoolReplayEntry[];
  live_index: number;
}

export interface PoolReplayEntry {
  index?: number;
  step?: number;
  ply?: number;
  label?: string;
  snapshot?: PoolTable;
  trajectory?: PoolTrajectory | null;
}

export const ACTION = {
  HYDRATE: "HYDRATE",
  SHOT_RESULT: "SHOT_RESULT",
  TERMINAL: "TERMINAL",
  PROFILE_REFRESH: "PROFILE_REFRESH",
} as const;

export type PoolActionType = typeof ACTION[keyof typeof ACTION];

export interface PoolStoreAction {
  type?: PoolActionType;
  payload?: Partial<PoolState>;
}
