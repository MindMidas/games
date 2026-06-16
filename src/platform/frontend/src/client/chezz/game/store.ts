import { ACTION } from "./contracts.js";
import type { AnimationEvent, GameResult, GameState, MoveAccepted } from "./contracts.js";

interface PendingLastMove {
  from: string;
  to: string;
  payload: string | null;
}

interface PendingAnimation {
  move: Record<string, unknown> | null;
  animation_events: AnimationEvent[];
  last_move_seq: number;
  boardBefore?: { board: Record<string, string> };
  optimistic?: boolean;
  ownMoveVisual?: boolean;
  pendingLastMove?: PendingLastMove | null;
}

interface PendingTerminal {
  result: GameResult | null;
  next: ClientGameState | null;
}

export type ClientGameState = GameState & {
  animationPending?: boolean;
  pendingAnimation?: PendingAnimation | null;
  pendingTerminal?: PendingTerminal | null;
  self_user_id?: string | null;
};

interface StoreAction {
  type?: string;
  payload?: unknown;
}

type StoreListener = (state: ClientGameState | null) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPendingLastMove(value: unknown): value is PendingLastMove {
  return isRecord(value)
    && typeof value.from === "string"
    && typeof value.to === "string"
    && (typeof value.payload === "string" || value.payload === null);
}

function pendingLastMoveFromMove(move: unknown): PendingLastMove | null {
  if (!isRecord(move)) {
    return null;
  }
  const kind = String(move.kind || "move").toLowerCase();
  if (kind === "fling") {
    const from = String(move.catapult || "").toLowerCase().trim();
    const to = String(move.target || "").toLowerCase().trim();
    const payload = String(move.payload || "").toLowerCase().trim() || null;
    return from || to ? { from, to, payload } : null;
  }
  if (kind === "shoot") {
    const sq = String(move.square || "").toLowerCase().trim();
    return sq ? { from: sq, to: sq, payload: null } : null;
  }
  const from = String(move.from || move.from_ || "").toLowerCase().trim();
  const to = String(move.to || "").toLowerCase().trim();
  return from || to ? { from, to, payload: null } : null;
}

function reducer(state: ClientGameState | null, action: StoreAction): ClientGameState | null {
  switch (action.type) {
    case ACTION.HYDRATE: {
      const next = isRecord(action.payload) ? action.payload as unknown as ClientGameState : null;
      if (!next) {
        return null;
      }
      return {
        ...next,
        animationPending: false,
        pendingAnimation: null,
        pendingTerminal: null,
      };
    }

    case ACTION.OPTIMISTIC_ANIMATION: {
      if (!state) {
        return state;
      }
      const payload = isRecord(action.payload) ? action.payload : {};
      const boardBefore =
        state.board && typeof state.board.board === "object"
          ? { board: { ...state.board.board } }
          : { board: {} };
      return {
        ...state,
        animationPending: true,
        pendingAnimation: {
          move: null,
          animation_events: [],
          last_move_seq: Number.isFinite(state.stream_seq) ? state.stream_seq : -1,
          boardBefore,
          optimistic: true,
          pendingLastMove: isPendingLastMove(payload.pendingLastMove) ? payload.pendingLastMove : null,
        },
      };
    }

    case ACTION.OPTIMISTIC_BOARD_PATCH: {
      if (!state?.pendingAnimation?.boardBefore?.board) {
        return state;
      }
      const payload = isRecord(action.payload) ? action.payload : {};
      const from = String(payload.from || "").toLowerCase().trim();
      const to = String(payload.to || "").toLowerCase().trim();
      const board = { ...state.pendingAnimation.boardBefore.board };
      const piece = String(payload.piece || board[from] || "");
      if (!from || !to || !piece) {
        return state;
      }
      delete board[from];
      if (payload.capture) {
        delete board[to];
      }
      board[to] = piece;
      return {
        ...state,
        pendingAnimation: {
          ...state.pendingAnimation,
          boardBefore: { board },
        },
      };
    }

    case ACTION.OPTIMISTIC_CANCEL: {
      if (!state?.pendingAnimation?.optimistic) {
        return state;
      }
      return {
        ...state,
        animationPending: false,
        pendingAnimation: null,
      };
    }

    case ACTION.MOVE_ACCEPTED: {
      if (!state) {
        return state;
      }
      const evt = isRecord(action.payload) ? action.payload as unknown as MoveAccepted : null;
      if (!evt) {
        return state;
      }
      const nextState = evt.next_state || null;
      if (!nextState) {
        return state;
      }
      const wasOptimistic = Boolean(state.pendingAnimation?.optimistic);
      const optimisticBoardBefore = wasOptimistic
        ? state.pendingAnimation?.boardBefore
        : null;
      const boardBefore = optimisticBoardBefore
        || (state.board && typeof state.board.board === "object"
          ? { board: { ...state.board.board } }
          : { board: {} });
      const pendingLastMove = state.pendingAnimation?.pendingLastMove
        || pendingLastMoveFromMove(evt.move);
      const resultStatus = String(nextState?.result?.status || "");
      const isTerminal =
        nextState.status === "finished" || resultStatus === "finished" || resultStatus === "draw";
      return {
        ...state,
        ...nextState,
        you_color: state.you_color,
        self_user_id: state.self_user_id,
        players: state.players,
        mode: state.mode,
        pendingAnimation: {
          move: evt.move || null,
          animation_events: Array.isArray(evt.animation_events)
            ? evt.animation_events
            : [],
          last_move_seq: Number(evt.last_move_seq) || Number(nextState.stream_seq) || 0,
          boardBefore,
          optimistic: false,
          ownMoveVisual: wasOptimistic,
          pendingLastMove,
        },
        animationPending: true,
        status: isTerminal ? state.status : nextState.status,
        result: isTerminal ? state.result : nextState.result,
        pendingTerminal: isTerminal
          ? { result: nextState.result || null, next: nextState }
          : null,
      };
    }

    case ACTION.ANIMATION_DONE: {
      if (!state) {
        return state;
      }
      const pt = state.pendingTerminal || null;
      const next = pt?.next || state;
      const rs = next?.result && String(next.result.status || "");
      const nextSignalsDone =
        next.status === "finished" || rs === "finished" || rs === "draw";
      const isTerminal = nextSignalsDone || Boolean(pt);
      return {
        ...state,
        ...(pt?.next || {}),
        you_color: state.you_color,
        self_user_id: state.self_user_id,
        players: state.players,
        mode: state.mode,
        status: isTerminal ? "finished" : (next.status || state.status),
        result: isTerminal ? (pt?.result || next.result || state.result) : (next.result || state.result),
        pendingAnimation: null,
        animationPending: false,
        pendingTerminal: null,
      };
    }

    case ACTION.TERMINAL: {
      if (!state) {
        return state;
      }
      const payload = isRecord(action.payload) ? action.payload : {};
      const next = isRecord(payload.next_state) ? payload.next_state as unknown as ClientGameState : null;
      const result = isRecord(payload.result) ? payload.result as unknown as GameResult : null;
      if (state.animationPending) {
        return {
          ...state,
          pendingTerminal: {
            result: result || next?.result || null,
            next,
          },
        };
      }
      return {
        ...(state),
        ...(next || {}),
        you_color: state.you_color,
        self_user_id: state.self_user_id,
        players: state.players,
        mode: state.mode,
        status: "finished",
        result: result || next?.result || state.result || null,
        pendingAnimation: null,
        animationPending: false,
        pendingTerminal: null,
      };
    }

    case ACTION.RESET:
      return null;

    case ACTION.PROFILE_REFRESH: {
      if (!state || !isRecord(action.payload) || !isRecord(action.payload.players)) {
        return state;
      }
      return { ...state, players: action.payload.players as GameState["players"] };
    }

    default:
      return state;
  }
}

export function createStore(initialState: ClientGameState | null = null) {
  let state = initialState;
  const listeners = new Set<StoreListener>();

  function getState(): ClientGameState | null {
    return state;
  }

  function dispatch(action: StoreAction): void {
    if (!action || typeof action !== "object" || !action.type) {
      return;
    }
    state = reducer(state, action);
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error("[chezz/store] listener error:", err);
      }
    }
  }

  function subscribe(listener: StoreListener): () => void {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return { getState, dispatch, subscribe };
}
