import { fetchChat, fetchChatQueueStatus, postChat } from "../../lobby/lobbyNet.js";
import { GAME_CHAT_TAB_OPEN } from "../gameChatUnread.js";
import { parseChatSystemMessage } from "../../../shared/lib/appData.js";
import { safeText } from "../../../shared/lib/utils.js";
import type { ChatMessage } from "../../../shared/contracts.js";
import type { ChatDecision } from "./chatState.js";
import {
  playChatAlertSound,
} from "./chatSoundPrefs.js";
import {
  bumpListPaintEpoch,
  ensureChatSoundToggle,
  isNearBottom,
  isPaintCurrent as listPaintIsCurrent,
  scrollToBottom,
  setChatBootLoading,
  syncChatSoundPrefsUser as setChatSoundPrefsUserId,
} from "./chatPanelDom.js";
import {
  hideQueuePauseBanner,
  updateQueuePauseBanner as paintQueuePauseBanner,
  type ChatQueueStatus,
} from "./chatQueueUi.js";
import {
  buildDrawOfferState,
  buildRematchOfferState,
  chatSoundDedupeKey,
  chatRowRank,
  isChatMessage,
  isOpponentIncomingNotify,
  maxChatId,
  mergeChatHistory,
  preferChatRow,
  reconcileTemps,
  shouldMergeChatRows,
} from "./chatState.js";
import {
  chatRowBelongsToGame,
  filterChatRowsForGame,
  makeOptimisticChatMessage,
  OutboundChatTracker,
  playIncomingChatSounds,
  primeIncomingChatHistory,
} from "./chatPanelMessages.js";
import {
  makeChatMessageNode,
  makeEmptyChatNode,
  makePveOfflineChatNode,
} from "./chatRender.js";

interface ChatUser {
  id: string | number;
  username?: string;
}

interface SocialResponse {
  chat_queue?: ChatQueueStatus;
  game_over?: unknown;
  message?: ChatMessage;
  rematch?: { game_id?: string };
}

interface ChatPanelDeps {
  getGameId?: () => string;
  getUser?: () => ChatUser | null;
  inputEl?: HTMLInputElement | HTMLTextAreaElement | null;
  listEl?: HTMLElement | null;
  notify?: (message: string, isError?: boolean) => void;
  onOpponentIncoming?: (() => void) | null;
  onRematchAccepted?: (gameId: string) => Promise<void>;
  onSystemAction?: () => Promise<void>;
  respondDraw?: ((offerId: number, decision: ChatDecision) => Promise<SocialResponse>) | null;
  respondRematch?: ((offerId: number, decision: ChatDecision) => Promise<SocialResponse>) | null;
  sendButton?: HTMLButtonElement | null;
}

/** Max height (px) for the compose box; grows upward from the bottom row until capped. */
const CHAT_COMPOSER_MAX_PX = 120;
/** Poll interval while the outbound chat queue is draining after a 503. */
const CHAT_QUEUE_POLL_MS = 1000;
export function createChatPanel(deps: ChatPanelDeps = {}) {
  const {
    listEl,
    inputEl,
    sendButton,
    getUser = () => null,
    getGameId = () => "",
    notify = () => {},
    respondDraw = null,
    respondRematch = null,
    onSystemAction = async () => {},
    onRematchAccepted = async () => {},
    onOpponentIncoming = null,
  } = deps;

  let bound = false;
  let active = false;
  let sending = false;
  let gameEnded = false;
  /** After first successful full ``GET /api/chat``, use incremental fetches + SSE. */
  let fullHistoryLoaded = false;
  /** Engine (PVE) games: show chat chrome but do not poll or send. */
  let pveOffline = false;
  let latestMessages: ChatMessage[] = [];
  /** Tracks in-flight draw accept/reject keys to disable buttons optimistically. */
  const pendingDrawActions = new Set<string>();
  const pendingRematchActions = new Set<string>();
  const bootedRematchGameIds = new Set<string>();
  const rematchBootInflight = new Map<string, Promise<void>>();
  /** Chat sound dedupe across message id changes (tmp_* -> real bigserial). */
  const playedSoundKeys = new Set<string>();
  /** Client tmp rows until POST/SSE/GET confirms the same logical message. */
  const outboundPending = new OutboundChatTracker();
  let bootLoading = false;
  let boundGameId = "";
  let paintEpoch = 0;
  /** Poll chat while the match is over (SSE cursor can lag after terminal). */
  let endedPollTimer: number | null = null;
  /** True while the server outbound queue is full or still draining after backpressure. */
  let queuePaused = false;
  let queuePausePollTimer: number | null = null;
  let queuePauseBannerEl: HTMLElement | null = null;
  let chatTabScrollAbort: AbortController | null = null;
  /** Force bottom stick on the next render after the user opens the Chat tab. */
  let scrollOnNextRender = false;
  let onSendClick: (() => void) | null = null;
  let onInputKeydown: EventListener | null = null;
  let onInputInput: (() => void) | null = null;

  function resolveGameId(): string {
    return String(boundGameId || getGameId() || "").trim();
  }

  function currentUserId(): string {
    const user = getUser();
    return user?.id != null ? String(user.id) : "";
  }

  function isPaintCurrent(): boolean {
    return listPaintIsCurrent(listEl, paintEpoch);
  }

  function rowBelongsToCurrentGame(row: ChatMessage): boolean {
    return chatRowBelongsToGame(row, resolveGameId());
  }

  function filterRowsForCurrentGame(rows: ChatMessage[]): ChatMessage[] {
    return filterChatRowsForGame(rows, resolveGameId());
  }

  /** Seed ids/fingerprints on first history load - no notify sound or unread bump. */

  function primeIncomingHistory(incoming: ChatMessage[]): void {
    primeIncomingChatHistory(incoming, playedSoundKeys);
  }

  function playSoundsForIncoming(
    prevIds: Set<number | string>,
    incoming: ChatMessage[],
    currentUserId: string,
  ): void {
    playIncomingChatSounds({
      currentUserId,
      incoming,
      onOpponentIncoming,
      playedSoundKeys,
      playSound: playChatAlertSound,
      prevIds,
    });
  }

  function setBootLoading(loading: boolean): void {
    bootLoading = Boolean(loading);
    setChatBootLoading(listEl, bootLoading);
  }

  function syncChatSoundPrefsUser(): void {
    const user = getUser();
    const id = user?.id != null ? String(user.id) : "";
    setChatSoundPrefsUserId(id);
  }

  async function maybeBootRematch(gameId: unknown): Promise<void> {
    const id = safeText(gameId, "");
    if (!id) return;
    const inflight = rematchBootInflight.get(id);
    if (inflight) return inflight;
    if (bootedRematchGameIds.has(id)) return;
    const task = (async () => {
      try {
        await onRematchAccepted(id);
        bootedRematchGameIds.add(id);
      } catch (err) {
        bootedRematchGameIds.delete(id);
        throw err;
      } finally {
        rematchBootInflight.delete(id);
      }
    })();
    rematchBootInflight.set(id, task);
    return task;
  }

  /** Fire-and-forget rematch boot with toast on failure (SSE / history scan). */

  function scheduleRematchBoot(gameId: unknown): void {
    void maybeBootRematch(gameId).catch((err) => {
      notify(err instanceof Error ? err.message : "Rematch failed.", true);
    });
  }

  function scanRematchAccepts(messages: ChatMessage[] = []): void {
    // accepter must await boot in onrematchdecision - SSE/refresh must not race teardown.
    for (const key of pendingRematchActions) {
      if (String(key).endsWith(":accept")) return;
    }
    const state = buildRematchOfferState(messages);
    for (const entry of state.values()) {
      if (safeText(entry.status, "").toLowerCase() === "accepted") {
        scheduleRematchBoot(entry.gameId);
      }
    }
  }

  function setSending(nextSending: boolean): void {
    sending = Boolean(nextSending);
    syncInputDisabled();
  }

  function updateQueuePauseBanner(chatQueue: ChatQueueStatus): void {
    queuePauseBannerEl = paintQueuePauseBanner(inputEl, queuePauseBannerEl, chatQueue);
  }

  function stopQueuePausePoll() {
    if (queuePausePollTimer != null) {
      window.clearInterval(queuePausePollTimer);
      queuePausePollTimer = null;
    }
  }

  function startQueuePausePoll() {
    stopQueuePausePoll();
    const tick = () => {
      void pollChatQueueUntilReady();
    };
    queuePausePollTimer = window.setInterval(tick, CHAT_QUEUE_POLL_MS);
    void tick();
  }

  async function pollChatQueueUntilReady() {
    if (!queuePaused || pveOffline) {
      return;
    }
    const gameId = resolveGameId();
    if (!gameId) {
      return;
    }
    try {
      const data = await fetchChatQueueStatus(gameId);
      const cq = data?.chat_queue;
      if (cq?.ready) {
        endQueuePause();
        return;
      }
      if (cq) {
        updateQueuePauseBanner(cq);
      }
    } catch {
      /* ignore transient poll errors */
    }
  }

  function beginQueuePause(chatQueue: ChatQueueStatus): void {
    if (pveOffline || gameEnded) {
      return;
    }
    queuePaused = true;
    updateQueuePauseBanner(chatQueue);
    syncInputDisabled();
    startQueuePausePoll();
  }

  function endQueuePause() {
    if (!queuePaused) {
      return;
    }
    queuePaused = false;
    hideQueuePauseBanner(queuePauseBannerEl);
    stopQueuePausePoll();
    syncInputDisabled();
  }

  function syncInputDisabled() {
    const dis = gameEnded || pveOffline || queuePaused;
    const controlsEl = inputEl?.closest(".chat-controls");
    if (controlsEl) {
      controlsEl.classList.toggle("chat-disabled", dis);
    }
    if (inputEl) inputEl.disabled = dis;
    if (sendButton) sendButton.disabled = dis;
  }

  function autoResizeComposer() {
    if (!inputEl || inputEl.tagName !== "TEXTAREA") return;
    if (pveOffline || gameEnded) return;
    let cap = CHAT_COMPOSER_MAX_PX;
    try {
      const mh = window.getComputedStyle(inputEl).maxHeight;
      const parsed = parseFloat(mh);
      if (Number.isFinite(parsed) && String(mh).trim().endsWith("px")) {
        cap = parsed;
      }
    } catch {
      /* ignore */
    }
    inputEl.style.height = "auto";
    const h = Math.min(inputEl.scrollHeight, cap);
    inputEl.style.height = `${Math.max(36, h)}px`;
  }

  function scheduleScrollToBottom(force = false): void {
    if (!listEl) {
      return;
    }
    const run = () => scrollToBottom(listEl);
    if (force) {
      run();
      queueMicrotask(run);
      requestAnimationFrame(run);
      return;
    }
    queueMicrotask(run);
  }

  function renderMessages(
    messages: ChatMessage[] = [],
    opts: { forceScrollToBottom?: boolean } = {},
  ): void {
    if (!listEl || pveOffline || !isPaintCurrent()) {
      return;
    }
    messages = filterRowsForCurrentGame(messages);
    const user = getUser();
    const currentUserId = user?.id ? String(user.id) : "";
    const forceBottom = opts.forceScrollToBottom === true || scrollOnNextRender;
    if (scrollOnNextRender) {
      scrollOnNextRender = false;
    }
    const shouldStickToBottom = forceBottom || isNearBottom(listEl);
    const normalizedMessages = Array.isArray(messages) ? messages : [];
    latestMessages = normalizedMessages;
    const drawOfferState = buildDrawOfferState(normalizedMessages);
    const rematchOfferState = buildRematchOfferState(normalizedMessages);
    const fragment = document.createDocumentFragment();

    if (normalizedMessages.length === 0) {
      fragment.appendChild(makeEmptyChatNode());
    } else {
      for (const message of normalizedMessages) {
        const row = makeChatMessageNode(message, {
          currentUserId,
          drawOfferState,
          pendingDrawActions,
          onDrawDecision,
          rematchOfferState,
          pendingRematchActions,
          onRematchDecision,
        });
        if (row) {
          fragment.appendChild(row);
        }
      }
      if (!fragment.firstChild) {
        fragment.appendChild(makeEmptyChatNode());
      }
    }

    if (gameEnded) {
      const banner = document.createElement("div");
      banner.className = "chat-ended-banner";
      banner.textContent = "Game ended";
      fragment.appendChild(banner);
    }

    listEl.replaceChildren(fragment);
    scanRematchAccepts(normalizedMessages);
    if (forceBottom || shouldStickToBottom || normalizedMessages.length === 0) {
      scheduleScrollToBottom(forceBottom);
    }
  }

  function rememberOutbound(row: ChatMessage): void {
    outboundPending.remember(row);
  }

  function clearOutboundForRow(row: ChatMessage): void {
    outboundPending.clearForRow(row);
  }

  function mergeOutboundPending(messages: ChatMessage[]): ChatMessage[] {
    return outboundPending.merge(messages);
  }

  async function onRematchDecision(offerId: number, decision: ChatDecision): Promise<void> {
    if (!active || typeof respondRematch !== "function") return;
    const key = `${offerId}:${decision}`;
    if (pendingRematchActions.has(key)) return;

    pendingRematchActions.add(key);
    renderMessages(latestMessages);
    let rematchBooted = false;
    try {
      const body = await respondRematch(offerId, decision);
      if (decision === "accept") {
        let rematchGameId = safeText(body?.rematch?.game_id, "");
        if (!rematchGameId && body?.message) {
          const parsed = parseChatSystemMessage(body.message?.body);
          if (
            parsed?.kind === "rematch_offer_update"
            && safeText(parsed.decision, "").toLowerCase() === "accept"
          ) {
            rematchGameId = safeText(parsed.gameId, "");
          }
        }
        if (rematchGameId) {
          await maybeBootRematch(rematchGameId);
          rematchBooted = true;
          return;
        }
      }
      const update = body?.message;
      if (update && typeof update === "object") {
        applySseChat(update);
      }
      await refresh();
      await onSystemAction();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      notify(
        msg || (decision === "accept" ? "Rematch failed." : "Could not respond to rematch offer."),
        true,
      );
    } finally {
      pendingRematchActions.delete(key);
      if (!rematchBooted) {
        renderMessages(latestMessages);
      }
    }
  }

  async function onDrawDecision(offerId: number, decision: ChatDecision): Promise<void> {
    if (!active || typeof respondDraw !== "function") {
      return;
    }
    const key = `${offerId}:${decision}`;
    if (pendingDrawActions.has(key)) {
      return;
    }

    pendingDrawActions.add(key);
    renderMessages(latestMessages);
    try {
      const body = await respondDraw(offerId, decision);
      const update = body?.message;
      if (update && typeof update === "object") {
        upsertChatRow(update, { playAlerts: false });
      }
      await refresh();
      await onSystemAction();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not respond to draw offer.", true);
    } finally {
      pendingDrawActions.delete(key);
      renderMessages(latestMessages);
    }
  }

  let refreshInFlight: Promise<void> | null = null;

  /** Fetches messages from the server (full load or incremental by id). */

  async function refresh(): Promise<void> {
    if (!active && !gameEnded) {
      return;
    }
    if (refreshInFlight) {
      return refreshInFlight;
    }
    refreshInFlight = (async () => {
      const epoch = paintEpoch;
      const gameId = resolveGameId();
      const firstLoad = !fullHistoryLoaded;
      if (!gameId) {
        return;
      }
      try {
        const sinceId = maxChatId(latestMessages);
        const incremental = fullHistoryLoaded;
        const payload = incremental && sinceId > 0
          ? await fetchChat(sinceId, gameId)
          : await fetchChat(null, gameId);
        if (!isPaintCurrent() || epoch !== paintEpoch) {
          return;
        }
        const payloadGameId = String(payload?.game_id || "").trim();
        if (payloadGameId && payloadGameId !== gameId) {
          return;
        }
        const incoming = filterRowsForCurrentGame(
          Array.isArray(payload?.messages) ? payload.messages : [],
        );
        const prevIds = new Set((latestMessages || []).map((m) => m.id).filter((id) => id != null));
        const userId = currentUserId();
        if (firstLoad) {
          primeIncomingHistory(incoming);
          for (const msg of incoming) {
            if (msg?.id != null) prevIds.add(msg.id);
          }
        } else {
          playSoundsForIncoming(prevIds, incoming, userId);
        }
        const { base, delta } = reconcileTemps(latestMessages || [], incoming);
        let next = mergeChatHistory(base, delta);
        next = mergeOutboundPending(next);
        for (const row of next) {
          clearOutboundForRow(row);
        }
        if (!isPaintCurrent() || epoch !== paintEpoch) {
          return;
        }
        renderMessages(next, { forceScrollToBottom: firstLoad });
        fullHistoryLoaded = true;
      } catch {
        // keep chat silent on polling failures.
      } finally {
        if (epoch === paintEpoch) {
          refreshInFlight = null;
        }
      }
    })();
    return refreshInFlight;
  }

  function removeChatRowById(id: number | string): void {
    const next = (latestMessages || []).filter((m) => m.id !== id);
    if (next.length === (latestMessages || []).length) return;
    renderMessages(next);
  }

  function upsertChatRow(row: ChatMessage, opts: { playAlerts?: boolean } = {}): boolean {
    const playAlerts = opts.playAlerts !== false;
    if (pveOffline || !row || typeof row !== "object" || !rowBelongsToCurrentGame(row)) {
      return false;
    }
    if (!isPaintCurrent()) {
      return false;
    }
    const rid = row.id;
    if (rid != null && (latestMessages || []).some((m) => m.id === rid)) {
      clearOutboundForRow(row);
      return false;
    }
    const mergeIdx = (latestMessages || []).findIndex((m) => shouldMergeChatRows(m, row));
    if (mergeIdx >= 0) {
      const existing = latestMessages[mergeIdx];
      const preferred = preferChatRow(existing, row);
      clearOutboundForRow(preferred);
      if (preferred.id === existing.id && chatRowRank(preferred) === chatRowRank(existing)) {
        return false;
      }
      const next = [...latestMessages];
      next[mergeIdx] = preferred;
      renderMessages(next);
      return false;
    }
    if (!playAlerts) {
      const fp = chatSoundDedupeKey(row);
      if (fp) playedSoundKeys.add(fp);
    } else {
      const prevIds = new Set((latestMessages || []).map((m) => m.id).filter((id) => id != null));
      const userId = currentUserId();
      playSoundsForIncoming(prevIds, [row], userId);
    }
    const parsed = parseChatSystemMessage(row?.body);
    if (
      parsed?.kind === "rematch_offer_update"
      && safeText(parsed.decision, "").toLowerCase() === "accept"
      && safeText(parsed.gameId, "")
    ) {
      scheduleRematchBoot(parsed.gameId);
    }
    const next = mergeChatHistory(latestMessages, [row]);
    clearOutboundForRow(row);
    renderMessages(next);
    return true;
  }

  function applySseChat(row: ChatMessage): void {
    if (!row || typeof row !== "object" || pveOffline || !rowBelongsToCurrentGame(row)) {
      return;
    }
    if (!isPaintCurrent()) {
      queueMicrotask(() => applySseChat(row));
      return;
    }
    const userId = currentUserId();
    const playAlerts = isOpponentIncomingNotify(row, userId);
    const parsed = parseChatSystemMessage(row?.body);
    const inserted = upsertChatRow(row, { playAlerts });
    const systemKind = parsed?.kind;
    const opponentSystem = playAlerts && (
      systemKind === "draw_offer"
      || systemKind === "rematch_offer"
      || systemKind === "rematch_offer_update"
    );
    if (opponentSystem && (!inserted || gameEnded)) {
      queueMicrotask(() => void refresh());
    }
  }

  function ingestChatRow(
    row: ChatMessage,
    opts: { playAlerts?: boolean; refresh?: boolean } = {},
  ): void {
    if (!row || typeof row !== "object") {
      return;
    }
    if (!isPaintCurrent()) {
      queueMicrotask(() => ingestChatRow(row, opts));
      return;
    }
    const shouldRefresh = opts.refresh !== false;
    const userId = currentUserId();
    const playAlerts = opts.playAlerts === false
      ? false
      : isOpponentIncomingNotify(row, userId);
    const parsed = parseChatSystemMessage(row?.body);
    const inserted = upsertChatRow(row, { playAlerts });
    const isOffer = parsed?.kind === "draw_offer" || parsed?.kind === "rematch_offer";
    if (shouldRefresh && (active || gameEnded || isOffer)) {
      void refresh();
    } else if (isOffer && !inserted) {
      void refresh();
    }
  }

  /** Sends the text in the input field - optimistic UI, POST + SSE reconcile ids. */

  async function send() {
    if (!active || pveOffline) {
      return;
    }
    if (queuePaused) {
      notify("Chat is paused while messages catch up.", true);
      return;
    }
    const text = safeText(inputEl?.value, "").trim();
    if (!text) {
      return;
    }
    const user = getUser();
    if (!user?.id) {
      notify("Could not send message.", true);
      return;
    }

    const gameId = resolveGameId();
    if (!gameId) {
      notify("Could not send message.", true);
      return;
    }

    const optimistic = makeOptimisticChatMessage({
      body: text,
      gameId,
      userId: user.id,
      username: user.username,
    });

    if (inputEl) {
      inputEl.value = "";
      inputEl.focus();
      autoResizeComposer();
    }
    rememberOutbound(optimistic);
    upsertChatRow(optimistic, { playAlerts: false });

    try {
      const posted = await postChat(text, gameId);
      if (isChatMessage(posted)) {
        upsertChatRow(posted, { playAlerts: false });
        clearOutboundForRow(posted);
      } else {
        await refresh();
      }
      const chatQueue = (posted as { chat_queue?: ChatQueueStatus }).chat_queue;
      if (chatQueue?.accepting === false) {
        beginQueuePause(chatQueue);
      }
    } catch (error) {
      outboundPending.delete(optimistic.id);
      removeChatRowById(optimistic.id);
      const requestError = error as {
        message?: string;
        payload?: { chat_queue?: ChatQueueStatus };
        status?: number;
      };
      const cq = requestError.payload?.chat_queue;
      if (requestError.status === 503 && cq) {
        beginQueuePause(cq);
      }
      const message = String(requestError.message || "Could not send message.");
      notify(message, true);
    }
  }

  function setActive(nextActive: boolean): void {
    if (nextActive && pveOffline) {
      return;
    }
    const wasActive = active;
    active = Boolean(nextActive);
    if (!active) {
      syncEndedPoll();
      return;
    }
    syncChatSoundPrefsUser();
    if (!wasActive) {
      void refresh();
    }
    syncEndedPoll();
  }

  function setPveOffline(isPve: boolean): void {
    const next = Boolean(isPve);
    const was = pveOffline;
    pveOffline = next;
    const dock = listEl?.closest(".game-chat-panel");
    dock?.classList.toggle("game-chat-panel--pve-offline", pveOffline);
    if (pveOffline && !was) {
      active = false;
      latestMessages = [];
      listEl?.replaceChildren(makePveOfflineChatNode());
    } else if (!pveOffline && was) {
      latestMessages = [];
      listEl?.replaceChildren(makeEmptyChatNode());
    }
    syncInputDisabled();
    if (!pveOffline) {
      autoResizeComposer();
    }
  }

  function bindEvents() {
    if (bound) {
      return;
    }
    bound = true;

    onSendClick = () => {
      void send();
    };
    onInputKeydown = (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key !== "Enter") {
        return;
      }
      if (inputEl?.tagName === "TEXTAREA" && keyEvent.shiftKey) {
        queueMicrotask(() => autoResizeComposer());
        return;
      }
      keyEvent.preventDefault();
      void send();
    };
    onInputInput = () => {
      autoResizeComposer();
    };

    sendButton?.addEventListener("click", onSendClick);
    inputEl?.addEventListener("keydown", onInputKeydown);
    inputEl?.addEventListener("input", onInputInput);
  }

  function unbindEvents() {
    if (!bound) {
      return;
    }
    bound = false;
    if (onSendClick) {
      sendButton?.removeEventListener("click", onSendClick);
      onSendClick = null;
    }
    if (onInputKeydown) {
      inputEl?.removeEventListener("keydown", onInputKeydown);
      onInputKeydown = null;
    }
    if (onInputInput) {
      inputEl?.removeEventListener("input", onInputInput);
      onInputInput = null;
    }
  }

  function syncEndedPoll() {
    if (endedPollTimer != null) {
      window.clearInterval(endedPollTimer);
      endedPollTimer = null;
    }
    if (!active || pveOffline || !gameEnded) {
      return;
    }
    endedPollTimer = window.setInterval(() => {
      if (active && gameEnded && !pveOffline) {
        void refresh();
      }
    }, 10000);
  }

  function setGameEnded(ended: boolean): void {
    gameEnded = Boolean(ended);
    syncInputDisabled();
    if (!pveOffline) {
      renderMessages(latestMessages);
    }
    autoResizeComposer();
    syncEndedPoll();
  }

  function setGameId(gameId: string): void {
    boundGameId = String(gameId || "").trim();
    reset();
  }

  /** Resets the panel to its initial empty state. */

  function reset() {
    if (endedPollTimer != null) {
      window.clearInterval(endedPollTimer);
      endedPollTimer = null;
    }
    endQueuePause();
    paintEpoch = bumpListPaintEpoch(listEl);
    refreshInFlight = null;
    active = false;
    gameEnded = false;
    pveOffline = false;
    fullHistoryLoaded = false;
    listEl?.closest(".game-chat-panel")?.classList.remove("game-chat-panel--pve-offline");
    if (listEl) {
      listEl.replaceChildren(makeEmptyChatNode());
    }
    if (inputEl) {
      inputEl.value = "";
      inputEl.disabled = false;
      if (inputEl.tagName === "TEXTAREA") {
        inputEl.style.height = "";
      }
    }
    const controlsEl = inputEl?.closest(".chat-controls");
    if (controlsEl) controlsEl.classList.remove("chat-disabled");
    latestMessages = [];
    pendingDrawActions.clear();
    pendingRematchActions.clear();
    bootedRematchGameIds.clear();
    rematchBootInflight.clear();
    playedSoundKeys.clear();
    outboundPending.clear();
    setSending(false);
    setBootLoading(false);
    autoResizeComposer();
  }

  function bindChatTabScrollOnOpen() {
    chatTabScrollAbort?.abort();
    chatTabScrollAbort = new AbortController();
    window.addEventListener(
      GAME_CHAT_TAB_OPEN,
      () => {
        if (!active || pveOffline) {
          return;
        }
        if (gameEnded) {
          void refresh();
        }
        scrollOnNextRender = true;
        scheduleScrollToBottom(true);
      },
      { signal: chatTabScrollAbort.signal },
    );
  }

  function init() {
    bindEvents();
    bindChatTabScrollOnOpen();
    if (!boundGameId) {
      boundGameId = String(getGameId() || "").trim();
    }
    reset();
    syncChatSoundPrefsUser();
    ensureChatSoundToggle(listEl, currentUserId());
    queueMicrotask(() => autoResizeComposer());
  }

  function destroy() {
    reset();
    unbindEvents();
    chatTabScrollAbort?.abort();
    chatTabScrollAbort = null;
  }

  return {
    init,
    reset,
    destroy,
    setGameId,
    refresh,
    scrollToBottom: () => scheduleScrollToBottom(true),
    setActive,
    setGameEnded,
    setPveOffline,
    setBootLoading,
    applySseChat,
    ingestChatRow,
  };
}
