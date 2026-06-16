import { createShellAuthController } from "../../platform/features/auth/shellController.js";
import { createGameplayController as createCoreGameplayController } from "../../platform/features/gameplay/controller.js";
import { CHEZZ_SHELL } from "../../platform/shell/config.js";
import { boot as gameBoot } from "../game/app.js";
import { ACTION } from "../game/contracts.js";
import { surrender as postSurrender } from "../game/http.js";

interface GameplayDependencies {
  confirmDialog?: (message: string, options: { title: string }) => Promise<boolean>;
  onBackToLobby?: () => void;
  onGameNotFound?: () => void;
}

function isTerminalResponse(response: unknown): boolean {
  return Boolean(response && typeof response === "object" && "type" in response
    && String(response.type || "") === "game_over");
}

function createGameplayController(deps: GameplayDependencies = {}) {
  return createCoreGameplayController({
    storageKey: "chezz.gameSession",
    offlineMode: "pve",
    pvpMode: "pvp",
    gameBoot: (options) => gameBoot({
      gameId: options.gameId,
      startRematch: options.startRematch,
    }),
    confirmDialog: deps.confirmDialog,
    onBackToLobby: deps.onBackToLobby,
    onGameNotFound: deps.onGameNotFound,
    postSurrender,
    terminalActionType: ACTION.TERMINAL,
    dispatchTerminal: (response, session) => {
      if (isTerminalResponse(response) && session?.store) {
        session.store.dispatch({ type: ACTION.TERMINAL, payload: response });
      }
    },
  });
}

const auth = createShellAuthController({ shell: CHEZZ_SHELL, createGameplayController });
void auth.init();
