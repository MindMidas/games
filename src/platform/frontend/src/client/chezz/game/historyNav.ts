import { ACTION } from "./contracts.js";
import { isGameTerminalForHistory } from "./historyView.js";
import type { AnimationEvent, EngineBoard } from "./contracts.js";
import type { HistoryRow } from "./historyMeta.js";
import type { ClientGameState } from "./store.js";

const EVT_MOVE = 2;

type CapturedByColor = { w: string[]; b: string[] };
type ReplaySnapshot = Partial<EngineBoard> & {
  header?: Partial<EngineBoard["header"]>;
  board?: Record<string, string>;
};
type ReplayEntry = {
  snapshot?: ReplaySnapshot | null;
  events?: AnimationEvent[] | null;
};
type ReplayPayload = {
  game_id?: string;
  entries?: ReplayEntry[];
  live_index?: number;
};
type HistoryStore = {
  getState: () => ClientGameState | null;
  dispatch: (action: { type?: string; payload?: unknown }) => void;
};
type HistoryRenderer = {
  renderAll: (state: ClientGameState, options: {
    historyActiveRow: number;
    fullMoveHistory: HistoryRow[] | null;
    outcomeState: ClientGameState;
    showOutcome: boolean;
    suppressGameOver: boolean;
    suppressTurnHighlight: boolean;
  }) => void;
};
type HistoryAnimator = {
  enqueueReplay: (payload: {
    animation_events: AnimationEvent[];
    nextState: ClientGameState;
    fast: boolean;
    onComplete: () => void;
  }) => void;
  cancel: () => void;
  primitiveBusy: () => boolean;
};
type HistoryHttp = {
  loadReplay: (gameId: string, options: { includeEvents: boolean }) => Promise<ReplayPayload>;
};
type HistoryDeps = {
  store: HistoryStore;
  render: HistoryRenderer;
  animator: HistoryAnimator;
  http: HistoryHttp;
  gameId: string;
  notify?: (message: unknown, isError?: boolean) => void;
  onShellSync?: (() => void) | null;
  paintShell?: (() => void) | null;
};
type HardStopOptions = { commitPendingReplay?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function errorStatus(error: unknown): number {
  return Number(isRecord(error) ? error.status : NaN);
}

function capturedAfterPlies(rows: HistoryRow[], exclusiveEnd: number): CapturedByColor {
  const cap: CapturedByColor = { w: [], b: [] };
  const n = Math.max(0, Math.min(exclusiveEnd, rows.length));
  for (let i = 0; i < n; i++) {
    for (const captured of rows[i]?.captured || []) {
      const code = String(captured || "");
      const color = code[0]?.toLowerCase();
      if (color === "w" || color === "b") {
        cap[color].push(code);
      }
    }
  }
  return cap;
}

function stateProbeForReplay(entry: ReplayEntry | undefined, baseState: ClientGameState | null): ClientGameState {
  const snap = entry?.snapshot || {};
  const header = snap.header as Partial<EngineBoard["header"]> | undefined;
  return {
    ...baseState,
    current_turn: header?.turn || baseState?.current_turn || "w",
    board: {
      ...(baseState?.board || {}),
      ...snap,
      board: snap.board || baseState?.board?.board || {},
    },
  } as ClientGameState;
}

function buildReverseMoveEvents(events: AnimationEvent[] | null | undefined): AnimationEvent[] {
  if (!Array.isArray(events)) {
    return [];
  }
  const reversed: AnimationEvent[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (Number(event?.type) !== EVT_MOVE) {
      continue;
    }
    const from = String(event.from_square || "");
    const to = String(event.to_square || "");
    const piece = String(event.piece || event.from_piece || "");
    if (!from || !to || !piece) {
      continue;
    }
    reversed.push({
      ...event,
      type: EVT_MOVE,
      from_square: to,
      to_square: from,
      piece,
    });
  }
  return reversed;
}

export function createHistoryNav({
  store,
  render,
  animator,
  http,
  gameId,
  notify = () => {},
  onShellSync = null,
  paintShell = null,
}: HistoryDeps) {
  let activeGameId = String(gameId || "").trim();
  let replayFetchGen = 0;
  let replayDisabled = false;
  let replay: { entries: ReplayEntry[]; live_index: number } | null = null;
  let exploreIndex = 0;
  let followLive = true;
  let suppressRender = false;
  let pendingExploreAfterReplay: number | null = null;
  let replayNavGen = 0;
  let uiUnsubs: Array<() => void> = [];

  function isAtLiveTail(): boolean {
    if (!replay || !Number.isFinite(replay.live_index)) {
      return true;
    }
    return exploreIndex === replay.live_index;
  }

  function shouldSuppressRender(): boolean {
    return suppressRender;
  }

  function shouldSuppressGameOver(): boolean {
    if (!replay) return false;
    if (!isAtLiveTail()) return true;
    if (!followLive) return true;
    return pendingExploreAfterReplay != null;
  }

  function shouldShowOutcome(): boolean {
    const state = store.getState();
    return Boolean(state && isGameTerminalForHistory(state));
  }

  function exploreAnchorIndex(): number {
    return pendingExploreAfterReplay != null ? pendingExploreAfterReplay : exploreIndex;
  }

  function ensureNavUnblocked(): void {
    suppressRender = false;
    pendingExploreAfterReplay = null;
  }

  function snapExploreIndex(targetIdx: number): void {
    if (!replay) {
      return;
    }
    exploreIndex = Math.max(0, Math.min(targetIdx, replay.live_index));
    followLive = exploreIndex >= replay.live_index;
    ensureNavUnblocked();
    paint();
  }

  function animateOneReplayStep(fromIdx: number, toIdx: number): void {
    if (!replay || toIdx === fromIdx) {
      return;
    }
    const forward = toIdx > fromIdx;
    const events = forward
      ? replay.entries[toIdx]?.events || []
      : buildReverseMoveEvents(replay.entries[fromIdx]?.events);
    if (!events.length) {
      snapExploreIndex(toIdx);
      return;
    }

    const nextState = stateProbeForReplay(replay.entries[toIdx], store.getState());
    ensureNavUnblocked();
    suppressRender = true;
    pendingExploreAfterReplay = toIdx;
    const epoch = ++replayNavGen;
    animator.enqueueReplay({
      animation_events: events,
      nextState,
      fast: true,
      onComplete: () => {
        if (epoch !== replayNavGen) {
          return;
        }
        ensureNavUnblocked();
        exploreIndex = toIdx;
        paint();
      },
    });
    updateNavButtons();
  }

  function canGoPrev(): boolean {
    return Boolean(replay && exploreAnchorIndex() > 0);
  }

  function canGoNext(): boolean {
    return Boolean(replay && exploreAnchorIndex() < Number(replay.live_index || 0));
  }

  function updateNavButtons(): void {
    const prevOn = canGoPrev();
    const nextOn = canGoNext();
    for (const id of ["history-prev-btn", "history-prev-mobile"]) {
      const el = document.getElementById(id);
      if (el instanceof HTMLButtonElement) {
        el.disabled = !prevOn;
      }
    }
    for (const id of ["history-next-btn", "history-next-mobile"]) {
      const el = document.getElementById(id);
      if (el instanceof HTMLButtonElement) {
        el.disabled = !nextOn;
      }
    }
  }

  function activeHistoryRowIndex(): number {
    if (!replay) {
      return -1;
    }
    const liveIdx = Number(replay.live_index) || 0;
    if (exploreIndex >= liveIdx) {
      const rows = store.getState()?.move_history || [];
      return rows.length ? rows.length - 1 : -1;
    }
    return exploreIndex;
  }

  function mergeForRender(state: ClientGameState): ClientGameState {
    if (!state || !replay || !Array.isArray(replay.entries)) {
      return state;
    }
    const liveIdx = Number(replay.live_index) || 0;
    if (exploreIndex === liveIdx) {
      return state;
    }

    const entry = replay.entries[exploreIndex];
    const snap = entry?.snapshot;
    if (!entry || !snap || typeof snap !== "object") {
      return state;
    }

    const fullHistory = Array.isArray(state.move_history) ? state.move_history as HistoryRow[] : [];
    const header = snap.header as Partial<EngineBoard["header"]> | undefined;
    const merged: ClientGameState = {
      ...state,
      board: { ...(state.board || {}), ...snap, board: snap.board || {} },
      current_turn: header?.turn || state.current_turn,
      move_number: Number.isFinite(header?.num_moves) ? Number(header?.num_moves) : state.move_number,
      move_history: fullHistory.slice(0, exploreIndex),
      captured: capturedAfterPlies(fullHistory, exploreIndex),
      animationPending: false,
    };
    if (merged.status === "finished") {
      merged.status = "active";
    }
    if (merged.result && typeof merged.result === "object") {
      merged.result = { ...merged.result, status: "active" };
    }
    return merged;
  }

  function paint(): void {
    if (typeof paintShell === "function") {
      paintShell();
      updateNavButtons();
      return;
    }
    const state = store.getState();
    if (!state) {
      return;
    }
    const merged = mergeForRender(state);
    const terminal = state.status === "finished"
      || (state.result && ["finished", "draw"].includes(String(state.result.status || "")));
    render.renderAll(merged, {
      historyActiveRow: activeHistoryRowIndex(),
      fullMoveHistory: Array.isArray(state.move_history) ? state.move_history as HistoryRow[] : null,
      outcomeState: state,
      showOutcome: shouldShowOutcome(),
      suppressGameOver: shouldSuppressGameOver(),
      suppressTurnHighlight: shouldSuppressGameOver() || Boolean(terminal),
    });
    updateNavButtons();
    try {
      onShellSync?.();
    } catch {
      /* noop */
    }
  }

  function hardStopAnimations(opts: HardStopOptions = {}): void {
    const commit = opts.commitPendingReplay === true;
    replayNavGen += 1;
    suppressRender = false;
    animator.cancel();
    if (commit && pendingExploreAfterReplay != null) {
      exploreIndex = pendingExploreAfterReplay;
    }
    pendingExploreAfterReplay = null;
    const state = store.getState();
    if (state?.animationPending) {
      try {
        store.dispatch({ type: ACTION.ANIMATION_DONE });
      } catch {
        /* noop */
      }
    }
    updateNavButtons();
  }

  async function refreshReplay({ snapTail = false }: { snapTail?: boolean } = {}): Promise<void> {
    if (replayDisabled || !activeGameId) {
      return;
    }
    const gid = activeGameId;
    const gen = ++replayFetchGen;
    try {
      const data = await http.loadReplay(gid, { includeEvents: true });
      if (gen !== replayFetchGen || gid !== activeGameId) return;
      if (!data || !Array.isArray(data.entries)) return;
      const respId = String(data.game_id || gid).trim();
      if (respId && respId !== gid) return;
      replay = { entries: data.entries, live_index: Number(data.live_index) || 0 };
      exploreIndex = Math.max(0, Math.min(exploreIndex, replay.live_index));
      if (snapTail) {
        exploreIndex = replay.live_index;
      }
    } catch (err) {
      if (gen !== replayFetchGen || gid !== activeGameId) return;
      const status = errorStatus(err);
      const msg = errorMessage(err).toLowerCase();
      if (status === 404 || msg.includes("game not found")) {
        replayDisabled = true;
        replay = null;
        return;
      }
      notify(`Replay refresh failed: ${errorMessage(err)}`, true);
    }
  }

  async function init(): Promise<void> {
    await refreshReplay({ snapTail: true });
    paint();
  }

  async function onGameEnded(): Promise<void> {
    pendingExploreAfterReplay = null;
    hardStopAnimations({ commitPendingReplay: false });
    await refreshReplay({ snapTail: followLive });
    paint();
  }

  function onLiveMoveCommitted(): void {
    const wasAtLiveTail =
      Boolean(replay && Number.isFinite(replay.live_index) && exploreIndex === replay.live_index);
    const snapToNewTail = followLive || wasAtLiveTail;
    void refreshReplay({ snapTail: snapToNewTail }).then(() => {
      if (snapToNewTail) {
        followLive = true;
      }
      paint();
      if (snapToNewTail) {
        queueMicrotask(() => {
          document
            .getElementById("history-list")
            ?.querySelector(".history-line-active")
            ?.scrollIntoView({ block: "nearest" });
        });
      }
    });
  }

  function goLive(): void {
    hardStopAnimations({ commitPendingReplay: false });
    followLive = true;
    if (replay) {
      exploreIndex = replay.live_index;
    }
    paint();
    document
      .getElementById("history-list")
      ?.querySelector(".history-line-active")
      ?.scrollIntoView({ block: "nearest" });
  }

  function goRow(rowIndex: number): void {
    hardStopAnimations({ commitPendingReplay: true });
    if (!replay) {
      return;
    }
    followLive = false;
    snapExploreIndex(rowIndex);
  }

  function goNext(): void {
    if (!replay) {
      return;
    }
    const liveIdx = Number(replay.live_index || 0);
    if (suppressRender || animator.primitiveBusy()) {
      hardStopAnimations({ commitPendingReplay: true });
      if (exploreIndex < liveIdx) {
        snapExploreIndex(exploreIndex + 1);
      }
      return;
    }
    hardStopAnimations({ commitPendingReplay: false });
    if (exploreIndex >= liveIdx) {
      return;
    }
    followLive = false;
    animateOneReplayStep(exploreIndex, exploreIndex + 1);
  }

  function goPrev(): void {
    if (!replay || exploreIndex <= 0) {
      return;
    }
    if (suppressRender || animator.primitiveBusy()) {
      hardStopAnimations({ commitPendingReplay: true });
      if (exploreIndex > 0) {
        snapExploreIndex(exploreIndex - 1);
      }
      return;
    }
    hardStopAnimations({ commitPendingReplay: false });
    followLive = false;
    animateOneReplayStep(exploreIndex, exploreIndex - 1);
  }

  function bindUi(): void {
    unbindUi();
    const prevBtn = document.getElementById("history-prev-btn");
    const nextBtn = document.getElementById("history-next-btn");
    const liveBtn = document.getElementById("history-live-btn");
    const prevMobile = document.getElementById("history-prev-mobile");
    const nextMobile = document.getElementById("history-next-mobile");
    const liveMobile = document.getElementById("history-live-mobile");
    const list = document.getElementById("history-list");
    const onPrev = () => goPrev();
    const onNext = () => goNext();
    const onLive = () => goLive();
    const onListClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest(".history-line");
      if (!row || !list?.contains(row)) {
        return;
      }
      const idx = Number((row as HTMLElement).dataset.moveIndex);
      if (Number.isFinite(idx)) {
        goRow(idx);
      }
    };
    prevBtn?.addEventListener("click", onPrev);
    nextBtn?.addEventListener("click", onNext);
    liveBtn?.addEventListener("click", onLive);
    prevMobile?.addEventListener("click", onPrev);
    nextMobile?.addEventListener("click", onNext);
    liveMobile?.addEventListener("click", onLive);
    list?.addEventListener("click", onListClick);

    uiUnsubs = [
      () => prevBtn?.removeEventListener("click", onPrev),
      () => nextBtn?.removeEventListener("click", onNext),
      () => liveBtn?.removeEventListener("click", onLive),
      () => prevMobile?.removeEventListener("click", onPrev),
      () => nextMobile?.removeEventListener("click", onNext),
      () => liveMobile?.removeEventListener("click", onLive),
      () => list?.removeEventListener("click", onListClick),
    ];
  }

  function unbindUi(): void {
    if (!uiUnsubs.length) {
      return;
    }
    for (const fn of uiUnsubs) {
      try {
        fn();
      } catch {
        /* noop */
      }
    }
    uiUnsubs = [];
  }

  function setGameId(id: string | number): void {
    activeGameId = String(id || "").trim();
    replayFetchGen += 1;
    replayDisabled = false;
    replay = null;
    exploreIndex = 0;
    followLive = true;
    pendingExploreAfterReplay = null;
    hardStopAnimations({ commitPendingReplay: false });
    const list = document.getElementById("history-list");
    if (list) {
      list.innerHTML = "";
    }
  }

  return {
    init,
    mergeForRender,
    activeHistoryRowIndex,
    shouldSuppressRender,
    shouldSuppressGameOver,
    shouldShowOutcome,
    isAtLiveTail,
    onLiveMoveCommitted,
    onGameEnded,
    bindUi,
    unbindUi,
    paint,
    setGameId,
    teardown: () => {
      unbindUi();
      setGameId("");
    },
    hardStopAnimations,
  };
}
