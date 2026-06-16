import { isChatViewVisible } from "../gameChatUnread.js";

type ChatAlertSoundId = "new_message" | "draw_offer";
type SoundPack = Record<ChatAlertSoundId, string>;

const SOUND_HREF: Record<"pool" | "chezz", SoundPack> = {
  pool: {
    new_message: "/static/games/pool/js/features/sound/notify.mp3",
    draw_offer: "/static/games/pool/js/features/sound/ds.mp3",
  },
  chezz: {
    new_message: "/static/games/chezz/js/features/sound/notify.mp3",
    draw_offer: "/static/games/chezz/js/features/sound/ds.mp3",
  },
};

let prefsUserId = "";

export function setChatSoundPrefsUser(userId: string | null | undefined): void {
  prefsUserId = String(userId || "").trim();
}

function storageKey(): string {
  if (prefsUserId) {
    return `mm_chat_sounds_muted:${prefsUserId}`;
  }
  return "mm_chat_sounds_muted:anon";
}

function readStoredMuted(): boolean {
  const key = storageKey();
  try {
    const value = sessionStorage.getItem(key);
    if (value === "1" || value === "0") {
      return value === "1";
    }
  } catch {
    /* noop */
  }
  return false;
}

function writeStoredMuted(muted: boolean): void {
  const key = storageKey();
  try {
    sessionStorage.setItem(key, muted ? "1" : "0");
  } catch {
    /* noop */
  }
}

export function isChatSoundsMuted(): boolean {
  return readStoredMuted();
}

export function setChatSoundsMuted(muted: boolean): void {
  writeStoredMuted(Boolean(muted));
  window.dispatchEvent(
    new CustomEvent("mm-chat-sounds-muted-change", { detail: { muted: Boolean(muted) } }),
  );
}

function activeGamePack(): SoundPack {
  const gameType = String(
    document.documentElement?.dataset?.game
    || document.documentElement?.getAttribute("data-game")
    || "pool",
  ).trim().toLowerCase();
  return gameType === "chezz" ? SOUND_HREF.chezz : SOUND_HREF.pool;
}

function playOneShotHref(href: string, volume = 1): void {
  if (!href) return;
  try {
    const el = new Audio(href);
    el.volume = volume;
    void el.play().catch(() => {});
  } catch {
    /* noop */
  }
}

export function previewChatAlertSound(): void {
  const href = activeGamePack().new_message;
  if (href) {
    playOneShotHref(href, 0.85);
  }
}

export function playChatAlertSound(soundId: ChatAlertSoundId): void {
  if (isChatSoundsMuted()) {
    return;
  }
  if (isChatViewVisible()) {
    return;
  }
  const href = activeGamePack()[soundId];
  if (href) {
    playOneShotHref(href, 1);
  }
}
