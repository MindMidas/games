import type { ChatMessage } from "../../../shared/contracts.js";
import { parseChatSystemMessage } from "../../../shared/lib/appData.js";
import { safeText } from "../../../shared/lib/utils.js";

export type ChatDecision = "accept" | "reject";

export interface ChatOfferState {
  offerId: number;
  status: "pending" | "accepted" | "rejected";
  offeredBy?: string;
  offeredByUserId?: string;
  decision?: ChatDecision;
  actor?: string;
  actorUserId?: string;
  gameId?: string;
}

function rowTimestamp(row: ChatMessage): number {
  return new Date(row.created_at || 0).getTime();
}

/** Validate the shared fields required by chat state and rendering. */
export function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ChatMessage>;
  return (typeof row.id === "number" || typeof row.id === "string")
    && typeof row.game_id === "string"
    && typeof row.user_id === "string"
    && typeof row.body === "string"
    && typeof row.created_at === "string";
}

/** Return whether an id belongs to an optimistic or queued chat row. */
export function isTempChatId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith("tmp_");
}

/** Return whether an id belongs specifically to a client-side optimistic row. */
export function isClientTempChatId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith("tmp_client_");
}

/** Return the newest persisted chat id, excluding temporary rows. */
export function maxChatId(messages: readonly ChatMessage[]): number {
  let max = 0;
  for (const message of messages) {
    if (isTempChatId(message.id)) continue;
    const id = Number(message.id);
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max;
}

/** Build a stable key for chat rows that may receive a new database id later. */
export function chatMessageFingerprint(message: ChatMessage): string {
  const body = String(message.body || "");
  const userId = String(message.user_id || "");
  const parsed = parseChatSystemMessage(body);
  if (parsed?.kind === "draw_offer") return `draw_offer:${parsed.offerId}:${userId}`;
  if (parsed?.kind === "draw_offer_update") {
    return `draw_offer_update:${parsed.offerId}:${parsed.decision}:${userId}`;
  }
  if (parsed?.kind === "rematch_offer") return `rematch_offer:${parsed.offerId}:${userId}`;
  if (parsed?.kind === "rematch_offer_update") {
    return `rematch_offer_update:${parsed.offerId}:${parsed.decision}:${userId}`;
  }
  if (parsed?.kind === "surrender") return `surrender:${userId}`;
  return `text:${userId}:${body}`;
}

/** Build a key used to avoid replaying sound after a temporary id becomes durable. */
export function chatSoundDedupeKey(message: ChatMessage): string {
  if (Number.isFinite(Number(message.id))) return `id:${message.id}`;
  return `${chatMessageFingerprint(message)}:${String(message.created_at || message.id || "")}`;
}

/** Rank rows so durable database rows replace queued and optimistic copies. */
export function chatRowRank(row: ChatMessage): number {
  if (Number.isFinite(Number(row.id))) return 3;
  if (typeof row.id === "string" && row.id.startsWith("tmp_") && !isClientTempChatId(row.id)) {
    return 2;
  }
  return isClientTempChatId(row.id) ? 1 : 0;
}

/** Prefer a durable row over its queued or optimistic representation. */
export function preferChatRow(first: ChatMessage, second: ChatMessage): ChatMessage {
  const firstRank = chatRowRank(first);
  const secondRank = chatRowRank(second);
  if (firstRank !== secondRank) return firstRank > secondRank ? first : second;
  return rowTimestamp(second) >= rowTimestamp(first) ? second : first;
}

/** Return whether two rows represent the same logical send. */
export function shouldMergeChatRows(existing: ChatMessage, incoming: ChatMessage): boolean {
  if (existing.id === incoming.id) return true;
  if (isClientTempChatId(existing.id) && isClientTempChatId(incoming.id)) return false;
  if (!isTempChatId(existing.id) && !isTempChatId(incoming.id)) return false;
  if (existing.user_id !== incoming.user_id || existing.body !== incoming.body) return false;
  const existingSystem = parseChatSystemMessage(existing.body);
  const incomingSystem = parseChatSystemMessage(incoming.body);
  return !existingSystem && !incomingSystem
    ? true
    : chatMessageFingerprint(existing) === chatMessageFingerprint(incoming);
}

/** Merge history, SSE, queued and optimistic rows into display order. */
export function mergeChatHistory(
  base: readonly ChatMessage[],
  delta: readonly ChatMessage[],
): ChatMessage[] {
  const rows = new Map<number | string, ChatMessage>();
  for (const message of [...base, ...delta]) {
    const key = message.id ?? chatMessageFingerprint(message);
    const previous = rows.get(key);
    rows.set(key, previous ? preferChatRow(previous, message) : message);
  }
  return [...rows.values()].sort((first, second) => {
    const firstReal = Number.isFinite(Number(first.id));
    const secondReal = Number.isFinite(Number(second.id));
    if (firstReal && secondReal) return Number(first.id) - Number(second.id);
    const difference = rowTimestamp(first) - rowTimestamp(second);
    return difference || (firstReal ? -1 : 1);
  });
}

/** Promote optimistic rows when matching durable rows arrive from history polling. */
export function reconcileTemps(
  base: readonly ChatMessage[],
  delta: readonly ChatMessage[],
): { base: ChatMessage[]; delta: ChatMessage[] } {
  const temps = base.filter((message) => isTempChatId(message.id));
  if (!temps.length || !delta.length) return { base: [...base], delta: [...delta] };

  const matchedTempIds = new Set<string>();
  const matchedRealIds = new Set<number | string>();
  for (const real of delta) {
    if (!Number.isFinite(Number(real.id))) continue;
    const temp = temps.find((candidate) =>
      !matchedTempIds.has(String(candidate.id))
      && candidate.user_id === real.user_id
      && candidate.body === real.body
    );
    if (!temp) continue;
    matchedTempIds.add(String(temp.id));
    matchedRealIds.add(real.id);
  }
  if (!matchedTempIds.size) return { base: [...base], delta: [...delta] };

  return {
    base: base.map((message) => {
      if (!matchedTempIds.has(String(message.id))) return message;
      return delta.find((row) => row.user_id === message.user_id && row.body === message.body)
        ?? message;
    }),
    delta: delta.filter((message) => !matchedRealIds.has(message.id)),
  };
}

/** Return whether an incoming row should trigger an opponent chat alert. */
export function isOpponentIncomingNotify(message: ChatMessage, currentUserId: string): boolean {
  if (message.user_id === currentUserId) return false;
  const parsed = parseChatSystemMessage(message.body);
  return !parsed
    || parsed.kind === "draw_offer"
    || parsed.kind === "rematch_offer"
    || parsed.kind === "draw_offer_update"
    || parsed.kind === "rematch_offer_update";
}

/** Reconstruct the current draw-offer state from persisted system messages. */
export function buildDrawOfferState(messages: readonly ChatMessage[]): Map<number, ChatOfferState> {
  const state = new Map<number, ChatOfferState>();
  for (const message of messages) {
    const parsed = parseChatSystemMessage(message.body);
    if (parsed?.kind === "draw_offer") {
      if (!Number.isFinite(parsed.offerId) || parsed.offerId <= 0) continue;
      state.set(parsed.offerId, {
        ...state.get(parsed.offerId),
        offerId: parsed.offerId,
        offeredBy: safeText(parsed.offeredBy, safeText(message.username, "Player")),
        offeredByUserId: safeText(parsed.offeredByUserId, message.user_id),
        status: "pending",
      });
    } else if (parsed?.kind === "draw_offer_update") {
      const decision = parsed.decision === "accept" || parsed.decision === "reject"
        ? parsed.decision
        : null;
      if (!decision || !Number.isFinite(parsed.offerId) || parsed.offerId <= 0) continue;
      state.set(parsed.offerId, {
        ...state.get(parsed.offerId),
        offerId: parsed.offerId,
        decision,
        status: decision === "accept" ? "accepted" : "rejected",
        actor: safeText(parsed.actor, safeText(message.username, "Player")),
        actorUserId: safeText(parsed.actorUserId, message.user_id),
      });
    }
  }
  return state;
}

/** Reconstruct the current rematch-offer state from persisted system messages. */
export function buildRematchOfferState(messages: readonly ChatMessage[]): Map<number, ChatOfferState> {
  const state = new Map<number, ChatOfferState>();
  for (const message of messages) {
    const parsed = parseChatSystemMessage(message.body);
    if (parsed?.kind === "rematch_offer") {
      if (!Number.isFinite(parsed.offerId) || parsed.offerId <= 0) continue;
      state.set(parsed.offerId, {
        ...state.get(parsed.offerId),
        offerId: parsed.offerId,
        offeredBy: safeText(parsed.offeredBy, safeText(message.username, "Player")),
        offeredByUserId: safeText(parsed.offeredByUserId, message.user_id),
        status: "pending",
        gameId: "",
      });
    } else if (parsed?.kind === "rematch_offer_update") {
      const decision = parsed.decision === "accept" || parsed.decision === "reject"
        ? parsed.decision
        : null;
      if (!decision || !Number.isFinite(parsed.offerId) || parsed.offerId <= 0) continue;
      state.set(parsed.offerId, {
        ...state.get(parsed.offerId),
        offerId: parsed.offerId,
        decision,
        status: decision === "accept" ? "accepted" : "rejected",
        actor: safeText(parsed.actor, safeText(message.username, "Player")),
        actorUserId: safeText(parsed.actorUserId, message.user_id),
        gameId: safeText(parsed.gameId, ""),
      });
    }
  }
  return state;
}
