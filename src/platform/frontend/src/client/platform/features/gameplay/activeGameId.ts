let activeGameId: string | null = null;

/** Store the game id used by shared chat and PvP actions. */
export function setActiveGameId(gameId: unknown): void {
  const normalized = String(gameId ?? "").trim();
  activeGameId = normalized || null;
}

/** Return the currently bound game id, if any. */
export function getActiveGameId(): string | null {
  return activeGameId;
}
