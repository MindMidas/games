import { ACTION, MODE_PASS_AND_PLAY, MODE_PVP } from "./contracts.js";
import {
  clearInactivityAutoSurrender,
  markInactivityAutoSurrender,
} from "../../platform/features/gameplay/inactivitySurrender.js";
import { createStore } from "./store.js";
import { bindGameId, fetchState, surrender } from "./http.js";
import { applyTableState, resetTableRenderCache } from "./render.js";
import { clearGlobalCueOverlay, isTrajectoryPlaying } from "./trajectory.js";
import { createPoolInput } from "./input.js";
import { createHistoryNav } from "./historyNav.js";
import { mountPoolArenaLayoutSync } from "../shared/lib/tableLayout.js";
import { mountGamePhoneDrawer } from "../../platform/features/gameplay/phoneDrawer.js";
import { POOL_SHELL } from "../../platform/shell/config.js";
import { createClockTicker, renderClocks } from "../../platform/game/clock.js";
import { isGameId } from "../../platform/shared/lib/routes.js";
import { playGameSound } from "../features/sound/controller.js";
import { createSoundBus } from "../features/sound/soundBus.js";
import { mergeRemoteNextState } from "./seatUtils.js";
import { connectRealtime } from "../../platform/features/gameplay/realtime.js";
import { awaitRealtimeAndChatBootstrap } from "../../platform/features/gameplay/bootstrapRealtimeChat.js";
import {
  canOfferPvpRematch,
  isGameTerminalForShell,
  syncGameShell,
} from "../../platform/features/gameplay/syncGameShell.js";
import { loadPlatformChatPanel } from "../../platform/features/gameplay/chat/loadPlatformChatPanel.js";
import { createPoolShotPipeline } from "../features/gameplay/poolShotPipeline.js";
import { setActiveGameId } from "../../platform/features/gameplay/activeGameId.js";
import {
  respondDraw,
  respondRematch,
} from "../../platform/features/gameplay/pvpNet.js";
import { wirePvpGameActions } from "../../platform/features/gameplay/wirePvpGameActions.js";
import { gameNotify } from "../../platform/features/gameplay/gameNotify.js";
import { confirmApp } from "../../platform/features/ui/appConfirm.js";
import type { ApiError, ChatMessage } from "../../platform/shared/contracts.js";
import type { ChatDecision } from "../../platform/features/gameplay/chat/chatState.js";
import type {
  RealtimeConnection,
  RealtimeUpdate,
} from "../../platform/features/gameplay/realtime.js";
import type { PoolState, PoolTerminalResponse } from "./contracts.js";

interface AuthUser {
  id?: string | number;
  username?: string;
}

interface PoolBootOptions {
  gameId?: string;
  currentUser?: AuthUser | null;
  startRematch?: ((gameId: string) => Promise<void>) | null;
}

interface PaintOptions {
  syncLayout?: boolean;
  forceTableSvg?: boolean;
  skipInputSync?: boolean;
}

interface RemoteEvent extends PoolTerminalResponse {
  message?: ChatMessage;
}

interface ApplyRemoteOptions {
  fromShotPipeline?: boolean;
}

interface SocialResponse extends RemoteEvent {
  rematch?: { game_id?: string };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function initialRealtimeSinceSeq(state: Partial<PoolState> | null | undefined): number {
  if (!state || typeof state !== "object") return -1;
  const sq = Number(state.stream_seq);
  if (!Number.isFinite(sq) || sq === 0) return -1;
  return sq;
}


const notify = gameNotify;

export async function boot({
  gameId,
  currentUser = null,
  startRematch = null,
}: PoolBootOptions = {}) {
  const resolvedId = String(gameId || "").trim();
  if (resolvedId && !isGameId(resolvedId)) {
    const err = new Error("Invalid game link.") as ApiError;
    err.status = 404;
    throw err;
  }
  let activeGameId = String(gameId || "");
  let lifecycleEpoch = 0;
  let tornDown = false;
  const isStaleEpoch = (epoch: number): boolean => tornDown || epoch !== lifecycleEpoch;
  bindGameId(activeGameId);
  setActiveGameId(activeGameId);

  const store = createStore({
    game_id: activeGameId,
    mode: MODE_PVP,
    can_place_cue: false,
    can_fire_shot: false,
    table: {},
  });

  let input: ReturnType<typeof createPoolInput> | null = null;
  let shotPipeline: ReturnType<typeof createPoolShotPipeline> | null = null;
  let realtime: RealtimeConnection | null = null;
  let unsubscribeChatShell: (() => void) | null = null;
  let authUser: AuthUser | null = currentUser && typeof currentUser === "object" ? currentUser : null;

  const shellSync: { run: (() => void) | null } = { run: null };
  const historyNav = createHistoryNav({
    getState: () => store.getState(),
    gameId: activeGameId,
    notify,
    onTableRefresh: () => {
      if (historyNav.isReplayAnimating()) return;
      input?.syncInteraction?.();
    },
    onShellSync: () => shellSync.run?.(),
  });
  let historyNavReady = false;

  const gameAppEl = document.getElementById("game-app");
  const tableEl = document.getElementById("pool-svg-container");
  const gameAppRoot = gameAppEl;
  const phoneDrawer = mountGamePhoneDrawer({
    arenaLayoutEvent: POOL_SHELL.arenaLayoutEvent,
    onDrawerOpenChange(open: boolean) {
      if (open) clearGlobalCueOverlay();
    },
  });

  const chatListEl = document.getElementById("chat-list");
  const chatInputEl = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  const chatSendBtn = document.getElementById("chat-send-btn") as HTMLButtonElement | null;

  function chatUserFromStore(): { id: string; username: string } | null {
    const s = store.getState();
    const authId = authUser?.id ? String(authUser.id) : "";
    if (s?.you_seat) {
      const table = s.table || {};
      const seat = s.you_seat;
      const username = seat === "player1"
        ? String(table.p1_name || "You")
        : String(table.p2_name || "You");
      const seatId = seat === "player1"
        ? String(table.player1_id || "")
        : String(table.player2_id || "");
      const id = authId || seatId;
      if (id) {
        return { id, username: username.trim() || "You" };
      }
    }
    if (authId) {
      return {
        id: authId,
        username: String(authUser?.username || "You").trim() || "You",
      };
    }
    return null;
  }

  const { createChatPanel: createPlatformChatPanel } = await loadPlatformChatPanel();
  const chatPanel = await createPlatformChatPanel({
    listEl: chatListEl,
    inputEl: chatInputEl,
    sendButton: chatSendBtn,
    getGameId: () => activeGameId,
    getUser: chatUserFromStore,
    notify,
    respondDraw: async (offerId: number, decision: ChatDecision) => {
      const body = await respondDraw<SocialResponse>(offerId, decision);
      const update = body?.message;
      if (update && typeof update === "object") {
        chatPanel.applySseChat(update);
      }
      if (body?.game_over) {
        applyLocalTerminal(body);
      }
      return body;
    },
    respondRematch: async (offerId: number, decision: ChatDecision) => (
      respondRematch<SocialResponse>(offerId, decision)
    ),
    onRematchAccepted: async (newGameId: string) => {
      phoneDrawer.clearChatUnread();
      if (!startRematch) throw new Error("Rematch unavailable.");
      await startRematch(newGameId);
    },
    onSystemAction: async () => {},
    onOpponentIncoming: () => phoneDrawer.bumpChatUnread(),
  });
  chatPanel.setGameId(activeGameId);
  chatPanel.init();

  const pvpActions = wirePvpGameActions({
    chatPanel,
    getGameId: () => activeGameId,
    getState: () => store.getState(),
    notify,
    isPvpActive: (cur: Partial<PoolState> | null | undefined) => Boolean(
      cur
      && cur.mode === MODE_PVP
      && cur.status === "active"
      && !isGameTerminalForShell(cur),
    ),
    canOfferRematch: (cur: Partial<PoolState> | null | undefined) => canOfferPvpRematch(cur, MODE_PVP),
  });
  const surrenderBtn = document.getElementById("game-surrender-btn");
  let lastSurrenderTapAt = 0;

  function clearGameOverDismissed() {
    document.getElementById("game-over-overlay")?.removeAttribute("data-user-dismissed");
  }

  function isShotAnimating() {
    return Boolean(
      shotPipeline?.isPlaying?.()
      || input?.isShotPlaybackLocked?.()
      || isTrajectoryPlaying(),
    );
  }
  function applyLocalTerminal(body: RemoteEvent, opts: ApplyRemoteOptions = {}): void {
    if (!body || typeof body !== "object") return;
    if (!opts.fromShotPipeline && isShotAnimating() && shotPipeline) {
      void shotPipeline.whenIdle().then(() => {
        if (isGameTerminalForShell(store.getState())) {
          clearGameOverDismissed();
          if (historyNavReady) paintAll();
          applyGameShell(store.getState());
          return;
        }
        applyLocalTerminal(body, opts);
      });
      return;
    }
    let payload;
    if (body.next_state && typeof body.next_state === "object") {
      payload = mergeRemoteNextState(store.getState(), body.next_state);
      if (body.result && typeof body.result === "object") {
        payload = { ...payload, result: body.result };
      }
    } else if (body.game_over && typeof body.game_over === "object") {
      payload = mergeRemoteNextState(store.getState(), body.game_over);
      if (body.game_over.result) {
        payload = { ...payload, result: body.game_over.result };
      }
    } else {
      payload = mergeRemoteNextState(store.getState(), body);
    }
    store.dispatch({ type: ACTION.TERMINAL, payload });
    clearGameOverDismissed();
    void (async () => {
      await historyNav.onGameEnded();
      if (historyNavReady) paintAll();
      applyGameShell(store.getState());
    })();
  }
  async function handleSurrender() {
    const cur = store.getState();
    if (!cur || cur.status !== "active") return;
    const passAndPlay = String(cur.mode || "") === "pnp";
    const ok = await confirmApp(
      passAndPlay
        ? "End the current game on this device?"
        : "You will lose by resignation. Continue?",
      { title: passAndPlay ? "End Game?" : "Surrender?" },
    );
    if (!ok) return;
    try {
      const body = await surrender(activeGameId);
      applyLocalTerminal(body);
    } catch (err) {
      notify(`Surrender failed: ${errorMessage(err)}`, true);
    }
  }

  function onSurrenderPointerUp(event: PointerEvent): void {
    if (!event?.isPrimary || event?.pointerType === "mouse") return;
    event.preventDefault();
    lastSurrenderTapAt = Date.now();
    void handleSurrender();
  }

  function onSurrenderClick(event: MouseEvent): void {
    if (Date.now() - lastSurrenderTapAt < 500) {
      event.preventDefault();
      return;
    }
    void handleSurrender();
  }

  surrenderBtn?.addEventListener("pointerup", onSurrenderPointerUp);
  surrenderBtn?.addEventListener("click", onSurrenderClick);

  function applyGameShell(s: Partial<PoolState> | null | undefined): void {
    if (!gameAppRoot || !s) return;
    syncGameShell(s, {
      pveMode: "pnp",
      chat: chatPanel,
      atLiveTail: historyNav.isAtLiveTail(),
    });
  }

  shellSync.run = () => {
    const s = store.getState();
    if (s) applyGameShell(s);
  };

  function closeRealtime(): void {
    if (realtime) {
      try { realtime.close(); } catch { /* noop */ }
      realtime = null;
    }
  }

  const payload = await fetchState(activeGameId);
  store.dispatch({
    type: ACTION.HYDRATE,
    payload: mergeRemoteNextState(
      { game_id: activeGameId, you_seat: payload.you_seat },
      payload,
    ),
  });

  const loaded = store.getState();
  applyGameShell(loaded);
  unsubscribeChatShell = store.subscribe((s: Partial<PoolState>) => {
    if (!s) return;
    applyGameShell(s);
  });

  function shouldDeferInputSync(): boolean {
    return Boolean(
      input?.isShotPlaybackLocked?.()
      || input?.isGestureActive?.()
      || isTrajectoryPlaying(),
    );
  }

  function shouldSuppressGameOverOverlay(): boolean {
    const fn = historyNav.shouldSuppressGameOver;
    if (typeof fn === "function" && fn.call(historyNav)) return true;
    if (!historyNav.isAtLiveTail()) return true;
    return isShotAnimating();
  }

  function paintAll(options: PaintOptions = {}): void {
    const merged = historyNav.mergeForRender(store.getState());
    const preserveSvg = Boolean(input?.hasPendingCuePlacement?.());
    const terminal = isGameTerminalForShell(store.getState());
    const suppressGameOver = !terminal || shouldSuppressGameOverOverlay();
    applyTableState(merged, {
      preserveTableSvg: preserveSvg,
      suppressGameOver,
      suppressTurnHighlight: terminal,
      syncLayout: options.syncLayout === true,
      forceTableSvg: options.forceTableSvg === true,
    });
    historyNav.paint({ updateTable: false });
    if (!options.skipInputSync && !shouldDeferInputSync()) {
      input?.syncInteraction?.();
    }
  }

  const clockTicker = createClockTicker({
    store,
    render: { renderClocks },
  });
  clockTicker.start();

  const soundBus = createSoundBus({ store, playGameSound });
  soundBus.start();

  const unmountArenaLayout = mountPoolArenaLayoutSync(tableEl, gameAppEl);
  queueMicrotask(() => {
    window.dispatchEvent(new CustomEvent("pool-arena-layout"));
  });

  function applyRemoteEvent(evt: RemoteEvent, opts: ApplyRemoteOptions = {}): void {
    const ns = evt?.next_state;
    if (!ns || typeof ns !== "object") return;
    input?.cancelPendingCuePlacement?.();
    const wasAtLiveTail = historyNav.isAtLiveTail();
    const merged = mergeRemoteNextState(store.getState(), ns);
    const terminal =
      Boolean(merged.table?.game_over)
      || merged.status === "finished"
      || merged.status === "draw";
    if (terminal) {
      applyLocalTerminal(evt, opts);
      return;
    }
    store.dispatch({ type: ACTION.HYDRATE, payload: merged });
    paintAll({ skipInputSync: shouldDeferInputSync() });
    if (wasAtLiveTail && !shouldDeferInputSync()) {
      historyNav.onLiveShotCommitted();
    }
  }

  shotPipeline = createPoolShotPipeline({
    applyState(ns) {
      applyRemoteEvent({ next_state: ns }, { fromShotPipeline: true });
    },
    syncShell: () => shellSync.run?.(),
    onPlaybackStart: () => input?.onShotPlaybackStart?.(),
    onPlaybackEnd: () => {
      input?.onShotPlaybackEnd?.();
      if (historyNav.isAtLiveTail()) {
        historyNav.onLiveShotCommitted();
      }
      if (isGameTerminalForShell(store.getState())) {
        clearGameOverDismissed();
        paintAll();
        applyGameShell(store.getState());
      }
    },
  });

  input = createPoolInput({
    gameId: activeGameId,
    getState: () => store.getState(),
    isExploreLocked: () => !historyNav.isAtLiveTail() || historyNav.isReplayAnimating(),
    onPlacementRejected: () => {
      input?.cancelPendingCuePlacement?.();
      paintAll();
    },
    onShotAccepted: async (result) => {
      input?.cancelPendingCuePlacement?.();
      await shotPipeline.schedule(result);
    },
    onError: (err) => {
      console.error("[pool/game]", err);
    },
  });

  function openRealtime(gameId: string, state: Partial<PoolState>): RealtimeConnection {
    const expectedGameId = String(gameId || "");
    closeRealtime();
    realtime = connectRealtime({
      gameId,
      sinceSeq: initialRealtimeSinceSeq(state),
      onShotAccepted: (evt: RealtimeUpdate) => {
        if (tornDown || String(activeGameId || "") !== expectedGameId) return;
        if (String(evt?.type || "") !== "shot_accepted") return;
        if (shotPipeline) void shotPipeline.schedule(evt);
      },
      onGameOver: (evt: RealtimeUpdate) => {
        if (tornDown || String(activeGameId || "") !== expectedGameId) return;
        applyLocalTerminal(evt as RemoteEvent);
      },
      onChatMessage: (evt: RealtimeUpdate) => {
        if (tornDown || String(activeGameId || "") !== expectedGameId) return;
        const row = evt?.message;
        if (row && typeof row === "object") {
          chatPanel.applySseChat(row as unknown as ChatMessage);
        }
      },
      onStreamOpen: () => {
        if (tornDown || String(activeGameId || "") !== expectedGameId) return;
        void chatPanel.refresh();
      },
      onError: (err: unknown) => notify(`Realtime error: ${errorMessage(err)}`, true),
    });
    return realtime;
  }

  const INACTIVITY_MS = 2 * 60 * 1000;
  let inactivityTimer: number | null = null;
  let clockForfeitTimer: number | null = null;

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      const s = store.getState();
      if (!s || s.status !== "active") return;
      const seq = Number(s.stream_seq);
      if (!Number.isFinite(seq) || seq <= 0) return;
      notify("Surrendering due to inactivity.");
      markInactivityAutoSurrender();
      void surrender(activeGameId, { cause: "inactivity" })
        .then((body) => {
          if (body && (String(body.type || "") === "game_over" || body.next_state || body.game_over)) {
            applyLocalTerminal(body);
          }
        })
        .catch((err) => {
          clearInactivityAutoSurrender();
          notify(`Auto-surrender failed: ${errorMessage(err)}`, true);
        });
    }, INACTIVITY_MS);
  }

  const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown"];
  ACTIVITY_EVENTS.forEach((e) => document.addEventListener(e, resetInactivityTimer, { passive: true }));
  resetInactivityTimer();

  function activeClockDisplayMs(state: Partial<PoolState> | null | undefined): number | null {
    if (!state || state.status !== "active") return null;
    const anchorIso = state.clock_anchor_iso;
    const anchorMs = anchorIso ? Date.parse(anchorIso) : NaN;
    const elapsed = Number.isFinite(anchorMs) ? Math.max(0, Date.now() - anchorMs) : 0;
    const active = state.clock_active_color;
    const base = active === "w"
      ? Number(state.clock_a_ms) || 0
      : Number(state.clock_b_ms) || 0;
    if (active !== "w" && active !== "b") return null;
    return Math.max(0, base - elapsed);
  }

  function syncClockForfeitFromServer() {
    const s = store.getState();
    if (!s || s.status !== "active") return;
    if ((activeClockDisplayMs(s) ?? 1) > 0) return;
    void fetchState(activeGameId)
      .then((fresh) => {
        if (!fresh || typeof fresh !== "object") return;
        if (isGameTerminalForShell(fresh)) {
          applyLocalTerminal({ next_state: fresh, result: fresh.result });
        }
      })
      .catch(() => { /* noop */ });
  }

  clockForfeitTimer = window.setInterval(syncClockForfeitFromServer, 1000);

  await historyNav.init();
  historyNav.bindUi();
  resetTableRenderCache();
  paintAll({ syncLayout: true });
  input.syncInteraction();
  historyNavReady = true;

  const live = store.getState();
  const useRealtime = live?.mode === MODE_PVP || live?.mode === MODE_PASS_AND_PLAY;
  if (useRealtime) {
    const rt = openRealtime(activeGameId, live);
    await awaitRealtimeAndChatBootstrap({ realtime: rt, chatPanel });
  }

  return {
    store,
    phoneDrawer,
    input,
    historyNav,
    chatPanel,
    setAuthUser(user: AuthUser | null) {
      authUser = user && typeof user === "object" ? user : null;
    },
    refreshUi() {
      paintAll();
    },
    refreshShell() {
      applyGameShell(store.getState());
    },
    applyRemoteEvent,
    async reconnectForRematch(newGameId: string, newState: Partial<PoolState>) {
      const epoch = ++lifecycleEpoch;
      const id = String(newGameId || "").trim();
      if (!id || !isGameId(id)) return;
      activeGameId = id;
      bindGameId(id);
      setActiveGameId(id);
      historyNav.setGameId(id);
      store.dispatch({ type: ACTION.HYDRATE, payload: newState });
      document.getElementById("game-over-overlay")?.classList.add("hidden");
      phoneDrawer.clearChatUnread();
      chatPanel.setGameId(id);
      chatPanel.init();
      applyGameShell(store.getState());
      await historyNav.init();
      if (isStaleEpoch(epoch)) return;
      applyGameShell(store.getState());
      paintAll({ syncLayout: true });
      const rt = openRealtime(id, store.getState());
      await awaitRealtimeAndChatBootstrap({ realtime: rt, chatPanel });
    },
    teardown: () => {
      if (tornDown) return;
      tornDown = true;
      lifecycleEpoch += 1;
      clearInactivityAutoSurrender();
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
      if (clockForfeitTimer) {
        clearInterval(clockForfeitTimer);
        clockForfeitTimer = null;
      }
      ACTIVITY_EVENTS.forEach((e) => document.removeEventListener(e, resetInactivityTimer));
      surrenderBtn?.removeEventListener("pointerup", onSurrenderPointerUp);
      surrenderBtn?.removeEventListener("click", onSurrenderClick);
      pvpActions?.teardown?.();
      closeRealtime();
      unsubscribeChatShell?.();
      try {
        chatPanel.destroy?.();
      } catch {
        /* noop */
      }
      setActiveGameId(null);
      historyNavReady = false;
      resetTableRenderCache();
      historyNav.teardown?.();
      soundBus.stop();
      clockTicker.stop();
      input.unbind();
      unmountArenaLayout();
      phoneDrawer.teardown();
      const overlay = document.getElementById("game-over-overlay");
      if (overlay) {
        overlay.removeAttribute("data-user-dismissed");
        overlay.classList.add("hidden");
      }
    },
    async refreshProfilePhotos() {
      const epoch = lifecycleEpoch;
      const fresh = await fetchState(activeGameId);
      if (isStaleEpoch(epoch)) return;
      store.dispatch({
        type: ACTION.PROFILE_REFRESH,
        payload: {
          table: {
            p1_photo_url: fresh.table?.p1_photo_url,
            p2_photo_url: fresh.table?.p2_photo_url,
          },
        },
      });
      paintAll();
    },
  };
}
