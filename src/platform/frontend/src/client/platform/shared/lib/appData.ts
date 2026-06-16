import type { JsonObject } from "../contracts.js";

interface SnapshotResult extends JsonObject {
  status: string;
}

export type ChatSystemMessage =
  | {
    kind: "draw_offer" | "rematch_offer";
    offerId: number;
    status: string;
    offeredByUserId: string;
    offeredBy: string;
  }
  | {
    kind: "draw_offer_update";
    offerId: number;
    decision: string;
    actorUserId: string;
    actor: string;
  }
  | {
    kind: "rematch_offer_update";
    offerId: number;
    decision: string;
    actorUserId: string;
    actor: string;
    gameId: string;
  }
  | {
    kind: "surrender";
    actorUserId: string;
    actor: string;
  };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-clone a JSON-serialisable snapshot. */
export function cloneSnapshot<T>(snapshot: T): T {
  return JSON.parse(JSON.stringify(snapshot)) as T;
}

export function mergeSnapshotTurnMetadata(targetSnapshot: JsonObject, sourceSnapshot: unknown): void {
  if (!isJsonObject(sourceSnapshot)) {
    return;
  }
  const schema = String(sourceSnapshot.events_schema || "").trim();
  if (schema) {
    targetSnapshot.events_schema = schema;
  }
  if (sourceSnapshot.event_seq != null) {
    targetSnapshot.event_seq = Number(sourceSnapshot.event_seq);
  }
  if (Array.isArray(sourceSnapshot.events)) {
    targetSnapshot.events = sourceSnapshot.events
      .filter(isJsonObject)
      .map((event) => ({ ...event }));
  }
}


export function shortEngineName(name: unknown): string {
  const value = String(name || "").trim();
  if (!value) {
    return "Engine";
  }
  return value.split(/\s+/)[0];
}


export function resultForSnapshot(snapshot: unknown): SnapshotResult {
  const result = isJsonObject(snapshot) ? snapshot.result : null;
  if (isJsonObject(result) && typeof result.status === "string") {
    return result as SnapshotResult;
  }
  return { status: "active", winner: null, reason: null };
}


/** Stable key for meaningful snapshot state. */
export function snapshotKey(snapshot: JsonObject): string {
  const board = isJsonObject(snapshot.board) ? snapshot.board : {};
  const boardEntries = Object.entries(board).sort(([a], [b]) => a.localeCompare(b));  // order-independent
  const result = isJsonObject(snapshot.result) ? snapshot.result : null;
  const winner = (result && result.winner != null) ? String(result.winner) : "";
  return JSON.stringify({
    header: snapshot.header,
    board: boardEntries,
    winner,
    engine_name: snapshot.engine_name || "",
  });
}


export function formatChatMessageTime(createdAt: unknown): string {
  const raw = String(createdAt || "").trim();
  if (!raw) {
    return "";
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  try {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;  // if toLocaleTimeString throws
  }
}


/** Parse server-generated system chat bodies. */
export function parseChatSystemMessage(rawBody: unknown): ChatSystemMessage | null {
  const body = String(rawBody || "").trim();
  if (!body.startsWith("__")) {
    return null;
  }
  const parts = body.split("|");
  if (parts[0] === "__draw_offer__" && parts.length >= 4) {
    const offerId = Number.parseInt(parts[1], 10);
    const status = String(parts[2] || "pending").toLowerCase();
    if (parts.length >= 5) {
      return {
        kind: "draw_offer",
        offerId,
        status,
        offeredByUserId: String(parts[3] || ""),
        offeredBy: parts.slice(4).join("|") || "Player",
      };
    }
    return {
      kind: "draw_offer",
      offerId,
      status,
      offeredByUserId: "",
      offeredBy: parts.slice(3).join("|") || "Player",
    };
  }
  if (parts[0] === "__draw_offer_update__" && parts.length >= 4) {
    const offerId = Number.parseInt(parts[1], 10);
    const decision = String(parts[2] || "").toLowerCase();
    if (parts.length >= 5) {
      return {
        kind: "draw_offer_update",
        offerId,
        decision,
        actorUserId: String(parts[3] || ""),
        actor: parts.slice(4).join("|") || "Player",
      };
    }
    return {
      kind: "draw_offer_update",
      offerId,
      decision,
      actorUserId: "",
      actor: parts.slice(3).join("|") || "Player",
    };
  }
  if (parts[0] === "__rematch_offer__" && parts.length >= 4) {
    const offerId = Number.parseInt(parts[1], 10);
    const status = String(parts[2] || "pending").toLowerCase();
    if (parts.length >= 5) {
      return {
        kind: "rematch_offer",
        offerId,
        status,
        offeredByUserId: String(parts[3] || ""),
        offeredBy: parts.slice(4).join("|") || "Player",
      };
    }
    return {
      kind: "rematch_offer",
      offerId,
      status,
      offeredByUserId: "",
      offeredBy: parts.slice(3).join("|") || "Player",
    };
  }
  if (parts[0] === "__rematch_offer_update__" && parts.length >= 4) {
    const offerId = Number.parseInt(parts[1], 10);
    const decision = String(parts[2] || "").toLowerCase();
    if (parts.length >= 6) {
      return {
        kind: "rematch_offer_update",
        offerId,
        decision,
        actorUserId: String(parts[3] || ""),
        actor: String(parts[4] || "") || "Player",
        gameId: String(parts[5] || ""),
      };
    }
    if (parts.length >= 5) {
      return {
        kind: "rematch_offer_update",
        offerId,
        decision,
        actorUserId: String(parts[3] || ""),
        actor: parts.slice(4).join("|") || "Player",
        gameId: "",
      };
    }
    return {
      kind: "rematch_offer_update",
      offerId,
      decision,
      actorUserId: "",
      actor: parts.slice(3).join("|") || "Player",
      gameId: "",
    };
  }
  if (parts[0] === "__surrender__" && parts.length >= 2) {
    if (parts.length >= 3) {
      return {
        kind: "surrender",
        actorUserId: String(parts[1] || ""),
        actor: parts.slice(2).join("|") || "Player",
      };
    }
    return {
      kind: "surrender",
      actorUserId: "",
      actor: parts.slice(1).join("|") || "Player",
    };
  }
  return null;
}
