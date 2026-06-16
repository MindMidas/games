import { createShellAuthController } from "../../platform/features/auth/shellController.js";
import { createGameplayController as createCoreGameplayController } from "../../platform/features/gameplay/controller.js";
import { POOL_SHELL } from "../../platform/shell/config.js";
import { boot as gameBoot } from "../game/app.js";
import { ACTION } from "../game/contracts.js";
import { surrender as postSurrender } from "../game/http.js";
import { mountPoolRulebook } from "../game/rulebook.js";

interface GameplayDependencies {
  confirmDialog?: (message: string, options: { title: string }) => Promise<boolean>;
  onBackToLobby?: () => void;
  onGameNotFound?: () => void;
}

function isTerminalResponse(response: unknown): boolean {
  if (!response || typeof response !== "object") {
    return false;
  }
  return ("type" in response && String(response.type || "") === "game_over") || "table" in response;
}

function createGameplayController(deps: GameplayDependencies = {}) {
  return createCoreGameplayController({
    storageKey: "pool.gameSession",
    offlineMode: "pnp",
    pvpMode: "pvp",
    gameBoot: (options) => gameBoot({
      gameId: options.gameId,
      currentUser: options.currentUser,
      startRematch: options.startRematch,
    }),
    confirmDialog: deps.confirmDialog,
    onBackToLobby: deps.onBackToLobby,
    onGameNotFound: deps.onGameNotFound,
    postSurrender,
    terminalActionType: ACTION.TERMINAL,
    dispatchTerminal: (response, session) => {
      if (session?.store && isTerminalResponse(response)) {
        session.store.dispatch({ type: ACTION.TERMINAL, payload: response });
      }
    },
  });
}

const auth = createShellAuthController({ shell: POOL_SHELL, createGameplayController });
void auth.init();
mountPoolRulebook(document.getElementById("pool-rulebook-list"));
