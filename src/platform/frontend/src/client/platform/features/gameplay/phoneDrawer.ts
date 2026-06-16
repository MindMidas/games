import {
  bumpGameChatUnread,
  clearGameChatUnread,
  isChatTabActive,
  isChatViewVisible,
  notifyChatTabOpened,
  syncDrawerChatBadge,
} from "./gameChatUnread.js";

const MQ_MOBILE = "(max-width: 1180px), (max-height: 760px)";

interface PhoneDrawerOptions {
  arenaLayoutEvent?: string;
  onDrawerOpenChange?: (open: boolean) => void;
}

export function mountGamePhoneDrawer(opts: PhoneDrawerOptions = {}) {
  const onDrawerOpenChange = typeof opts.onDrawerOpenChange === "function"
    ? opts.onDrawerOpenChange
    : null;
  const arenaLayoutEvent = String(opts.arenaLayoutEvent || "game-arena-layout");
  const app = document.getElementById("game-app");
  const scrim = document.getElementById("game-drawer-scrim");
  const openBtn = document.getElementById("game-drawer-open-btn");
  const closeBtn = document.getElementById("game-drawer-close-btn");
  const drawer = document.getElementById("game-side-drawer");
  const noop = {
    teardown: () => {},
    bumpChatUnread: () => {},
    clearChatUnread: () => {},
  };
  if (!app || !scrim || !openBtn) {
    return noop;
  }

  const mq = window.matchMedia(MQ_MOBILE);
  let open = false;

  const syncChatBadge = () => {
    syncDrawerChatBadge(open, mq.matches);
  };

  const syncDom = () => {
    app.classList.toggle("game-drawer-open", open);
    if (open) {
      scrim.removeAttribute("hidden");
      scrim.setAttribute("aria-hidden", "false");
    } else {
      scrim.setAttribute("hidden", "");
      scrim.setAttribute("aria-hidden", "true");
    }
    openBtn.setAttribute("aria-expanded", open ? "true" : "false");
    syncChatBadge();
    try {
      onDrawerOpenChange?.(open);
    } catch {
      /* noop */
    }
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent(arenaLayoutEvent));
    });
  };

  const setOpen = (next: boolean): void => {
    const wasOpen = open;
    open = Boolean(next);
    if (open && !wasOpen) {
      if (isChatTabActive()) {
        clearGameChatUnread();
        notifyChatTabOpened();
      }
    }
    syncDom();
  };

  const close = () => setOpen(false);

  const onOpenClick = () => {
    if (!mq.matches) return;
    setOpen(!open);
  };

  const onCloseClick = () => {
    if (!mq.matches) return;
    close();
  };

  const onScrimPointerDown = (event: PointerEvent): void => {
    if (event.target === scrim) close();
  };

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (!open || !mq.matches) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (drawer?.contains(target) || openBtn.contains(target)) return;
    close();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && open) close();
  };

  const onMqChange = () => {
    if (!mq.matches) close();
    syncChatBadge();
  };

  const onUnreadChange = () => syncChatBadge();

  openBtn.addEventListener("click", onOpenClick);
  closeBtn?.addEventListener("click", onCloseClick);
  scrim.addEventListener("pointerdown", onScrimPointerDown);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  window.addEventListener("keydown", onKey);
  mq.addEventListener("change", onMqChange);
  window.addEventListener("game-chat-unread-change", onUnreadChange);

  setOpen(false);

  return {
    teardown: () => {
      openBtn.removeEventListener("click", onOpenClick);
      closeBtn?.removeEventListener("click", onCloseClick);
      scrim.removeEventListener("pointerdown", onScrimPointerDown);
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMqChange);
      window.removeEventListener("game-chat-unread-change", onUnreadChange);
      close();
      clearGameChatUnread();
    },
    bumpChatUnread: () => {
      bumpGameChatUnread();
      syncChatBadge();
    },
    clearChatUnread: () => {
      clearGameChatUnread();
      syncChatBadge();
    },
  };
}
