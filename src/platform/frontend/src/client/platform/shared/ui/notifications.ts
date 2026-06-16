interface NotificationOptions {
  duration?: number;
  kind?: "error" | "info";
  maxVisible?: number;
}

export interface NotificationCenter {
  push(message: unknown, options?: NotificationOptions): string | null;
  clear(): void;
}

function safeMessage(value: unknown): string {
  return String(value || "").trim();
}


export function createNotificationCenter(
  rootElement: HTMLElement | null,
  options: NotificationOptions = {},
): NotificationCenter {
  const root = rootElement || null;
  const maxVisible = Math.max(1, Number(options.maxVisible || 4));
  const defaultDuration = Math.max(0, Number(options.duration || 3200));
  let sequence = 0;
  const dismissTimers = new WeakMap<Element, number>();

  function removeNow(node: Element | null) {
    if (!node || !node.isConnected) {
      return;
    }
    const dismissTimer = dismissTimers.get(node);
    if (dismissTimer != null) {
      window.clearTimeout(dismissTimer);
      dismissTimers.delete(node);
    }
    node.remove();
  }

  function dismiss(node: Element | null) {
    if (!node || !node.isConnected || node.classList.contains("game-toast--hide")) {
      return;
    }
    const dismissTimer = dismissTimers.get(node);
    if (dismissTimer != null) {
      window.clearTimeout(dismissTimer);
      dismissTimers.delete(node);
    }
    node.classList.add("game-toast--hide");
    window.setTimeout(() => {
      removeNow(node);
    }, 220);
  }

  function trimOverflow(): void {
    if (!root) {
      return;
    }
    while (root.children.length > maxVisible) {
      removeNow(root.firstElementChild);
    }
  }

  function push(message: unknown, notifyOptions: NotificationOptions = {}): string | null {
    if (!root) {
      return null;
    }
    const text = safeMessage(message);
    if (!text) {
      return null;
    }

    sequence += 1;
    const kind = notifyOptions.kind === "error" ? "error" : "info";
    const duration = Math.max(0, Number(notifyOptions.duration ?? defaultDuration));

    const card = document.createElement("article");
    card.className = `game-toast${kind === "error" ? " game-toast--error" : ""}`;
    card.dataset.notificationId = String(sequence);
    card.setAttribute("role", kind === "error" ? "alert" : "status");

    const body = document.createElement("div");
    body.className = "game-toast-body";
    body.textContent = text;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "game-toast-dismiss";
    closeButton.setAttribute("aria-label", "Dismiss notification");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => {
      dismiss(card);
    });

    card.appendChild(body);
    card.appendChild(closeButton);
    root.appendChild(card);
    trimOverflow();

    if (duration > 0) {
      dismissTimers.set(card, window.setTimeout(() => {
        dismiss(card);
      }, duration));
    }

    return card.dataset.notificationId;
  }

  function clear(): void {
    if (!root) {
      return;
    }
    Array.from(root.children).forEach((child) => {
      removeNow(child);
    });
  }

  return {
    push,
    clear,
  };
}
