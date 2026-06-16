import { createNotificationCenter } from "../../shared/ui/notifications.js";
import type { NotificationCenter } from "../../shared/ui/notifications.js";

let notifier: NotificationCenter | null = null;

function getNotifier(): NotificationCenter {
  if (!notifier) {
    const root = document.getElementById("notification-stack");
    notifier = createNotificationCenter(root, { maxVisible: 4, duration: 3200 });
  }
  return notifier;
}

export function gameNotify(message: unknown, isError = false): void {
  const text = String(message || "").trim();
  if (!text) {
    return;
  }
  if (isError) {
    console.warn("[game]", text);
  }
  getNotifier().push(text, { kind: isError ? "error" : "info" });
}
