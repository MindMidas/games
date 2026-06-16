const SSE = Object.freeze({
  MOVE_ACCEPTED: "move_accepted",
  SHOT_ACCEPTED: "shot_accepted",
  GAME_OVER: "game_over",
  CHAT_MESSAGE: "chat_message",
});

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30000;

export interface RealtimeUpdate {
  type?: string;
  message?: Record<string, unknown>;
  [key: string]: unknown;
}

interface RealtimeConfig {
  gameId: string;
  sinceSeq?: number;
  onMoveAccepted?: (event: RealtimeUpdate) => void;
  onShotAccepted?: (event: RealtimeUpdate) => void;
  onGameOver?: (event: RealtimeUpdate) => void;
  onChatMessage?: (event: RealtimeUpdate) => void;
  onCursor?: (lastSeq: number) => void;
  onStreamOpen?: () => void;
  onError?: (error: unknown) => void;
}

export interface RealtimeConnection {
  close(): void;
  ready: Promise<void>;
}

function buildStreamUrl(gameId: string, sinceSeq: number | null): string {
  const params = new URLSearchParams();
  if (gameId) {
    params.set("game_id", gameId);
  }
  if (Number.isFinite(sinceSeq)) {
    params.set("since_seq", String(sinceSeq));
  }
  const q = params.toString();
  return q ? `/api/realtime/stream?${q}` : "/api/realtime/stream";
}

export function connectRealtime(cfg: RealtimeConfig): RealtimeConnection {
  const {
    gameId,
    sinceSeq = -1, // seq > since_seq; avoid 0 on fresh boards with stream_seq 0
    onMoveAccepted = () => {},
    onShotAccepted = () => {},
    onGameOver = () => {},
    onChatMessage = () => {},
    onCursor = () => {},
    onStreamOpen = () => {},
    onError = () => {},
  } = cfg || {};

  let lastSeq = Number.isFinite(sinceSeq) ? sinceSeq : -1;
  let source: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let closed = false;
  let readyResolved = false;
  let resolveReady = () => {};
  /** Resolves once the EventSource fires its first `open` (per connection instance). */
  const ready = new Promise<void>((resolve) => {
    resolveReady = () => {
      if (readyResolved) return;
      readyResolved = true;
      resolve();
    };
  });

  function dispatchUpdate(update: RealtimeUpdate): void {
    if (!update || typeof update !== "object") return;
    const type = String(update.type || "");
    if (type === SSE.MOVE_ACCEPTED) {
      onMoveAccepted(update);
    } else if (type === SSE.SHOT_ACCEPTED) {
      onShotAccepted(update);
    } else if (type === SSE.GAME_OVER) {
      onGameOver(update);
    } else if (type === SSE.CHAT_MESSAGE) {
      onChatMessage(update);
    }
  }

  function dispatchChatPayload(data: RealtimeUpdate): void {
    if (!data || typeof data !== "object") return;
    const row = data.message;
    if (!row || typeof row !== "object") return;
    onChatMessage({ type: SSE.CHAT_MESSAGE, message: row });
  }

  /** Realign cursor when the server log resets (session re-hydrate) so chat is not stuck. */
  function applySeqCursor(seq: number): void {
    if (!Number.isFinite(seq)) return;
    const prev = lastSeq;
    if (seq < prev) {
      lastSeq = seq;
      onStreamOpen();
    } else {
      lastSeq = Math.max(lastSeq, seq);
    }
    onCursor(lastSeq);
  }

  function handleUpdatesEvent(event: Event): void {
    let payload: { updates?: RealtimeUpdate[]; last_seq?: number } | null = null;
    try {
      payload = JSON.parse(String((event as MessageEvent).data || "{}"));
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") return;
    const updates = Array.isArray(payload.updates) ? payload.updates : [];
    for (const update of updates) dispatchUpdate(update);
    applySeqCursor(Number(payload.last_seq));
  }

  function scheduleReconnect(): void {
    if (closed) return;
    if (reconnectTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(MAX_BACKOFF_MS, Math.max(INITIAL_BACKOFF_MS, backoffMs * 2));
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  }

  function open(): void {
    if (closed) return;
    try {
      const url = buildStreamUrl(gameId, lastSeq);
      const nextSource = new EventSource(url, { withCredentials: true });
      source = nextSource;

      nextSource.addEventListener("open", () => {
        if (closed || source !== nextSource) return;
        backoffMs = INITIAL_BACKOFF_MS;
        resolveReady();
        onStreamOpen();
      });
      nextSource.addEventListener("updates", (event) => {
        if (closed || source !== nextSource) return;
        handleUpdatesEvent(event);
      });
      nextSource.addEventListener("chat", (event) => {
        if (closed || source !== nextSource) return;
        let data: RealtimeUpdate & { last_seq?: number } | null = null;
        try {
          data = JSON.parse(String((event as MessageEvent).data || "{}"));
        } catch {
          return;
        }
        if (!data || typeof data !== "object") return;
        dispatchChatPayload(data);
        applySeqCursor(Number(data?.last_seq));
      });
      // Cursor frames are informational; advancing lastSeq here can skip updates if the
      // connection drops before the following "updates" batch is processed.
      nextSource.addEventListener("cursor", () => {});
      nextSource.addEventListener("error", (event) => {
        if (closed || source !== nextSource) return;
        try { nextSource.close(); } catch { /* noop */ }
        if (source === nextSource) source = null;
        onError(event);
        scheduleReconnect();
      });
    } catch (err) {
      onError(err);
      scheduleReconnect();
    }
  }

  function close(): void {
    closed = true;
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (source) {
      try { source.close(); } catch { /* noop */ }
      source = null;
    }
  }

  open();
  return { close, ready };
}
