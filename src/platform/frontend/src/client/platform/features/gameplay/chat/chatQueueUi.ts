export interface ChatQueueStatus {
  accepting?: boolean;
  depth?: number;
  max?: number;
  ready?: boolean;
}

export function ensureQueuePauseBanner(
  inputEl: HTMLInputElement | HTMLTextAreaElement | null | undefined,
  currentBanner: HTMLElement | null,
): HTMLElement | null {
  const panel = inputEl?.closest(".game-chat-panel");
  if (!panel) {
    return null;
  }
  if (currentBanner?.isConnected) {
    return currentBanner;
  }
  const banner = document.createElement("div");
  banner.className = "chat-queue-pause-banner hidden";
  banner.setAttribute("role", "status");
  banner.textContent = "Chat paused — catching up…";
  const controls = panel.querySelector(".chat-controls");
  if (controls) {
    panel.insertBefore(banner, controls);
  } else {
    panel.appendChild(banner);
  }
  return banner;
}

export function updateQueuePauseBanner(
  inputEl: HTMLInputElement | HTMLTextAreaElement | null | undefined,
  currentBanner: HTMLElement | null,
  chatQueue: ChatQueueStatus,
): HTMLElement | null {
  const banner = ensureQueuePauseBanner(inputEl, currentBanner);
  if (!banner) {
    return currentBanner;
  }
  const depth = Number(chatQueue?.depth);
  const max = Number(chatQueue?.max);
  let detail = "Chat paused — catching up…";
  if (Number.isFinite(depth) && Number.isFinite(max) && max > 0) {
    detail = `Chat paused — catching up (${Math.min(depth, max)}/${max})…`;
  }
  banner.textContent = detail;
  banner.classList.remove("hidden");
  return banner;
}

export function hideQueuePauseBanner(banner: HTMLElement | null): void {
  banner?.classList.add("hidden");
}
