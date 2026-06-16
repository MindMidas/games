import type { ChatMessage } from "../../../shared/contracts.js";
import { parseChatSystemMessage } from "../../../shared/lib/appData.js";
import {
  chatSoundDedupeKey,
  isOpponentIncomingNotify,
  isTempChatId,
  mergeChatHistory,
  shouldMergeChatRows,
} from "./chatState.js";

type ChatSoundKind = "draw_offer" | "new_message";

interface IncomingSoundOptions {
  currentUserId: string;
  incoming: ChatMessage[];
  onOpponentIncoming?: (() => void) | null;
  playedSoundKeys: Set<string>;
  playSound: (kind: ChatSoundKind) => void;
  prevIds: Set<number | string>;
}

export function chatRowBelongsToGame(row: ChatMessage, gameId: string): boolean {
  if (!gameId || !row || typeof row !== "object") {
    return Boolean(gameId);
  }
  const rowGameId = String(row.game_id || "").trim();
  return !rowGameId || rowGameId === gameId;
}

export function filterChatRowsForGame(rows: ChatMessage[], gameId: string): ChatMessage[] {
  return (rows || []).filter((row) => chatRowBelongsToGame(row, gameId));
}

export function primeIncomingChatHistory(
  incoming: ChatMessage[],
  playedSoundKeys: Set<string>,
): void {
  for (const message of incoming) {
    const fingerprint = chatSoundDedupeKey(message);
    if (fingerprint) {
      playedSoundKeys.add(fingerprint);
    }
  }
}

export function playIncomingChatSounds(options: IncomingSoundOptions): void {
  const userId = options.currentUserId ? String(options.currentUserId) : "";
  for (const message of options.incoming) {
    if (message?.id == null || options.prevIds.has(message.id)) {
      continue;
    }
    const fingerprint = chatSoundDedupeKey(message);
    if (fingerprint && options.playedSoundKeys.has(fingerprint)) {
      options.prevIds.add(message.id);
      continue;
    }
    options.prevIds.add(message.id);
    const parsed = parseChatSystemMessage(message?.body);
    if (!isOpponentIncomingNotify(message, userId)) {
      continue;
    }
    if (parsed?.kind === "draw_offer" || parsed?.kind === "rematch_offer") {
      options.playSound("draw_offer");
    } else if (!parsed) {
      options.playSound("new_message");
    }
    if (fingerprint) {
      options.playedSoundKeys.add(fingerprint);
    }
    options.onOpponentIncoming?.();
  }
}

export function makeClientTempChatId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `tmp_client_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `tmp_client_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function makeOptimisticChatMessage(options: {
  body: string;
  gameId: string;
  userId: string | number;
  username?: string;
}): ChatMessage {
  return {
    id: makeClientTempChatId(),
    game_id: options.gameId,
    user_id: String(options.userId),
    username: String(options.username || "You").trim() || "You",
    body: options.body,
    created_at: new Date().toISOString(),
  };
}

export class OutboundChatTracker {
  private readonly pending = new Map<string, ChatMessage>();

  remember(row: ChatMessage): void {
    if (!row || typeof row !== "object" || !isTempChatId(row.id)) {
      return;
    }
    this.pending.set(String(row.id), row);
  }

  delete(id: number | string): void {
    this.pending.delete(String(id));
  }

  clear(): void {
    this.pending.clear();
  }

  clearForRow(row: ChatMessage): void {
    if (!row || typeof row !== "object") {
      return;
    }
    for (const [key, pending] of this.pending) {
      if (shouldMergeChatRows(pending, row)) {
        this.pending.delete(key);
      }
    }
  }

  merge(messages: ChatMessage[]): ChatMessage[] {
    let next = Array.isArray(messages) ? messages : [];
    for (const pending of this.pending.values()) {
      if (!pending) {
        continue;
      }
      const exists = next.some((message) => shouldMergeChatRows(message, pending));
      if (!exists) {
        next = mergeChatHistory(next, [pending]);
      }
    }
    return next;
  }
}
