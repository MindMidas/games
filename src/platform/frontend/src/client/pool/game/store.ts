import { ACTION } from "./contracts.js";
import type { PoolState, PoolStoreAction } from "./contracts.js";

export interface PoolStore {
  getState(): Partial<PoolState>;
  dispatch(action?: PoolStoreAction | null): Partial<PoolState>;
  subscribe(listener: ((state: Partial<PoolState>) => void) | unknown): () => void;
}

/** Hold the current personalized Pool snapshot and notify UI subscribers. */
export function createStore(initial: Partial<PoolState> = {}): PoolStore {
  let state: Partial<PoolState> = { ...initial };
  const listeners = new Set<(state: Partial<PoolState>) => void>();

  function getState(): Partial<PoolState> {
    return state;
  }

  function dispatch(action?: PoolStoreAction | null): Partial<PoolState> {
    if (!action?.type) return state;
    const payload = action.payload || {};
    switch (action.type) {
      case ACTION.HYDRATE: {
        const table = payload.table ?? state.table;
        let status = payload.status ?? state.status;
        if (table?.game_over && status === "active") status = "finished";
        state = {
          ...state,
          ...payload,
          status,
          you_seat: payload.you_seat ?? state.you_seat,
          table,
          can_place_cue: Boolean(payload.can_place_cue),
          can_fire_shot: Boolean(payload.can_fire_shot),
        };
        break;
      }
      case ACTION.SHOT_RESULT:
        state = {
          ...state,
          table: payload.table || state.table,
          can_place_cue: Boolean(payload.can_place_cue),
          can_fire_shot: Boolean(payload.can_fire_shot),
          stream_seq: payload.stream_seq ?? state.stream_seq,
          clock_a_ms: payload.clock_a_ms ?? state.clock_a_ms,
          clock_b_ms: payload.clock_b_ms ?? state.clock_b_ms,
          clock_active_color: payload.clock_active_color ?? state.clock_active_color,
          clock_anchor_iso: payload.clock_anchor_iso ?? state.clock_anchor_iso,
        };
        break;
      case ACTION.TERMINAL: {
        const table = payload.table || state.table;
        let status = payload.status || "finished";
        if (table?.game_over && status === "active") status = "finished";
        state = {
          ...state,
          ...payload,
          table,
          status,
          result: payload.result ?? state.result,
          game_id: payload.game_id ?? state.game_id,
          you_seat: payload.you_seat ?? state.you_seat,
          mode: payload.mode ?? state.mode,
          can_place_cue: false,
          can_fire_shot: false,
          clock_a_ms: payload.clock_a_ms ?? state.clock_a_ms,
          clock_b_ms: payload.clock_b_ms ?? state.clock_b_ms,
          clock_active_color: payload.clock_active_color ?? state.clock_active_color,
          clock_anchor_iso: payload.clock_anchor_iso ?? state.clock_anchor_iso,
        };
        break;
      }
      case ACTION.PROFILE_REFRESH:
        if (payload.table) state = { ...state, table: { ...state.table, ...payload.table } };
        break;
    }

    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        console.error("[pool/store] listener error:", error);
      }
    }
    return state;
  }

  function subscribe(listener: ((state: Partial<PoolState>) => void) | unknown): () => void {
    if (typeof listener !== "function") return () => {};
    const typedListener = listener as (state: Partial<PoolState>) => void;
    listeners.add(typedListener);
    return () => {
      listeners.delete(typedListener);
    };
  }

  return { getState, dispatch, subscribe };
}
