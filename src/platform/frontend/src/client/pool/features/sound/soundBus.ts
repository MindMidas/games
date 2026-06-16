import type { PoolState } from "../../game/contracts.js";
import type { PoolSoundId } from "./controller.js";

const STORAGE_ENDGAME_KEY = "pool.endgameFiredFor";

interface PoolStateStore {
  getState(): Partial<PoolState> | null | undefined;
  subscribe(listener: (state: Partial<PoolState>) => void): () => void;
}

interface SoundBusDependencies {
  store: PoolStateStore;
  playGameSound(id: PoolSoundId): void;
  endgameDelay?: number;
}

function loadEndgameSet(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_ENDGAME_KEY);
    const values: unknown = JSON.parse(raw || "[]");
    return new Set(Array.isArray(values) ? values.map(String) : []);
  } catch {
    return new Set();
  }
}

function storeEndgameSet(values: Set<string>): void {
  try {
    window.sessionStorage.setItem(STORAGE_ENDGAME_KEY, JSON.stringify([...values]));
  } catch {
    /* Storage may be unavailable in restricted browser contexts. */
  }
}

function isTerminalState(state: Partial<PoolState>): boolean {
  return state.status === "finished" || state.status === "draw" || Boolean(state.table?.game_over);
}

/** Play the endgame sound once per game after the final animation delay. */
export function createSoundBus({
  store,
  playGameSound,
  endgameDelay = 600,
}: SoundBusDependencies) {
  const endgameFiredFor = loadEndgameSet();
  let currentGameId = "";
  let unsubscribe: (() => void) | null = null;
  let endgameTimer: number | null = null;

  function onChange(state: Partial<PoolState>): void {
    const gameId = String(state.game_id || "");
    if (gameId && gameId !== currentGameId) currentGameId = gameId;
    if (!currentGameId || !isTerminalState(state) || endgameFiredFor.has(currentGameId)) return;

    endgameFiredFor.add(currentGameId);
    storeEndgameSet(endgameFiredFor);

    const fire = (): void => {
      try {
        playGameSound("endgame");
      } catch {
        /* Audio failures must not interrupt gameplay. */
      }
    };
    if (endgameDelay <= 0) {
      fire();
      return;
    }
    if (endgameTimer != null) window.clearTimeout(endgameTimer);
    endgameTimer = window.setTimeout(() => {
      endgameTimer = null;
      fire();
    }, endgameDelay);
  }

  function start(): void {
    if (unsubscribe) return;
    const initial = store.getState();
    if (initial) onChange(initial);
    unsubscribe = store.subscribe(onChange);
  }

  function stop(): void {
    if (endgameTimer != null) {
      window.clearTimeout(endgameTimer);
      endgameTimer = null;
    }
    unsubscribe?.();
    unsubscribe = null;
  }

  return { start, stop };
}
