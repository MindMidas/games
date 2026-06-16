let pendingInactivityAutoSurrender = false;

/** Mark the next surrender request as inactivity-triggered. */
export function markInactivityAutoSurrender(): void {
  pendingInactivityAutoSurrender = true;
}

/** Clear the inactivity hint without consuming it. */
export function clearInactivityAutoSurrender(): void {
  pendingInactivityAutoSurrender = false;
}

/** Consume the inactivity hint exactly once. */
export function consumeInactivityAutoSurrenderFlag(): boolean {
  if (!pendingInactivityAutoSurrender) return false;
  pendingInactivityAutoSurrender = false;
  return true;
}
