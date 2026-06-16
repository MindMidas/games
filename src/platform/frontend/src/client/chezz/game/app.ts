import { createStore } from "./store.js";
import { createRenderer } from "./render.js";
import { createAnimator } from "./animator.js";
import { createClockTicker } from "../../platform/game/clock.js";
import { createSoundBus } from "./sound.js";
import { createInput } from "./input.js";
import { createHistoryNav } from "./historyNav.js";
import { connectRealtime } from "../../platform/features/gameplay/realtime.js";
import { awaitRealtimeAndChatBootstrap } from "../../platform/features/gameplay/bootstrapRealtimeChat.js";
import * as http from "./http.js";
import { ACTION } from "./contracts.js";
import { effectiveYouColor } from "../features/gameplay/gameLogic.js";
import { mountRulebook } from "./rulebook.js";
import { confirmApp } from "../../platform/features/ui/appConfirm.js";
import {
  markInactivityAutoSurrender,
  clearInactivityAutoSurrender,
} from "../../platform/features/gameplay/inactivitySurrender.js";

import * as gameAnimations from "../features/gameplay/gameAnimations.js";
import { playGameSound } from "../features/sound/controller.js";
import { mountChezzArenaLayoutSync } from "../shared/lib/boardLayout.js";
import { mountGamePhoneDrawer } from "../../platform/features/gameplay/phoneDrawer.js";
import { CHEZZ_SHELL } from "../../platform/shell/config.js";
import {
  canOfferPvpRematch,
  isGameTerminalForShell,
  syncGameShell,
} from "../../platform/features/gameplay/syncGameShell.js";
import { loadPlatformChatPanel } from "../../platform/features/gameplay/chat/loadPlatformChatPanel.js";
import { setActiveGameId } from "../../platform/features/gameplay/activeGameId.js";
import {
  respondDraw,
  respondRematch,
} from "../../platform/features/gameplay/pvpNet.js";
import { wirePvpGameActions } from "../../platform/features/gameplay/wirePvpGameActions.js";
import { gameNotify } from "../../platform/features/gameplay/gameNotify.js";
import { syncRoute, gameIdFromRoute, isGameId } from "../../platform/shared/lib/routes.js";
import { isMissingGameError } from "../../platform/features/gameplay/controller.js";
import { parseChatSystemMessage } from "../../platform/shared/lib/appData.js";
import type { ChatMessage } from "../../platform/shared/contracts.js";
import type { RealtimeUpdate } from "../../platform/features/gameplay/realtime.js";
import type { GameOver, GameState, LegalBundle, MoveAccepted } from "./contracts.js";
import type { HistoryRow } from "./historyMeta.js";
import type { ClientGameState } from "./store.js";

const ENGINE_USER_ID = "engine";

type BootOptions = {
  gameId?: string;
  startRematch?: (newGameId: string) => void | Promise<void>;
};

type BootResult = {
  teardown: () => void;
  gameId: string;
  store: ReturnType<typeof createStore>;
  refreshProfilePhotos: () => Promise<void>;
};

type TerminalEnvelope = {
  game_over?: TerminalEnvelope;
  next_state?: GameState | ClientGameState | null;
  result?: GameState["result"];
  status?: string;
  board?: unknown;
};

type TerminalPayload = {
  next_state: GameState | ClientGameState | TerminalEnvelope | null;
  result: GameState["result"] | null;
};

type ApplyTerminalOptions = {
  immediate?: boolean;
};

type ShellRunner = {
  run: (() => void) | null;
};

type TimeoutHandle = ReturnType<typeof setTimeout> | null;

type HistoryNavFactory = (deps: {
  store: unknown;
  render: unknown;
  animator: unknown;
  http: typeof http;
  gameId: string;
  notify: (message: unknown, isError?: boolean) => void;
  onShellSync?: () => void;
  paintShell?: () => void;
}) => ReturnType<typeof createHistoryNav>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function errorStatus(error: unknown): number {
  return Number(isRecord(error) ? error.status : NaN);
}

function isMoveAccepted(value: unknown): value is MoveAccepted {
  return isRecord(value) && value.type === "move_accepted";
}

function isGameOver(value: unknown): value is GameOver {
  return isRecord(value) && value.type === "game_over";
}

function isChatMessage(value: unknown): value is ChatMessage {
  return isRecord(value)
    && value.id != null
    && typeof value.game_id === "string"
    && typeof value.user_id === "string"
    && typeof value.body === "string"
    && typeof value.created_at === "string";
}

function historyRows(rows: unknown): HistoryRow[] | null {
  return Array.isArray(rows) ? rows as HistoryRow[] : null;
}

function legalBundle(value: unknown): LegalBundle | null {
  return isRecord(value) && Array.isArray(value.actions)
    ? value as unknown as LegalBundle
    : null;
}

function initialRealtimeSinceSeq(gameState: GameState | ClientGameState | null | undefined): number {
  if (!gameState || typeof gameState !== "object") return -1;
  const histLen = Array.isArray(gameState.move_history) ? gameState.move_history.length : 0;
  const sq = Number(gameState.stream_seq);
  if (histLen === 0 && (!Number.isFinite(sq) || sq === 0)) return -1;
  return Number.isFinite(sq) ? sq : -1;
}


const notify = gameNotify;

export async function boot(options: BootOptions = {}): Promise<BootResult> {
  const startRematch = typeof options?.startRematch === "function"
    ? options.startRematch
    : null;
  const store = createStore(null);
  const render = createRenderer(document.body);
  const animator = createAnimator({
    store: store as unknown as Parameters<typeof createAnimator>[0]["store"],
    gameAnimations,
    render: render as unknown as Parameters<typeof createAnimator>[0]["render"],
    onDrainIdle: () => {
      tryRequestEngineMove();
      maybeFinalizeTerminal();
    },
  });
  const clockTicker = createClockTicker({
    store: store as unknown as Parameters<typeof createClockTicker>[0]["store"],
    render,
  });
  const sound = {
    play: (id: string) => { try { playGameSound(id); } catch { /* ignore */ } },
  };
  const soundBus = createSoundBus({ store, playGameSound });

  let gameId = String(options?.gameId || "").trim() || gameIdFromRoute();
  if (gameId && !isGameId(gameId)) {
    const err = new Error("Invalid game link.") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  let lifecycleEpoch = 0;
  let tornDown = false;
  const isStaleEpoch = (epoch: number): boolean => tornDown || epoch !== lifecycleEpoch;
  void isStaleEpoch;

  let state: GameState | null = null;
  try {
    state = await http.loadState(gameId);
  } catch (err) {
    if (!isMissingGameError(err)) {
      notify(`Failed to load game state: ${errorMessage(err)}`, true);
    }
    throw err;
  }
  if (!state || typeof state !== "object") {
    const err = new Error("Game not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  gameId = String(state.game_id || gameId || "");
  store.dispatch({ type: ACTION.HYDRATE, payload: state });

  const shellSync: ShellRunner = { run: null };
  const shellPaint: ShellRunner = { run: null };
  let terminalUiReady = isGameTerminalForShell(state);
  /** Once true, suppress endgame popup until a fresh terminal event (live end) or page reload. */
  let terminalPopupAcknowledged = !terminalUiReady;
  const historyNav = (createHistoryNav as unknown as HistoryNavFactory)({
    store,
    render,
    animator,
    http,
    gameId,
    notify,
    onShellSync: () => shellSync.run?.(),
    paintShell: () => shellPaint.run?.(),
  });

  function clearGameOverDismissed(): void {
    document.getElementById("game-over-overlay")?.removeAttribute("data-user-dismissed");
  }

  /** HTTP terminal (surrender / draw / game_over) - defer popup until move animation finishes. */

  let terminalFinalizeInFlight = false;

  function terminalPayloadFromBody(body: unknown): TerminalPayload {
    if (!body || typeof body !== "object") {
      return { next_state: null, result: null };
    }
    const record = body as TerminalEnvelope;
    const envelope = record.game_over && typeof record.game_over === "object" ? record.game_over : record;
    const nextState = envelope.next_state && typeof envelope.next_state === "object"
      ? envelope.next_state
      : (envelope.status || envelope.board || envelope.result ? envelope : null);
    const result = envelope.result
      || (isRecord(nextState) ? nextState.result as GameState["result"] : null)
      || record.result
      || null;
    return { next_state: nextState, result };
  }

  function isLiveMoveAnimating(): boolean {
    const s = store.getState();
    return Boolean(s?.animationPending || s?.pendingTerminal || animator.busy());
  }

  function markTerminalPopupAcknowledged(): void {
    terminalPopupAcknowledged = true;
  }

  function shouldSuppressGameOverOverlay(): boolean {
    if (historyNav.shouldSuppressGameOver()) return true;
    if (!historyNav.isAtLiveTail()) return true;
    const s = store.getState();
    if (isGameTerminalForShell(s) && !terminalUiReady) return true;
    if (isLiveMoveAnimating()) return true;
    if (isGameTerminalForShell(s) && terminalPopupAcknowledged) return true;
    return false;
  }

  function paintChezzShell(): void {
    const s = store.getState();
    if (!s || historyNav.shouldSuppressRender()) return;
    const merged = historyNav.mergeForRender(s);
    const atLive = historyNav.isAtLiveTail();
    const terminal = isGameTerminalForShell(s);
    render.renderAll(merged as Parameters<typeof render.renderAll>[0], {
      historyActiveRow: historyNav.activeHistoryRowIndex(),
      fullMoveHistory: historyRows(s?.move_history),
      outcomeState: s as unknown as Parameters<typeof render.renderAll>[1] extends { outcomeState?: infer T } ? T : never,
      showOutcome: historyNav.shouldShowOutcome?.() ?? false,
      overlayState: s as unknown as Parameters<typeof render.renderAll>[1] extends { overlayState?: infer T } ? T : never,
      suppressGameOver: !terminal || shouldSuppressGameOverOverlay(),
      suppressTurnHighlight: !atLive || shouldSuppressGameOverOverlay() || terminal,
      onTerminalPopupRevealed: markTerminalPopupAcknowledged,
    });
    try {
      shellSync.run?.();
    } catch {
      /* noop */
    }
  }
  shellPaint.run = paintChezzShell;

  function maybeFinalizeTerminal(): void {
    const s = store.getState();
    if (!s || isLiveMoveAnimating()) return;
    if (!isGameTerminalForShell(s)) return;
    if (terminalFinalizeInFlight) return;
    if (terminalUiReady) return;
    terminalFinalizeInFlight = true;
    void historyNav.onGameEnded()
      .then(() => {
        terminalUiReady = true;
        applyGameShell(store.getState());
        paintChezzShell();
      })
      .finally(() => {
        terminalFinalizeInFlight = false;
      });
  }

  function applyLocalTerminal(body: unknown, opts: ApplyTerminalOptions = {}): void {
    if (!body || typeof body !== "object") return;
    const payload = terminalPayloadFromBody(body);

    if (opts.immediate) {
      animator.cancel();
      const cur = store.getState();
      if (cur?.animationPending) {
        store.dispatch({ type: ACTION.ANIMATION_DONE });
      }
    }

    terminalPopupAcknowledged = false;
    terminalUiReady = false;
    clearGameOverDismissed();
    store.dispatch({ type: ACTION.TERMINAL, payload });

    if (isLiveMoveAnimating()) {
      paintChezzShell();
      return;
    }

    maybeFinalizeTerminal();
  }

  function maybeApplyTerminalFromDrawAccept(row: ChatMessage | null | undefined): void {
    const parsed = parseChatSystemMessage(row?.body);
    if (parsed?.kind !== "draw_offer_update") return;
    if (String(parsed.decision || "").toLowerCase() !== "accept") return;
    const cur = store.getState();
    if (isGameTerminalForShell(cur) && terminalUiReady) return;
    void http.loadState(gameId)
      .then((fresh) => {
        if (!fresh || !isGameTerminalForShell(fresh)) return;
        if (isGameTerminalForShell(store.getState()) && terminalUiReady) return;
        applyLocalTerminal({ next_state: fresh, result: fresh.result }, { immediate: true });
      })
      .catch(() => {});
  }

  /** Dedupe move_accepted seen on both HTTP and SSE. */
  let lastDispatchedMoveSeq = Number.NaN;
  let legalRefreshQueued = false;

  function requestLegalRefresh(): void {
    if (legalRefreshQueued) return;
    legalRefreshQueued = true;
    queueMicrotask(async () => {
      legalRefreshQueued = false;
      try {
        const fresh = await http.loadState(gameId);
        applyLegalAfterPacked(fresh?.legal);
      } catch (err) {
        notify(`Legal moves fetch failed: ${errorMessage(err)}`, true);
        input.setLegalActions(null);
      }
    });
  }

  function applyLegalAfterPacked(packed: unknown): void {
    const legal = legalBundle(packed);
    if (!legal) return;
    input.setLegalActions({
      legal_cursor: String(legal.cursor ?? ""),
      actions: legal.actions,
      premove_by_color: legal.premove_by_color,
    });
    queueMicrotask(() => input.consumeAndFirePremove?.());
  }

  function applyMoveAccepted(evt: unknown): void {
    if (!isMoveAccepted(evt)) return;
    const seq = Number(evt.last_move_seq);
    const alt = Number(evt?.next_state?.stream_seq);
    const dedupe = Number.isFinite(seq) ? seq : alt;
    if (Number.isFinite(dedupe) && dedupe === lastDispatchedMoveSeq) return;
    if (Number.isFinite(dedupe)) lastDispatchedMoveSeq = dedupe;
    const cur = store.getState();
    if (cur?.pendingAnimation?.optimistic) {
      lastEnqueuedSeq = -1;
    }
    store.dispatch({ type: ACTION.MOVE_ACCEPTED, payload: evt });
    if (evt.legal && Array.isArray(evt.legal.actions)) {
      applyLegalAfterPacked(evt.legal);
    } else {
      requestLegalRefresh();
    }
  }

  mountRulebook(document.getElementById("rulebook-list"));

  setActiveGameId(gameId);

  const gameAppRoot = document.getElementById("game-app");
  const chatListEl = document.getElementById("chat-list");
  const chatInputRaw = document.getElementById("chat-input");
  const chatInputEl = chatInputRaw instanceof HTMLInputElement || chatInputRaw instanceof HTMLTextAreaElement
    ? chatInputRaw
    : null;
  const chatSendRaw = document.getElementById("chat-send-btn");
  const chatSendBtn = chatSendRaw instanceof HTMLButtonElement ? chatSendRaw : null;

  const { createChatPanel: createPlatformChatPanel } = await loadPlatformChatPanel();
  const chatPanel = await createPlatformChatPanel({
    listEl: chatListEl,
    inputEl: chatInputEl,
    sendButton: chatSendBtn,
    getGameId: () => gameId,
    getUser: () => {
      const s = store.getState();
      const y = s?.you_color;
      const p = y && s?.players?.[y];
      const id = p?.user_id != null ? String(p.user_id) : "";
      if (!id) return null;
      return { id, username: String(p?.username || "You").trim() || "You" };
    },
    notify,
    respondDraw: async (offerId, decision) => {
      const body = await respondDraw(offerId, decision);
      const update = body?.message;
      if (isChatMessage(update)) {
        chatPanel.applySseChat(update);
      }
      if (body?.game_over) {
        applyLocalTerminal(body, { immediate: true });
      }
      return body;
    },
    respondRematch: async (offerId, decision) => {
      return respondRematch(offerId, decision);
    },
    onRematchAccepted: async (newGameId) => {
      if (!startRematch) throw new Error("Rematch unavailable.");
      await startRematch(newGameId);
    },
    onSystemAction: async () => {},
    onOpponentIncoming: () => phoneDrawer.bumpChatUnread(),
  });
  chatPanel.setGameId(gameId);
  chatPanel.init();

  function applyGameShell(s: ClientGameState | GameState | null): void {
    if (!gameAppRoot || !s) return;
    syncGameShell(s, {
      pveMode: "pve",
      chat: chatPanel,
      atLiveTail: historyNav.isAtLiveTail(),
    });
  }
  shellSync.run = () => {
    const s = store.getState();
    if (s) applyGameShell(s);
  };
  applyGameShell(store.getState());

  const unsubscribeChatShell = store.subscribe((s) => {
    if (!s) return;
    applyGameShell(s);
  });

  const input = createInput({
    store: store as unknown as Parameters<typeof createInput>[0]["store"],
    http,
    gameId,
    render: render as unknown as Parameters<typeof createInput>[0]["render"],
    sound,
    animator,
    onPlayerMoveAccepted: applyMoveAccepted,
    notify,
    onStale: async () => {
      const fresh = await http.loadState(gameId);
      if (fresh && typeof fresh === "object") {
        store.dispatch({ type: ACTION.HYDRATE, payload: fresh });
        lastDispatchedMoveSeq = Number.NaN;
        await refreshLegalMoves();
      }
    },
    isExploreLocked: () => !historyNav.isAtLiveTail() || animator.busy(),
  });

  // PVE: request engine move when it is engine turn (declared before refreshlegalmoves).
  let engineKickInFlight = false;

  function seatOnTurnIsEngine(state: ClientGameState | null): boolean {
    const turn = state?.current_turn;
    if (turn !== "w" && turn !== "b") return false;
    const seatId = String(state?.players?.[turn]?.user_id || "").toLowerCase();
    return seatId === ENGINE_USER_ID;
  }

  function tryRequestEngineMove(): void {
    const s = store.getState();
    if (!s) return;
    if (s.mode !== "pve") return;
    if (s.status !== "active") return;
    if (historyNav && !historyNav.isAtLiveTail()) return;
    if (s.animationPending) return;
    if (animator.busy()) return;
    if (effectiveYouColor(s as unknown as Parameters<typeof effectiveYouColor>[0]) === s.current_turn) return;
    if (!seatOnTurnIsEngine(s)) return;
    if (engineKickInFlight) return;
    engineKickInFlight = true;
    void http
      .playEngineMove(gameId)
      .then((body) => {
        if (!body || typeof body !== "object") return;
        const t = String(body.type || "");
        // apply HTTP engine reply so terminal still lands if SSE lags.
        if (t === "move_accepted") applyMoveAccepted(body);
        else if (t === "game_over") applyLocalTerminal(body);
      })
      .catch((err) => {
        const status = errorStatus(err);
        const msg = errorMessage(err).toLowerCase();
        if (status === 403 && msg.includes("not engine turn")) return;
        notify(`Engine move failed: ${errorMessage(err)}`, true);
      })
      .finally(() => {
        engineKickInFlight = false;
      });
  }

  async function refreshLegalMoves(): Promise<void> {
    try {
      const payload = store.getState()?.legal;
      if (!payload || !Array.isArray(payload.actions)) return;
      applyLegalAfterPacked(payload);
      queueMicrotask(() => input.consumeAndFirePremove?.());
    } catch (err) {
      notify(`Legal moves fetch failed: ${errorMessage(err)}`, true);
      input.setLegalActions(null);
    } finally {
      queueMicrotask(() => tryRequestEngineMove()); // re-check engine turn after legal refresh
    }
  }
  await refreshLegalMoves();

  let lastEnqueuedSeq = -1;
  const unsubscribeAnimator = store.subscribe((s) => {
    if (!s || !s.pendingAnimation) return;
    // Only the pre-ack client placeholder is optimistic; server-confirmed moves must enqueue.
    if (s.pendingAnimation.optimistic && !s.pendingAnimation.move) return;
    const seq = Number(s.pendingAnimation.last_move_seq);
    if (!Number.isFinite(seq)) return;
    if (seq <= lastEnqueuedSeq) return;
    lastEnqueuedSeq = seq;
    animator.enqueue({
      animation_events: s.pendingAnimation.animation_events,
      next_state: s as unknown as Parameters<typeof animator.enqueue>[0] extends infer T
        ? T extends { next_state?: infer N } ? N : never
        : never,
    });
  });

  const unsubscribeRender = store.subscribe(() => {
    paintChezzShell();
  });

  const unsubscribeTerminalReveal = store.subscribe(() => {
    maybeFinalizeTerminal();
  });

  const unsubscribeEngineKick = store.subscribe(() => tryRequestEngineMove());

  let prevAnimReplay = false;
  const unsubscribeReplay = store.subscribe((s) => {
    if (!s) return;
    const anim = !!s.animationPending;
    if (s.status !== "active") {
      prevAnimReplay = anim;
      return;
    }
    if (prevAnimReplay && !anim) {
      historyNav.onLiveMoveCommitted();
    }
    prevAnimReplay = anim;
  });

  await historyNav.init();
  historyNav.bindUi();
  const phoneDrawer = mountGamePhoneDrawer({ arenaLayoutEvent: CHEZZ_SHELL.arenaLayoutEvent });

  let realtime = connectRealtime({
    gameId,
    sinceSeq: initialRealtimeSinceSeq(state),
    onMoveAccepted: (evt: RealtimeUpdate) => {
      applyMoveAccepted(evt);
    },
    onGameOver: (evt: RealtimeUpdate) => {
      applyLocalTerminal(evt, { immediate: true });
    },
    onChatMessage: (evt: RealtimeUpdate) => {
      const row = evt?.message;
      if (isChatMessage(row)) {
        chatPanel.applySseChat(row);
        maybeApplyTerminalFromDrawAccept(row);
      }
    },
    onStreamOpen: () => {
      void chatPanel.refresh();
    },
    onError: (err) => notify(`Realtime error: ${errorMessage(err)}`, true),
  });

  queueMicrotask(() => {
    requestAnimationFrame(() => tryRequestEngineMove()); // subscribers/layout ready before first PVE kick
  });

  clockTicker.start();
  soundBus.start();
  const boardElement = render.getBoardElement();
  if (boardElement) input.attach(boardElement);

  const gameAppEl = document.getElementById("game-app");
  const unmountArenaLayout =
    gameAppEl && boardElement ? mountChezzArenaLayoutSync(boardElement, gameAppEl) : () => {};

  const surrenderBtn = document.getElementById("game-surrender-btn");
  let lastSurrenderTapAt = 0;

  async function handleSurrender(): Promise<void> {
    const cur = store.getState();
    if (!cur || cur.status !== "active") return;
    const ok = await confirmApp("You will lose by resignation. Continue?", {
      title: "Surrender?",
    });
    if (!ok) return;
    clearInactivityAutoSurrender();
    try {
      const body = await http.surrender(gameId);
      if (isGameOver(body) || (isRecord(body) && body.next_state)) {
        applyLocalTerminal(body, { immediate: true });
      }
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

  if (surrenderBtn) {
    surrenderBtn.addEventListener("pointerup", onSurrenderPointerUp);
    surrenderBtn.addEventListener("click", onSurrenderClick);
  }

  const pvpActions = wirePvpGameActions({
    chatPanel,
    getGameId: () => gameId,
    getState: () => store.getState(),
    notify,
    isPvpActive: (cur) => Boolean(
      cur
      && cur.status === "active"
      && cur.mode !== "pve"
      && !isGameTerminalForShell(cur),
    ),
    canOfferRematch: (cur) => canOfferPvpRematch(cur, "pvp"),
  });

  const INACTIVITY_MS = 2 * 60 * 1000;
  let inactivityTimer: TimeoutHandle = null;

  function resetInactivityTimer(): void {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      const s = store.getState();
      if (!s || s.status !== "active") return;
      const moveCount = Array.isArray(s.move_history) ? s.move_history.length : (Number(s.move_number) || 0); // skip zero-move games (toolbar flow)
      if (moveCount === 0) return;
      notify("Surrendering due to inactivity.");
      markInactivityAutoSurrender();
      void http.surrender(gameId, { cause: "inactivity" })
        .then((body) => {
          if (isGameOver(body) || (isRecord(body) && body.next_state)) {
            applyLocalTerminal(body, { immediate: true });
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

  function teardown(): void {
    if (tornDown) return;
    tornDown = true;
    lifecycleEpoch += 1;
    clearInactivityAutoSurrender();
    historyNav.teardown?.();
    try { realtime.close(); } catch { /* noop */ }
    clockTicker.stop();
    soundBus.stop();
    input.detach();
    if (surrenderBtn) {
      surrenderBtn.removeEventListener("pointerup", onSurrenderPointerUp);
      surrenderBtn.removeEventListener("click", onSurrenderClick);
    }
    pvpActions?.teardown?.();
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
    ACTIVITY_EVENTS.forEach((e) => document.removeEventListener(e, resetInactivityTimer));
    unsubscribeChatShell?.();
    try {
      chatPanel.destroy?.();
    } catch {
      /* noop */
    }
    setActiveGameId(null);
    unsubscribeTerminalReveal?.();
    unsubscribeAnimator?.();
    unsubscribeRender?.();
    unsubscribeEngineKick?.();
    unsubscribeReplay?.();
    phoneDrawer.teardown();
    unmountArenaLayout?.();
    render.reset();
    const overlay = document.getElementById("game-over-overlay");
    if (overlay) {
      overlay.removeAttribute("data-user-dismissed");
      overlay.classList.add("hidden");
    }
    window.removeEventListener("beforeunload", onBeforeUnload);
  }

  const onBeforeUnload = () => teardown();
  window.addEventListener("beforeunload", onBeforeUnload, { once: true });

  const bootState = store.getState();
  if (bootState?.mode === "pvp") {
    await awaitRealtimeAndChatBootstrap({ realtime, chatPanel });
  }
  async function refreshProfilePhotos(): Promise<void> {
    const fresh = await http.loadState(gameId);
    if (!fresh?.players) return;
    store.dispatch({ type: ACTION.PROFILE_REFRESH, payload: { players: fresh.players } });
  }

  return { teardown, gameId, store, refreshProfilePhotos };
}
