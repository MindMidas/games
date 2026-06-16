import { fetchBotProfile } from "../lobby/lobbyNet.js";
import { getDefaultAvatar, resolvePhotoUrl } from "../../shared/lib/security.js";
import { safeText } from "../../shared/lib/utils.js";

const SETUP_DISPLAY_MS = 2200;

export interface ShellSetupConfig {
  gameId: string;
  pvpSetupStatus: string;
  offlinePlay?: { opponentAvatar?: string | null };
}

export interface SetupScreenConfig {
  title?: string;
  selfName?: string | null;
  selfAvatar?: string | null;
  opponentName?: string | null;
  opponentAvatar?: string | null;
  statusText?: string;
}

interface SetupRefs {
  opponentAvatar: HTMLImageElement | null;
  opponentName: HTMLElement | null;
  screen: HTMLElement | null;
  selfAvatar: HTMLImageElement | null;
  selfName: HTMLElement | null;
  status: HTMLElement | null;
  title: HTMLElement | null;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function setupRefs(): SetupRefs {
  return {
    screen: byId("game-setup-screen"),
    title: byId("game-setup-title"),
    selfAvatar: byId("game-setup-self-avatar") as HTMLImageElement | null,
    selfName: byId("game-setup-self-name"),
    opponentAvatar: byId("game-setup-opponent-avatar") as HTMLImageElement | null,
    opponentName: byId("game-setup-opponent-name"),
    status: byId("game-setup-status"),
  };
}

function setAvatar(image: HTMLImageElement | null, source: string | null | undefined): void {
  if (!image) return;
  image.onerror = () => {
    image.onerror = null;
    image.src = getDefaultAvatar();
  };
  image.src = resolvePhotoUrl(source, getDefaultAvatar());
}

export async function resolveOfflineOpponentAvatar(shell: ShellSetupConfig): Promise<string | null> {
  const fallback = shell.offlinePlay?.opponentAvatar;
  if (shell.gameId !== "chezz") {
    return fallback ?? null;
  }
  try {
    const payload = await fetchBotProfile();
    return payload?.user?.photo_url ?? null;
  } catch {
    return fallback ?? null;
  }
}

export function createGameSetupOverlay(shell: ShellSetupConfig): {
  hide(): void;
  show(config: SetupScreenConfig): () => void;
} {
  const refs = setupRefs();
  return {
    hide(): void {
      refs.screen?.classList.add("fade-out");
    },
    show(config: SetupScreenConfig): () => void {
      if (refs.title) refs.title.textContent = config.title || "Setting Up";
      if (refs.selfName) refs.selfName.textContent = safeText(config.selfName, "Player");
      if (refs.opponentName) refs.opponentName.textContent = safeText(config.opponentName, "Opponent");
      if (refs.status) refs.status.textContent = config.statusText || shell.pvpSetupStatus;
      setAvatar(refs.selfAvatar, config.selfAvatar);
      setAvatar(refs.opponentAvatar, config.opponentAvatar);
      refs.screen?.classList.remove("fade-out");

      const shownAt = Date.now();
      let dismissed = false;
      return function dismiss(): void {
        if (dismissed || !refs.screen) return;
        dismissed = true;
        const remaining = Math.max(0, SETUP_DISPLAY_MS - (Date.now() - shownAt));
        window.setTimeout(() => {
          refs.screen?.classList.add("fade-out");
        }, remaining);
      };
    },
  };
}
