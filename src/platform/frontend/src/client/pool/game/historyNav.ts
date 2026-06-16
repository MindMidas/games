import { isGameTerminalForShell } from "../../platform/features/gameplay/syncGameShell.js";
import { loadReplay } from "./http.js";
import { applyTableState } from "./render.js";
import { renderShotHistoryList } from "./historyView.js";
import {
  activeShotRowIndex,
  canStepBackInReplay,
  entryIndexForShotRow,
  isShotEntry,
  needsTrajectoryPreShotPatch,
  prevStepExploreTarget,
  resolvePreShotTable,
  shotAnimationStartIndex,
  shotEntryToPlayFrom,
  shotRowCount,
  shotStartEntryIndex,
} from "./shotHistory.js";
import { playShotVisuals } from "../features/gameplay/poolShotPipeline.js";
import {
  applyTrajectorySampleToTable,
  cancelTrajectory,
  clearGlobalCueOverlay,
  waitForPoolArenaLayout,
} from "./trajectory.js";
import type { PoolReplay, PoolState, PoolTable } from "./contracts.js";

interface HistoryNavDependencies {
  getState(): Partial<PoolState>;
  gameId: string;
  notify?: (message: string, isError?: boolean) => void;
  onTableRefresh?: (() => void) | null;
  onShellSync?: (() => void) | null;
}

interface RefreshTableOptions {
  suppressInputRefresh?: boolean;
}

interface RefreshReplayOptions {
  snapTail?: boolean;
}

interface StopAnimationsOptions {
  commitPending?: boolean;
}

export function createHistoryNav({
  getState,
  gameId,
  notify = () => {},
  onTableRefresh = null,
  onShellSync = null,
}: HistoryNavDependencies) {
  let activeGameId = String(gameId || "").trim();
  let replayDisabled = false;
  let replay: PoolReplay | null = null;
  let exploreIndex = 0;
  let followLive = true;
  let animToken = 0;
  let replayBusy = false;
  let replayEpoch = 0;
  /** Serialize Next presses so replay sounds and trajectories never overlap. */
  let replayChain = Promise.resolve();
  /** Keep controls anchored to the destination while a replay step is in flight. */
  let pendingExploreIndex: number | null = null;
  let uiUnsubs: Array<() => void> = [];

  function liveIndex(): number {
    return Number(replay?.live_index) || 0;
  }

  function isAtLiveTail(): boolean {
    if (!replay || !Number.isFinite(replay.live_index)) return true;
    return exploreIndex === replay.live_index;
  }

  function activeHistoryRowIndex(): number {
    if (!replay) return -1;
    return activeShotRowIndex(replay.entries, exploreIndex, liveIndex());
  }

  function tableFromEntry(index: number): PoolTable | null {
    const entry = replay?.entries?.[index];
    const snap = entry?.snapshot;
    return snap && typeof snap === "object" ? snap : null;
  }

  function terminalSnapshotFromReplay(): PoolTable | null {
    const entries = replay?.entries;
    if (!Array.isArray(entries)) return null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const snap = entries[i]?.snapshot;
      if (snap && typeof snap === "object" && snap.game_over) return snap;
    }
    return null;
  }

  function asExploringState(
    state: Partial<PoolState>,
    table: PoolTable,
  ): Partial<PoolState> {
    if (!state || !table) return state;
    const exploring = { ...state, table };
    if (exploring.status === "finished" || exploring.status === "draw") {
      exploring.status = "active";
    }
    if (exploring.table && typeof exploring.table === "object") {
      exploring.table = {
        ...exploring.table,
        game_over: false,
        ball_in_hand: false,
        ball_in_hand_for_player_id: null,
      };
    }
    exploring.can_place_cue = false;
    exploring.can_fire_shot = false;
    return exploring;
  }

  function mergeForRender(state: Partial<PoolState>): Partial<PoolState> {
    if (!state || !replay || !Array.isArray(replay.entries)) return state;
    if (exploreIndex === liveIndex()) return state;
    const entries = replay.entries;
    const entry = entries[exploreIndex];
    const row = activeShotRowIndex(entries, exploreIndex, liveIndex());
    const shotIdx = entryIndexForShotRow(entries, row);

    if (shotIdx != null) {
      if (entry && isShotEntry(entry) && exploreIndex === shotIdx) {
        const postShot = tableFromEntry(exploreIndex);
        if (postShot) return asExploringState(state, postShot);
      }
      const preShot = resolvePreShotTable(entries, shotIdx);
      if (preShot) return asExploringState(state, preShot);
    }

    const table = tableFromEntry(exploreIndex);
    if (!table) return state;
    return asExploringState(state, table);
  }

  function applyPreShotDomPatchIfNeeded(): void {
    if (!replay || exploreIndex === liveIndex()) return;
    const row = activeShotRowIndex(replay.entries, exploreIndex, liveIndex());
    const shotIdx = entryIndexForShotRow(replay.entries, row);
    if (shotIdx == null) return;
    if (!needsTrajectoryPreShotPatch(replay.entries, shotIdx)) return;
    const sample0 = replay.entries[shotIdx]?.trajectory?.samples?.[0];
    applyTrajectorySampleToTable(sample0);
  }

  function shouldSuppressGameOver(): boolean {
    if (!replay) return false;
    if (!isAtLiveTail()) return true;
    if (!followLive) return true;
    if (pendingExploreIndex != null) return true;
    return false;
  }

  function refreshTableView(state: Partial<PoolState>, opts: RefreshTableOptions = {}): void {
    const exploring = !isAtLiveTail();
    applyTableState(state, {
      suppressGameOver: shouldSuppressGameOver(),
      suppressTurnHighlight: isGameTerminalForShell(getState() as never),
      forceTableSvg: exploring,
      syncLayout: true,
    });
    queueMicrotask(() => {
      applyPreShotDomPatchIfNeeded();
      if (!opts.suppressInputRefresh && typeof onTableRefresh === "function") {
        onTableRefresh();
      }
    });
  }

  function exploreAnchorIndex(): number {
    if (pendingExploreIndex != null) return pendingExploreIndex;
    return exploreIndex;
  }

  function canGoPrev(): boolean {
    if (!replay) return false;
    return canStepBackInReplay(replay.entries, exploreAnchorIndex(), liveIndex());
  }

  function canGoNext(): boolean {
    if (!replay) return false;
    return exploreAnchorIndex() < liveIndex();
  }

  function updateNavButtons(): void {
    const prevOn = canGoPrev();
    const nextOn = canGoNext();
    for (const id of ["history-prev-btn", "history-prev-mobile"]) {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (el) el.disabled = !prevOn;
    }
    for (const id of ["history-next-btn", "history-next-mobile"]) {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (el) el.disabled = !nextOn;
    }
  }

  function paintListOnly(): void {
    const atLive = isAtLiveTail();
    const merged = mergeForRender(getState());
    const authoritative = getState();
    const list = document.getElementById("history-list");
    const terminal = atLive ? terminalSnapshotFromReplay() : null;
    renderShotHistoryList(
      list,
      replay?.entries || [],
      activeHistoryRowIndex(),
      authoritative || merged,
      terminal,
      { showOutcome: atLive },
    );
    const pill = document.getElementById("pool-moves-pill");
    if (pill) {
      const n = shotRowCount(replay?.entries || []);
      const live = isAtLiveTail();
      pill.textContent = live ? `Moves: ${n}` : `Moves: ${activeHistoryRowIndex() + 1} / ${n}`;
    }
    updateNavButtons();
  }

  function paint({ updateTable = false }: { updateTable?: boolean } = {}): void {
    const live = isAtLiveTail();
    const merged = mergeForRender(getState());
    if (updateTable || !live) {
      refreshTableView(merged);
    }
    paintListOnly();
    try {
      onShellSync?.();
    } catch {
      /* noop */
    }
  }

  function hardStopAnimations(opts: StopAnimationsOptions = {}): void {
    const commit = opts.commitPending === true;
    animToken += 1;
    replayBusy = false;
    cancelTrajectory();
    clearGlobalCueOverlay();
    if (commit && pendingExploreIndex != null) {
      exploreIndex = pendingExploreIndex;
      syncExploreTable();
    }
    // always clear pending replay target on interruption; stale anchors can
    // leave Prev/Next disabled even though replay entries are still navigable.
    pendingExploreIndex = null;
    updateNavButtons();
  }

  function showPreShotForShot(shotIdx: number): void {
    const table = resolvePreShotTable(replay?.entries || [], shotIdx);
    if (!table) return;
    exploreIndex = shotAnimationStartIndex(replay?.entries || [], shotIdx);
    refreshTableView(asExploringState(getState(), table), { suppressInputRefresh: true });
  }

  function landOnShot(shotIdx: number): void {
    exploreIndex = shotIdx;
    pendingExploreIndex = null;
    if (isAtLiveTail()) {
      refreshTableView(getState());
    } else {
      const postShot = tableFromEntry(shotIdx);
      if (postShot) {
        refreshTableView(asExploringState(getState(), postShot));
      }
    }
    paintListOnly();
  }

  async function runReplayStep(shotIdx: number, token: number): Promise<void> {
    if (token !== animToken) return;

    replayBusy = true;
    updateNavButtons();
    try {
      const preIdx = shotAnimationStartIndex(replay?.entries || [], shotIdx);
      followLive = shotIdx >= liveIndex();
      exploreIndex = preIdx;
      pendingExploreIndex = shotIdx;
      paintListOnly();

      const traj = replay?.entries[shotIdx]?.trajectory;
      if (!traj?.samples?.length) {
        if (token !== animToken) return;
        showPreShotForShot(shotIdx);
        landOnShot(shotIdx);
        return;
      }

      showPreShotForShot(shotIdx);
      applyPreShotDomPatchIfNeeded();
      await new Promise<void>((resolve) => {
        queueMicrotask(() => resolve());
      });
      await waitForPoolArenaLayout();
      if (token !== animToken) return;

      clearGlobalCueOverlay();
      await playShotVisuals(traj);
      clearGlobalCueOverlay();

      if (token !== animToken) return;
      if (pendingExploreIndex === shotIdx) {
        landOnShot(shotIdx);
      }
    } finally {
      replayBusy = false;
      updateNavButtons();
    }
  }

  function syncExploreTable(): void {
    if (!replay) return;
    if (isAtLiveTail()) {
      refreshTableView(getState());
      return;
    }
    refreshTableView(mergeForRender(getState()));
  }
  async function refreshReplay({ snapTail = false }: RefreshReplayOptions = {}): Promise<void> {
    if (replayDisabled || !activeGameId) return;
    const epoch = replayEpoch;
    const gameId = activeGameId;
    try {
      const data = await loadReplay(gameId);
      if (epoch !== replayEpoch || gameId !== activeGameId) return;
      if (!data || !Array.isArray(data.entries)) return;
      const respId = String(data.game_id || gameId).trim();
      if (respId && respId !== gameId) return;
      const nextReplay: PoolReplay = {
        game_id: respId || gameId,
        entries: data.entries,
        live_index: Number(data.live_index) || 0,
      };
      replay = nextReplay;
      exploreIndex = Math.max(0, Math.min(exploreIndex, nextReplay.live_index));
      if (snapTail) exploreIndex = nextReplay.live_index;
    } catch (error: unknown) {
      if (epoch !== replayEpoch || gameId !== activeGameId) return;
      const knownError = error as { status?: unknown; message?: unknown };
      const status = Number(knownError.status);
      const msg = String(knownError.message || error || "").toLowerCase();
      if (status === 404 || msg.includes("game not found")) {
        replayDisabled = true;
        replay = null;
        return;
      }
      notify(`Replay refresh failed: ${String(knownError.message || error)}`, true);
    }
  }
  async function init(): Promise<void> {
    await refreshReplay({ snapTail: true });
    paint({ updateTable: false });
  }
  async function onGameEnded(): Promise<void> {
    followLive = true;
    hardStopAnimations({ commitPending: false });
    await refreshReplay({ snapTail: true });
    paint({ updateTable: true });
  }

  async function refreshReplayUntilAdvanced(
    prevLiveIndex: number,
    { snapTail = false }: RefreshReplayOptions = {},
  ): Promise<void> {
    const baseline = Number.isFinite(prevLiveIndex) ? prevLiveIndex : -1;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await refreshReplay({ snapTail });
      if ((replay?.live_index ?? -1) > baseline) return;
      if (attempt + 1 < 6) {
        await new Promise((resolve) => {
          setTimeout(resolve, 60 * (attempt + 1));
        });
      }
    }
  }
  function onLiveShotCommitted(): void {
    const wasAtLiveTail =
      Boolean(replay && Number.isFinite(replay.live_index) && exploreIndex === replay.live_index);
    const snapToNewTail = followLive || wasAtLiveTail;
    const prevLiveIndex = replay?.live_index ?? -1;
    void refreshReplayUntilAdvanced(prevLiveIndex, { snapTail: snapToNewTail }).then(() => {
      if (snapToNewTail) followLive = true;
      paintListOnly();
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
    hardStopAnimations({ commitPending: false });
    followLive = true;
    if (replay) exploreIndex = replay.live_index;
    refreshTableView(getState());
    paint({ updateTable: false });
    document
      .getElementById("history-list")
      ?.querySelector(".history-line-active")
      ?.scrollIntoView({ block: "nearest" });
  }

  function goRow(rowIndex: number): void {
    hardStopAnimations({ commitPending: false });
    if (!replay) return;
    const entryIdx = entryIndexForShotRow(replay.entries, rowIndex);
    if (entryIdx == null) return;
    followLive = false;
    exploreIndex = shotStartEntryIndex(replay.entries, entryIdx);
    paint({ updateTable: true });
  }

  function goNext(): void {
    if (!replay) return;
    const liveIdx = liveIndex();
    const anchor = exploreAnchorIndex();
    if (anchor >= liveIdx) return;

    const shotIdx = shotEntryToPlayFrom(replay.entries, anchor, liveIdx);
    if (shotIdx == null || shotIdx > liveIdx) return;

    hardStopAnimations({ commitPending: false });
    const token = animToken;

    // if a prior step rejected, recover the chain so controls don't deadlock.
    replayChain = replayChain
      .catch(() => {})
      .then(() => runReplayStep(shotIdx, token));
  }

  function goPrev(): void {
    if (!replay) return;
    const targetIdx = prevStepExploreTarget(
      replay.entries,
      exploreAnchorIndex(),
      liveIndex(),
    );
    if (targetIdx == null) return;

    hardStopAnimations({ commitPending: false });
    const row = activeShotRowIndex(replay.entries, exploreAnchorIndex(), liveIndex());
    if (row > 0) {
      goRow(row - 1);
      return;
    }
    followLive = false;
    exploreIndex = targetIdx;
    paint({ updateTable: true });
  }

  function bindUi(): void {
    const prevBtn = document.getElementById("history-prev-btn");
    const nextBtn = document.getElementById("history-next-btn");
    const liveBtn = document.getElementById("history-live-btn");
    const prevMobile = document.getElementById("history-prev-mobile");
    const nextMobile = document.getElementById("history-next-mobile");
    const liveMobile = document.getElementById("history-live-mobile");
    const list = document.getElementById("history-list");
    unbindUi();
    const clickPrev = () => goPrev();
    const clickNext = () => { void goNext(); };
    const clickLive = () => goLive();
    const clickList = (event: Event) => {
      const target = event.target as Element | null;
      const li = target && typeof target.closest === "function"
        ? target.closest<HTMLElement>(".history-line")
        : null;
      if (!li || !list?.contains(li)) return;
      const idx = Number(li.dataset.moveIndex);
      if (!Number.isFinite(idx)) return;
      goRow(idx);
    };
    prevBtn?.addEventListener("click", clickPrev);
    nextBtn?.addEventListener("click", clickNext);
    liveBtn?.addEventListener("click", clickLive);
    prevMobile?.addEventListener("click", clickPrev);
    nextMobile?.addEventListener("click", clickNext);
    liveMobile?.addEventListener("click", clickLive);
    list?.addEventListener("click", clickList);
    uiUnsubs = [
      () => prevBtn?.removeEventListener("click", clickPrev),
      () => nextBtn?.removeEventListener("click", clickNext),
      () => liveBtn?.removeEventListener("click", clickLive),
      () => prevMobile?.removeEventListener("click", clickPrev),
      () => nextMobile?.removeEventListener("click", clickNext),
      () => liveMobile?.removeEventListener("click", clickLive),
      () => list?.removeEventListener("click", clickList),
    ];
  }

  function unbindUi(): void {
    if (!uiUnsubs.length) return;
    for (const off of uiUnsubs) {
      try {
        off();
      } catch {
        /* noop */
      }
    }
    uiUnsubs = [];
  }

  function setGameId(id: string): void {
    activeGameId = String(id || "").trim();
    replayEpoch += 1;
    replay = null;
    exploreIndex = 0;
    followLive = true;
    pendingExploreIndex = null;
    replayChain = Promise.resolve();
    hardStopAnimations({ commitPending: false });
    const list = document.getElementById("history-list");
    if (list) list.innerHTML = "";
  }

  function isReplayAnimating(): boolean {
    return replayBusy;
  }

  return {
    init,
    mergeForRender,
    activeHistoryRowIndex,
    isAtLiveTail,
    shouldSuppressGameOver,
    isReplayAnimating,
    onLiveShotCommitted,
    onGameEnded,
    bindUi,
    unbindUi,
    paint,
    setGameId,
    hardStopAnimations,
    goLive,
    goRow,
    goNext,
    goPrev,
    teardown: () => {
      unbindUi();
      setGameId("");
    },
  };
}
