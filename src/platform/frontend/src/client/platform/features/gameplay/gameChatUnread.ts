const MQ_MOBILE = "(max-width: 1180px), (max-height: 760px)";

/** Fired when the user opens the in-game Chat tab (desktop) or reveals it in the mobile drawer. */
export const GAME_CHAT_TAB_OPEN = "game-chat-tab-open";

let unread = 0;
let mounted = false;

function tabBtn(): HTMLElement | null {
  return document.getElementById("game-tab-chat-btn");
}

function tabBadge(): HTMLElement | null {
  return document.getElementById("game-tab-chat-badge");
}

function tabBadgeCount(): HTMLElement | null {
  return document.getElementById("game-tab-chat-badge-count");
}

function drawerBadge(): HTMLElement | null {
  return document.getElementById("game-drawer-chat-badge");
}

function drawerBadgeCount(): HTMLElement | null {
  return document.getElementById("game-drawer-chat-badge-count");
}

export function isChatTabActive(): boolean {
  return Boolean(tabBtn()?.classList.contains("is-active"));
}

export function isChatViewVisible(): boolean {
  if (!isChatTabActive()) return false;
  const panel = document.getElementById("game-tab-chat-panel");
  if (!panel || panel.classList.contains("hidden")) return false;
  const mq = window.matchMedia(MQ_MOBILE);
  if (!mq.matches) return true;
  return Boolean(document.getElementById("game-app")?.classList.contains("game-drawer-open"));
}

function formatCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

function syncTabBadge(): void {
  const badge = tabBadge();
  const countEl = tabBadgeCount();
  const btn = tabBtn();
  if (!badge || !countEl) return;

  const show = unread > 0 && !isChatViewVisible();
  if (show) {
    badge.removeAttribute("hidden");
    badge.setAttribute("aria-hidden", "false");
    countEl.textContent = formatCount(unread);
    btn?.setAttribute("aria-label", `Chat (${unread} unread)`);
  } else {
    badge.setAttribute("hidden", "");
    badge.setAttribute("aria-hidden", "true");
    countEl.textContent = "0";
    btn?.setAttribute("aria-label", "Chat");
  }
}

export function syncDrawerChatBadge(drawerOpen: boolean, mobileLayout: boolean): void {
  const badge = drawerBadge();
  const countEl = drawerBadgeCount();
  const openBtn = document.getElementById("game-drawer-open-btn");
  if (!badge || !countEl) return;

  const show = unread > 0 && !drawerOpen && mobileLayout && !isChatViewVisible();
  if (show) {
    badge.removeAttribute("hidden");
    badge.setAttribute("aria-hidden", "false");
    countEl.textContent = formatCount(unread);
    openBtn?.setAttribute(
      "aria-label",
      `Open game menu (${unread} unread chat message${unread === 1 ? "" : "s"})`,
    );
  } else {
    badge.setAttribute("hidden", "");
    badge.setAttribute("aria-hidden", "true");
    countEl.textContent = "0";
    if (!openBtn) return;
    const base = openBtn.getAttribute("data-label-base") || "Open game menu";
    openBtn.setAttribute("aria-label", base);
  }
}

export function mountGameChatUnread(): void {
  if (mounted) return;
  mounted = true;
  unread = 0;
  syncTabBadge();
}

export function bumpGameChatUnread(): void {
  if (!mounted) mountGameChatUnread();
  if (isChatViewVisible()) return;
  unread += 1;
  syncTabBadge();
  window.dispatchEvent(new CustomEvent("game-chat-unread-change", { detail: { unread } }));
}

export function clearGameChatUnread(): void {
  unread = 0;
  syncTabBadge();
  window.dispatchEvent(new CustomEvent("game-chat-unread-change", { detail: { unread: 0 } }));
}

export function notifyChatTabOpened(): void {
  window.dispatchEvent(new CustomEvent(GAME_CHAT_TAB_OPEN));
}

export function getGameChatUnreadCount(): number {
  return unread;
}
