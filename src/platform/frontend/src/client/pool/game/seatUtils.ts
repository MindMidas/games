import type { PoolSeat, PoolState, PoolTable } from "./contracts.js";

type SeatProfile = {
  name: string;
  scoreKey: "p1" | "p2";
  photoUrl?: string | null;
  playing?: string;
  playerId?: string;
};

type SeatFlags = {
  can_place_cue: boolean;
  can_fire_shot: boolean;
};

export function bottomDisplaySeat(state: Partial<PoolState>): PoolSeat {
  if (state?.mode === "pnp") return "player1";
  if (state?.you_seat === "player2") return "player2";
  return "player1";
}

export function topDisplaySeat(state: Partial<PoolState>): PoolSeat {
  return bottomDisplaySeat(state) === "player1" ? "player2" : "player1";
}

export function seatProfile(table: Partial<PoolTable>, seat: PoolSeat): SeatProfile {
  if (seat === "player2") {
    return {
      name: table.p2_name || "Player 2",
      scoreKey: "p2",
      photoUrl: table.p2_photo_url,
      playing: table.p2_playing,
      playerId: table.player2_id,
    };
  }
  return {
    name: table.p1_name || "Player 1",
    scoreKey: "p1",
    photoUrl: table.p1_photo_url,
    playing: table.p1_playing,
    playerId: table.player1_id,
  };
}

export function isReceiver(state: Partial<PoolState>): boolean {
  const table = state?.table || {};
  if (!table.ball_in_hand) return false;
  const receiver = String(table.ball_in_hand_for_player_id || "");
  if (!receiver) return false;

  if (state?.mode === "pnp") {
    const p1 = String(table.player1_id || "");
    const p2 = String(table.player2_id || "");
    return receiver === p1 || receiver === p2;
  }

  const seat = state?.you_seat;
  if (!seat) return false;
  const profile = seatProfile(table, seat);
  return Boolean(profile.playerId && String(profile.playerId) === receiver);
}

export function deriveSeatFlags(state: Partial<PoolState>): SeatFlags {
  const table = state?.table || {};
  if (table.game_over) {
    return { can_place_cue: false, can_fire_shot: false };
  }

  if (state?.mode === "pnp") {
    const bih = Boolean(table.ball_in_hand);
    return {
      can_place_cue: bih,
      can_fire_shot: true,
    };
  }

  const seat = state?.you_seat;
  if (!seat) {
    return { can_place_cue: false, can_fire_shot: false };
  }

  const profile = seatProfile(table, seat);
  const myId = String(profile.playerId || "");
  const currentId = String(table.current_player_id || "");
  const myTurn = Boolean(myId && currentId === myId);
  const receiver = isReceiver(state);

  if (table.ball_in_hand) {
    return {
      can_place_cue: receiver,
      can_fire_shot: receiver,
    };
  }

  return {
    can_place_cue: false,
    can_fire_shot: myTurn,
  };
}

export function mergeRemoteNextState(
  state: Partial<PoolState>,
  ns: Partial<PoolState>,
): PoolState {
  const table = ns?.table || state?.table || {};
  const youSeat = ns?.you_seat ?? state?.you_seat;
  const merged = {
    ...state,
    mode: ns?.mode ?? state?.mode,
    status: ns?.status ?? state?.status,
    table,
    you_seat: youSeat,
    stream_seq: ns?.stream_seq ?? state?.stream_seq,
    clock_a_ms: ns?.clock_a_ms ?? state?.clock_a_ms,
    clock_b_ms: ns?.clock_b_ms ?? state?.clock_b_ms,
    clock_active_color: ns?.clock_active_color ?? state?.clock_active_color,
    clock_anchor_iso: ns?.clock_anchor_iso ?? state?.clock_anchor_iso,
  };
  const flags = deriveSeatFlags(merged);
  return {
    ...merged,
    can_place_cue: flags.can_place_cue,
    can_fire_shot: flags.can_fire_shot,
  };
}
