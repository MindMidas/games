import {
  GAMES,
  getSelectedGameId,
  setSelectedGameId,
  gameIdFromRouteQuery,
} from "./games.js";
import {
  isHubPath,
  parseRoute,
} from "../platform/shared/lib/routes.js";
import type { GameType } from "../platform/shared/contracts.js";

async function startGame(gameId: GameType): Promise<void> {
  const game = GAMES[gameId];
  if (!game) return;
  await game.bootstrap();
}

async function main(): Promise<void> {
  if (isHubPath(window.location.pathname)) {
    const { initHub } = await import("../platform/app/hubBootstrap.js");
    await initHub();
    return;
  }

  const domGame = String(document.documentElement?.getAttribute("data-game") || "").trim().toLowerCase();
  if (domGame === "pool" || domGame === "chezz") {
    setSelectedGameId(domGame);
  } else {
    const fromQuery = gameIdFromRouteQuery();
    if (fromQuery) {
      setSelectedGameId(fromQuery);
    }
  }

  const route = parseRoute();
  if (route.gameType) {
    setSelectedGameId(route.gameType);
  } else if (route.invite) {
    const fromQuery = gameIdFromRouteQuery();
    if (fromQuery) {
      setSelectedGameId(fromQuery);
    }
  }

  const selected = getSelectedGameId();
  if (!selected) {
    window.location.replace("/menu");
    return;
  }

  await startGame(selected);
}

void main();
