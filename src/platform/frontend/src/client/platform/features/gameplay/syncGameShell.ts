export interface TerminalState {
  mode?: unknown;
  status?: unknown;
  result?: { status?: unknown } | null;
  table?: { game_over?: unknown } | null;
}

interface ShellChat {
  setActive?(active: boolean): void;
  setGameEnded?(ended: boolean): void;
  setPveOffline?(offline: boolean): void;
}

interface ShellOptions {
  pveMode?: string;
  atLiveTail?: boolean;
  chat?: ShellChat;
}

export interface ShellControlFlags {
  isPvp: boolean;
  isPve: boolean;
  matchEnded: boolean;
  chatGameEnded: boolean;
  drawDisabled: boolean;
  rematchDisabled: boolean;
  surrenderDisabled: boolean;
}

/** Detect terminal state from the authoritative live snapshot. */
export function isGameTerminalForShell(state: TerminalState | null | undefined): boolean {
  if (!state) return false;
  const status = String(state.status || "").toLowerCase();
  if (status === "finished" || status === "draw") return true;
  const resultStatus = String(state.result?.status || "").toLowerCase();
  if (resultStatus === "finished" || resultStatus === "draw") return true;
  return Boolean(state.table?.game_over);
}

export function canOfferPvpRematch(state: TerminalState | null | undefined, pvpMode = "pvp"): boolean {
  return Boolean(state && String(state.mode || "") === pvpMode && isGameTerminalForShell(state));
}

/** Resolve shared chat and action-button state from the live snapshot. */
export function resolveGameShellControls(
  state: TerminalState | null | undefined,
  options: Pick<ShellOptions, "pveMode" | "atLiveTail"> = {},
): ShellControlFlags {
  const pveMode = options.pveMode || "pve";
  const atLiveTail = options.atLiveTail !== false;
  const mode = state?.mode;
  const isPvp = mode === "pvp";
  const isPve = mode === pveMode;
  const matchEnded = isGameTerminalForShell(state);
  return {
    isPvp,
    isPve,
    matchEnded,
    chatGameEnded: atLiveTail && matchEnded,
    drawDisabled: isPve || matchEnded,
    rematchDisabled: isPve || !matchEnded,
    surrenderDisabled: matchEnded,
  };
}

/** Apply shared chat and action-button state for Pool or Chezz. */
export function syncGameShell(state: TerminalState | null | undefined, options: ShellOptions): void {
  const pveMode = options?.pveMode || "pve";
  const flags = resolveGameShellControls(state, options);
  options?.chat?.setActive?.(flags.isPvp);
  options?.chat?.setGameEnded?.(flags.chatGameEnded);
  options?.chat?.setPveOffline?.(flags.isPve);

  document.querySelectorAll<HTMLButtonElement>(".game-draw-btn").forEach((button) => {
    button.disabled = flags.drawDisabled;
  });
  const rematchButton = document.getElementById("game-rematch-btn") as HTMLButtonElement | null;
  const surrenderButton = document.getElementById("game-surrender-btn") as HTMLButtonElement | null;
  if (rematchButton) rematchButton.disabled = flags.rematchDisabled;
  if (surrenderButton) {
    surrenderButton.disabled = flags.surrenderDisabled;
    surrenderButton.textContent = pveMode === "pnp" && flags.isPve ? "End Game" : "Surrender";
  }

  document.getElementById("game-app")?.classList.toggle("pve-mode", flags.isPve);
  const poolNote = document.querySelector(".game-actions-note--pool");
  if (poolNote && pveMode === "pnp") {
    poolNote.textContent = flags.isPve
      ? "End Game ends the current match on this device."
      : "Draw and rematch use the Chat tab (PvP). Surrender ends the current match.";
  }
}

/** Close the phone drawer and return to analysis after rematch navigation. */
export function focusGameBoardAfterRematch(): void {
  const app = document.getElementById("game-app");
  if (app?.classList.contains("game-drawer-open")) {
    app.classList.remove("game-drawer-open");
    const scrim = document.getElementById("game-drawer-scrim");
    scrim?.setAttribute("hidden", "");
    scrim?.setAttribute("aria-hidden", "true");
    document.getElementById("game-drawer-open-btn")?.setAttribute("aria-expanded", "false");
  }
  const analysisButton = document.querySelector<HTMLButtonElement>('[data-game-tab-target="analysis"]');
  if (analysisButton && !analysisButton.classList.contains("is-active")) analysisButton.click();
  window.dispatchEvent(new CustomEvent("game-arena-layout"));
  window.dispatchEvent(new CustomEvent("pool-arena-layout"));
}
