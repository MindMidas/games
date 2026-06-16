export type GameType = "pool" | "chezz";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };

/** Public profile fields returned by the platform API. */
export interface PlayerProfile {
  user_id?: string | null;
  username?: string;
  photo_url?: string | null;
}

/** Persisted chat row returned by history and realtime APIs. */
export interface ChatRow {
  id: number;
  game_id: string;
  user_id: string;
  body: string;
  created_at: string;
  username?: string;
}

/** Chat row used by the UI while an optimistic send is awaiting persistence. */
export interface ChatMessage extends Omit<ChatRow, "id"> {
  id: number | string;
}

/** Shared SSE envelope; runtimes type the event payload further. */
export interface RealtimeEvent<T = JsonObject> {
  seq: number;
  type: string;
  payload: T;
}

/** Error raised by a JSON request with its HTTP status retained. */
export interface ApiError extends Error {
  status: number;
  payload?: unknown;
}
