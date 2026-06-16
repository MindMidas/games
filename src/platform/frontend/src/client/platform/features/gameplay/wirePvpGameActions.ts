import { offerDraw, offerRematch } from "./pvpNet.js";
import { gameNotify } from "./gameNotify.js";
import { isGameTerminalForShell } from "./syncGameShell.js";
import type { ChatMessage } from "../../shared/contracts.js";
import type { TerminalState } from "./syncGameShell.js";

interface ChatPanelActions {
  applySseChat?(row: ChatMessage): void;
  ingestChatRow?(row: ChatMessage): void;
  refresh?(): Promise<void>;
}

interface PvpGameActionDeps<TState extends TerminalState | null | undefined> {
  chatPanel: ChatPanelActions;
  getGameId(): string;
  getState(): TState;
  notify?: (message: string, isError?: boolean) => void;
  isPvpActive(state: TState): boolean;
  canOfferRematch(state: TState): boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ingestChatRow(
  chatPanel: ChatPanelActions | null | undefined,
  row: ChatMessage | null | undefined,
): void {
  if (!chatPanel || !row || typeof row !== "object") {
    return;
  }
  if (typeof chatPanel.ingestChatRow === "function") {
    chatPanel.ingestChatRow(row);
    return;
  }
  chatPanel.applySseChat?.(row);
  void chatPanel.refresh?.();
}

export function wirePvpGameActions<TState extends TerminalState | null | undefined>(
  deps: PvpGameActionDeps<TState>,
) {
  const {
    chatPanel,
    getGameId,
    getState,
    notify = gameNotify,
    isPvpActive,
    canOfferRematch,
  } = deps;

  const gameKey = document.documentElement.getAttribute("data-game") || "";
  const drawBtn = document.querySelector(`.game-draw-btn[data-game-only="${gameKey}"]`);
  const rematchBtn = document.getElementById("game-rematch-btn");

  async function handleOfferDraw() {
    const cur = getState();
    if (!isPvpActive(cur) || isGameTerminalForShell(cur)) {
      return;
    }
    const gameId = String(getGameId() || "").trim();
    if (!gameId) {
      return;
    }
    try {
      const row = await offerDraw<ChatMessage>(gameId);
      ingestChatRow(chatPanel, row);
      notify("Draw offer sent.");
    } catch (err) {
      notify(errorMessage(err, "Could not offer draw."), true);
    }
  }

  async function handleOfferRematch() {
    if (!canOfferRematch(getState())) {
      notify("Rematch is only available after the game ends.", true);
      return;
    }
    const gameId = String(getGameId() || "").trim();
    if (!gameId) {
      return;
    }
    try {
      const row = await offerRematch<ChatMessage>(gameId);
      ingestChatRow(chatPanel, row);
      notify("Rematch offer sent.");
    } catch (err) {
      notify(errorMessage(err, "Could not offer rematch."), true);
    }
  }

  drawBtn?.addEventListener("click", handleOfferDraw);
  rematchBtn?.addEventListener("click", handleOfferRematch);

  return {
    teardown() {
      drawBtn?.removeEventListener("click", handleOfferDraw);
      rematchBtn?.removeEventListener("click", handleOfferRematch);
    },
  };
}
