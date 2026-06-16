import {
  clearGameChatUnread,
  mountGameChatUnread,
  notifyChatTabOpened,
} from "../gameplay/gameChatUnread.js";
import { safeText } from "../../shared/lib/utils.js";
import type { GameType } from "../../shared/contracts.js";
import { resolveOfflineOpponentAvatar, type SetupScreenConfig } from "./shellSetup.js";

interface ShellUser {
  username?: string;
  photo_url?: string | null;
}

interface GameShellChromeConfig {
  arenaLayoutEvent: string;
  arenaNewGameTitle: string;
  gameId: GameType;
  offlineMode: string;
  offlinePlay: {
    opponentName: string;
    opponentAvatar?: string | null;
    setupTitle: string;
    statusText: string;
  };
  pvpSetupStatus: string;
}

interface GameChromeRefs {
  gameBackLobbyBtn: HTMLButtonElement | null;
  gameNewGameBtn: HTMLButtonElement | null;
  gameOverCloseBtn: HTMLButtonElement | null;
  gameOverLobbyBtn: HTMLButtonElement | null;
  gameOverNewGameBtn: HTMLButtonElement | null;
  gameRefreshBtn: HTMLButtonElement | null;
}

interface GameChromeGameplay {
  ensureSurrenderIfActive(): Promise<boolean>;
  getCurrentMode(): string;
  reset(): void;
  startMode(
    mode: string,
    onReady?: (() => void) | null,
    suppressLoadingOverlay?: boolean,
    options?: { forceFresh?: boolean },
  ): Promise<void>;
}

interface GameChromeDeps {
  getUser(): ShellUser | null;
  gameplay: GameChromeGameplay;
  notify(message: unknown, isError?: boolean): void;
  refs: GameChromeRefs;
  shell: GameShellChromeConfig;
  showGameSetup(config: SetupScreenConfig): () => void;
  showScreen(name: "lobby" | "matchmaking", options?: { pushRoute?: boolean }): void;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

async function startArenaNewGame(deps: GameChromeDeps): Promise<boolean> {
  const proceed = await deps.gameplay.ensureSurrenderIfActive();
  if (!proceed) {
    return false;
  }

  if (deps.gameplay.getCurrentMode() === "pvp") {
    deps.gameplay.reset();
    deps.showScreen("matchmaking", { pushRoute: true });
    return true;
  }

  const user = deps.getUser();
  const offline = deps.shell.offlinePlay;
  const opponentAvatar = await resolveOfflineOpponentAvatar(deps.shell);
  const dismiss = deps.showGameSetup({
    title: deps.shell.arenaNewGameTitle || offline.setupTitle,
    selfName: user?.username,
    selfAvatar: user?.photo_url,
    opponentName: offline.opponentName,
    opponentAvatar,
    statusText: offline.statusText,
  });
  await deps.gameplay.startMode(deps.shell.offlineMode, dismiss, true, { forceFresh: true });
  return true;
}

export function bindShellGameChrome(deps: GameChromeDeps): void {
  mountGameChatUnread();

  const activeGameType = document.documentElement.getAttribute("data-game") || deps.shell.gameId;
  const tabRow = document.querySelector(`#game-side-drawer [role="tablist"]`);
  const tabButtons = tabRow?.querySelectorAll("[data-game-tab-target]") || [];
  const panels = document.querySelectorAll("#game-side-drawer [data-game-tab-panel]");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = safeText(button.getAttribute("data-game-tab-target"), "");
      if (!target) return;
      tabButtons.forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach((panel) => {
        const only = panel.getAttribute("data-game-only");
        if (only && only !== activeGameType) return;
        const id = safeText(panel.getAttribute("data-game-tab-panel"), "");
        panel.classList.toggle("hidden", id !== target);
      });
      if (target === "chat") {
        clearGameChatUnread();
        notifyChatTabOpened();
      }
      window.dispatchEvent(new CustomEvent(deps.shell.arenaLayoutEvent));
    });
  });

  deps.refs.gameBackLobbyBtn?.addEventListener("click", () => {
    deps.showScreen("lobby", { pushRoute: true });
  });
  deps.refs.gameRefreshBtn?.addEventListener("click", () => {
    window.location.reload();
  });
  deps.refs.gameNewGameBtn?.addEventListener("click", async () => {
    try {
      await startArenaNewGame(deps);
    } catch (error) {
      deps.notify(error instanceof Error ? error.message : String(error), true);
    }
  });

  deps.refs.gameOverCloseBtn?.addEventListener("click", () => {
    const overlay = byId("game-over-overlay");
    if (!overlay) return;
    overlay.setAttribute("data-user-dismissed", "true");
    overlay.classList.add("hidden");
  });
  deps.refs.gameOverLobbyBtn?.addEventListener("click", () => {
    byId("game-over-overlay")?.classList.add("hidden");
    deps.showScreen("lobby", { pushRoute: true });
  });
  deps.refs.gameOverNewGameBtn?.addEventListener("click", async () => {
    try {
      const started = await startArenaNewGame(deps);
      if (started) {
        byId("game-over-overlay")?.classList.add("hidden");
      }
    } catch (error) {
      deps.notify(error instanceof Error ? error.message : String(error), true);
    }
  });
}
