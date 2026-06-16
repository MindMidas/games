import {
  isChatSoundsMuted,
  previewChatAlertSound,
  setChatSoundPrefsUser,
  setChatSoundsMuted,
} from "./chatSoundPrefs.js";

const BOTTOM_STICKY_THRESHOLD_PX = 24;
const paintEpochByList = new WeakMap<HTMLElement, number>();

export function bumpListPaintEpoch(listEl: HTMLElement | null | undefined): number {
  if (!listEl) {
    return 0;
  }
  const next = (paintEpochByList.get(listEl) || 0) + 1;
  paintEpochByList.set(listEl, next);
  return next;
}

export function isPaintCurrent(listEl: HTMLElement | null | undefined, epoch: number): boolean {
  return Boolean(listEl && paintEpochByList.get(listEl) === epoch);
}

export function isNearBottom(node: HTMLElement | null | undefined): boolean {
  if (!node) {
    return true;
  }
  return (node.scrollHeight - node.scrollTop - node.clientHeight) <= BOTTOM_STICKY_THRESHOLD_PX;
}

export function scrollToBottom(node: HTMLElement | null | undefined): void {
  if (node) {
    node.scrollTop = node.scrollHeight;
  }
}

function ensureBootLoader(listEl: HTMLElement | null | undefined): Element | null {
  const dock = listEl?.closest(".game-chat-panel");
  if (!dock) {
    return null;
  }
  let loader = dock.querySelector(".chat-boot-loader");
  if (loader) {
    return loader;
  }
  loader = document.createElement("div");
  loader.className = "chat-boot-loader";
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");
  loader.setAttribute("hidden", "");
  loader.innerHTML = [
    '<div class="app-loading-spinner" aria-hidden="true">',
    '<span class="app-loading-dot"></span>',
    '<span class="app-loading-dot"></span>',
    '<span class="app-loading-dot"></span>',
    "</div>",
    '<p class="chat-boot-loader-text game-caption">Connecting chat…</p>',
  ].join("");
  dock.appendChild(loader);
  return loader;
}

export function setChatBootLoading(
  listEl: HTMLElement | null | undefined,
  bootLoading: boolean,
): void {
  const dock = listEl?.closest(".game-chat-panel");
  if (!dock) {
    return;
  }
  dock.classList.toggle("game-chat-panel--booting", bootLoading);
  const loader = ensureBootLoader(listEl);
  if (!loader) {
    return;
  }
  if (bootLoading) {
    loader.removeAttribute("hidden");
  } else {
    loader.setAttribute("hidden", "");
  }
}

function syncChatSoundToggleUi(input: HTMLInputElement, stateEl: Element | null): void {
  if (!input || !stateEl) {
    return;
  }
  const soundsOn = input.checked;
  stateEl.textContent = soundsOn ? "On" : "Off";
  stateEl.classList.toggle("is-on", soundsOn);
  stateEl.classList.toggle("is-off", !soundsOn);
  input.setAttribute("aria-checked", soundsOn ? "true" : "false");
  input.setAttribute(
    "aria-label",
    soundsOn ? "Chat sounds on (this tab)" : "Chat sounds off / muted (this tab)",
  );
}

export function syncChatSoundPrefsUser(userId: string): void {
  setChatSoundPrefsUser(userId);
}

export function ensureChatSoundToggle(
  listEl: HTMLElement | null | undefined,
  userId: string,
): void {
  syncChatSoundPrefsUser(userId);
  const dock = listEl?.closest(".game-chat-panel");
  if (!dock || !listEl) {
    return;
  }
  let row = dock.querySelector(".chat-sound-toggle");
  if (row && !row.querySelector(".chat-sound-toggle-track")) {
    row.remove();
    row = null;
  }
  const existing = row?.querySelector<HTMLInputElement>(".chat-sound-toggle-input");
  if (existing) {
    existing.checked = !isChatSoundsMuted();
    syncChatSoundToggleUi(existing, row?.querySelector(".chat-sound-toggle-state") ?? null);
    if (row && row.nextElementSibling !== listEl) {
      dock.insertBefore(row, listEl);
    }
    return;
  }
  row = document.createElement("label");
  row.className = "chat-sound-toggle game-caption";
  const text = document.createElement("span");
  text.className = "chat-sound-toggle-text";
  text.textContent = "Chat sounds";
  const controls = document.createElement("span");
  controls.className = "chat-sound-toggle-controls";
  const stateEl = document.createElement("span");
  stateEl.className = "chat-sound-toggle-state";
  stateEl.setAttribute("aria-hidden", "true");
  const switchWrap = document.createElement("span");
  switchWrap.className = "chat-sound-toggle-switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "chat-sound-toggle-input";
  input.checked = !isChatSoundsMuted();
  input.setAttribute("role", "switch");
  const track = document.createElement("span");
  track.className = "chat-sound-toggle-track";
  track.setAttribute("aria-hidden", "true");
  switchWrap.appendChild(input);
  switchWrap.appendChild(track);
  controls.appendChild(stateEl);
  controls.appendChild(switchWrap);
  row.appendChild(text);
  row.appendChild(controls);
  syncChatSoundToggleUi(input, stateEl);
  input.addEventListener("change", () => {
    const soundsOn = input.checked;
    setChatSoundsMuted(!soundsOn);
    syncChatSoundToggleUi(input, stateEl);
    if (soundsOn) {
      previewChatAlertSound();
    }
  });
  dock.insertBefore(row, listEl);
}
