import { postJson } from "../lobby/lobbyNet.js";
import { getActiveGameId } from "./activeGameId.js";

export function offerDraw<T = Record<string, unknown>>(gameId: string | null = null): Promise<T> {
  return postJson("/api/game/draw-offer", {
    game_id: gameId || getActiveGameId() || undefined,
  }) as Promise<T>;
}

export function respondDraw<T = Record<string, unknown>>(offerId: number, decision: string): Promise<T> {
  return postJson("/api/game/draw-respond", {
    game_id: getActiveGameId() || undefined,
    offer_id: offerId,
    decision,
  }) as Promise<T>;
}

export function offerRematch<T = Record<string, unknown>>(gameId: string | null = null): Promise<T> {
  return postJson("/api/game/rematch-offer", {
    game_id: gameId || getActiveGameId() || undefined,
  }) as Promise<T>;
}

export function respondRematch<T = Record<string, unknown>>(offerId: number, decision: string): Promise<T> {
  return postJson("/api/game/rematch-respond", {
    game_id: getActiveGameId() || undefined,
    offer_id: offerId,
    decision,
  }) as Promise<T>;
}
