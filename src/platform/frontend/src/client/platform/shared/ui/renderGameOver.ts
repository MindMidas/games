import { setImageWithFallback } from "../lib/images.js";

interface MatchupProfile {
  name?: string;
  photoUrl?: string | null;
  role?: string;
}

interface MatchupOptions {
  self: MatchupProfile;
  opponent: MatchupProfile;
  winnerSide?: "self" | "opponent" | null;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** Render the shared post-game player matchup row. */
export function paintGameOverMatchup({
  self,
  opponent,
  winnerSide = null,
}: MatchupOptions): void {
  const selfCard = byId("game-over-self-card");
  const opponentCard = byId("game-over-opponent-card");
  const selfRole = byId("game-over-self-role");
  const opponentRole = byId("game-over-opponent-role");

  const selfName = String(self.name || "Player");
  const opponentName = String(opponent.name || "Opponent");
  const selfNameElement = byId("game-over-self-name");
  const opponentNameElement = byId("game-over-opponent-name");
  if (selfNameElement) selfNameElement.textContent = selfName;
  if (opponentNameElement) opponentNameElement.textContent = opponentName;

  setImageWithFallback(byId("game-over-self-avatar"), self.photoUrl);
  setImageWithFallback(byId("game-over-opponent-avatar"), opponent.photoUrl);
  if (selfRole) selfRole.textContent = String(self.role || "");
  if (opponentRole) opponentRole.textContent = String(opponent.role || "");

  selfCard?.classList.remove("is-winner");
  opponentCard?.classList.remove("is-winner");
  if (winnerSide === "self") selfCard?.classList.add("is-winner");
  else if (winnerSide === "opponent") opponentCard?.classList.add("is-winner");
}
