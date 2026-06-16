import { normalizeSquare } from "../features/gameplay/gameLogic.js";
import type { ClientGameState } from "./store.js";

const STORAGE_LAST_SEEN_KEY = "chezz.game.soundLastSeq";
const STORAGE_ENDGAME_KEY = "chezz.endgameFiredFor";

type ChezzSoundId = "move" | "capture" | "promotion" | "zombie" | "endgame";

interface OptimisticMoveSoundPair {
  from: string;
  to: string;
  soundId: "move" | "capture";
}

interface SoundMoveRow {
  seq?: number | string;
  from_?: string;
  to?: string;
  captured?: unknown[];
  spawned?: unknown[];
  transformed?: unknown[];
  kind?: string;
  notation?: string;
}

interface SoundStore {
  getState(): ClientGameState | null;
  subscribe(listener: (state: ClientGameState | null) => void): () => void;
}

interface SoundBusDeps {
  store: SoundStore;
  playGameSound: (id: ChezzSoundId) => void;
  endgameDelay?: number;
}

/** When set, the next new history row matching this quiet slide skips bus SFX (already played on drop). */
let optimisticMoveSoundPair: OptimisticMoveSoundPair | null = null;

/** When true, the next catapult fling animation should skip its fling sound (already played on submit). */
let flingSoundPrimed = false;

function loadLastSeenSeq(gameId: string): number {
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_LAST_SEEN_KEY}:${gameId || ""}`);
    if (raw === null || raw === undefined || raw === "") {
      return -1;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : -1;
  } catch {
    return -1;
  }
}

function storeLastSeenSeq(gameId: string, seq: number): void {
  try {
    window.sessionStorage.setItem(`${STORAGE_LAST_SEEN_KEY}:${gameId || ""}`, String(seq));
  } catch {
    /* ignore */
  }
}

function loadEndgameSet(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_ENDGAME_KEY);
    const arr = JSON.parse(raw || "[]");
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function storeEndgameSet(set: Set<string>): void {
  try {
    window.sessionStorage.setItem(STORAGE_ENDGAME_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function classifyMoveSound(row: SoundMoveRow | null | undefined): Exclude<ChezzSoundId, "endgame"> | "" {
  if (!row) {
    return "";
  }
  const captured = Array.isArray(row.captured) ? row.captured : [];
  const spawned = Array.isArray(row.spawned) ? row.spawned : [];
  const transformed = Array.isArray(row.transformed) ? row.transformed : [];
  const kind = String(row.kind || row.notation || "").toLowerCase();
  if (spawned.some((p: unknown) => /^[wb]Z$/.test(String(p || "")))) {
    return "zombie";
  }
  if (kind.includes("shoot") || kind.includes("shot") || kind.includes("fling")) {
    return "";
  }
  if (captured.length > 0) {
    return "capture";
  }
  if (transformed.length > 0) {
    return "promotion";
  }
  return "move";
}

export function primeOptimisticMoveSoundPair(
  fromSq: string,
  toSq: string,
  soundId: "move" | "capture" = "move",
): void {
  const from = normalizeSquare(fromSq);
  const to = normalizeSquare(toSq);
  optimisticMoveSoundPair = from && to ? { from, to, soundId } : null;
}

export function clearOptimisticMoveSoundPair(): void {
  optimisticMoveSoundPair = null;
}

export function primeFlingSound(): void {
  flingSoundPrimed = true;
}

export function shouldPlayFlingSound(): boolean {
  if (flingSoundPrimed) {
    flingSoundPrimed = false;
    return false;
  }
  return true;
}

function rowMatchesOptimisticMoveSoundPair(row: SoundMoveRow | null | undefined): boolean {
  if (!optimisticMoveSoundPair || !row) {
    return false;
  }
  const busSound = classifyMoveSound(row);
  if (!busSound) {
    return false;
  }
  // the primed soundId must match what the bus would play for this row.
  // this prevents a non-capture prime from silencing a capture row and vice-versa.
  if (busSound !== optimisticMoveSoundPair.soundId) {
    return false;
  }
  const rf = normalizeSquare(row.from_);
  const rt = normalizeSquare(row.to);
  return rf === optimisticMoveSoundPair.from && rt === optimisticMoveSoundPair.to;
}

export function createSoundBus({ store, playGameSound, endgameDelay = 600 }: SoundBusDeps) {
  const endgameFiredFor = loadEndgameSet();
  let lastSeenSeq = -1;
  let currentGameId = "";
  let unsubscribe: (() => void) | null = null;
  let endgameTimer: number | null = null;

  function syncToGame(state: ClientGameState | null): void {
    const gameId = String(state?.game_id || "");
    if (gameId && gameId !== currentGameId) {
      currentGameId = gameId;
      lastSeenSeq = loadLastSeenSeq(gameId);
    }
  }

  function onChange(state: ClientGameState | null): void {
    if (!state) {
      return;
    }
    syncToGame(state);
    const history = Array.isArray(state.move_history) ? state.move_history as SoundMoveRow[] : [];
    for (const row of history) {
      const seq = Number(row?.seq);
      if (!Number.isFinite(seq)) {
        continue;
      }
      if (seq <= lastSeenSeq) {
        continue;
      }
      const soundId = classifyMoveSound(row);
      if (!soundId) {
        continue;
      }
      if (rowMatchesOptimisticMoveSoundPair(row)) {
        optimisticMoveSoundPair = null;
        lastSeenSeq = seq;
        continue;
      }
      optimisticMoveSoundPair = null;
      try { playGameSound(soundId); } catch { /* ignore */ }
      lastSeenSeq = seq;
    }
    if (Number.isFinite(lastSeenSeq) && currentGameId) {
      storeLastSeenSeq(currentGameId, lastSeenSeq);
    }
    if (
      state.status === "finished"
      && !state.animationPending
      && !state.pendingTerminal
      && currentGameId
      && !endgameFiredFor.has(currentGameId)
    ) {
      endgameFiredFor.add(currentGameId); // avoid duplicate scheduling before delayed fire
      storeEndgameSet(endgameFiredFor);
      const fire = () => { try { playGameSound("endgame"); } catch { /* ignore */ } };
      if (endgameDelay > 0) {
        if (endgameTimer != null) {
          window.clearTimeout(endgameTimer);
        }
        endgameTimer = window.setTimeout(() => {
          endgameTimer = null;
          fire();
        }, endgameDelay);
      } else {
        fire();
      }
    }
  }

  function start(): void {
    if (unsubscribe) {
      return;
    }
    const initial = store.getState();
    if (initial) syncToGame(initial);
    unsubscribe = store.subscribe(onChange);
  }

  function stop(): void {
    if (endgameTimer != null) {
      window.clearTimeout(endgameTimer);
      endgameTimer = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  return { start, stop };
}
