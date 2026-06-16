import type { PoolSeat, PoolState } from "./contracts.js";

export const POOL_HUD_DEFAULT = "0.00";
export const POOL_VEL_DEFAULT = "0.000";

const HUD_FIELDS = ["cue-x", "cue-y", "cursor-x", "cursor-y", "xvel", "yvel"] as const;
type HudField = typeof HUD_FIELDS[number];
const VEL_FIELDS = new Set<HudField>(["xvel", "yvel"]);

let hudWriteSeat: PoolSeat | null = null;
let hudSessionSeat: PoolSeat | null = null;
let lastTurnPlayer = "";

/** Format a HUD value with stable decimal precision. */
export function formatPoolHud(field: HudField, value: unknown): string {
  const places = VEL_FIELDS.has(field) ? 3 : 2;
  const fallback = VEL_FIELDS.has(field) ? POOL_VEL_DEFAULT : POOL_HUD_DEFAULT;
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(places);
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const number = Number(text);
  return Number.isFinite(number) ? number.toFixed(places) : fallback;
}

function hudNodes(field: HudField, seat: PoolSeat | null | undefined): Element[] {
  if (!seat) return [];
  return Array.from(
    document.querySelectorAll(`[data-telemetry-seat="${seat}"] [data-pool-hud="${field}"]`),
  );
}

/** Reset velocity fields for one display seat. */
export function resetVelForSeat(seat: PoolSeat | null | undefined): void {
  if (!seat) return;
  VEL_FIELDS.forEach((field) => {
    hudNodes(field, seat).forEach((element) => {
      element.textContent = POOL_VEL_DEFAULT;
    });
  });
}

/** Reset velocity fields for every display seat. */
export function resetAllVel(): void {
  VEL_FIELDS.forEach((field) => {
    document.querySelectorAll(`[data-pool-hud="${field}"]`).forEach((element) => {
      element.textContent = POOL_VEL_DEFAULT;
    });
  });
}

/** Resolve the display seat whose turn is active. */
export function hudSeatForTurn(state: Partial<PoolState>): PoolSeat | null {
  const table = state.table || {};
  const current = String(table.current_player || "").trim();
  if (current === (table.p1_name || "Player 1")) return "player1";
  if (current === (table.p2_name || "Player 2")) return "player2";
  return null;
}

/** Return whether telemetry belongs on a seat's profile row. */
export function shouldShowHudForSeat(state: Partial<PoolState>, seat: PoolSeat): boolean {
  const turnSeat = hudSeatForTurn(state);
  if (!turnSeat || turnSeat !== seat) return false;
  return state.mode === "pnp" || state.you_seat === seat;
}

/** Reset transient telemetry when the active player changes. */
export function onTurnPlayerChanged(state: Partial<PoolState>): void {
  const current = String(state.table?.current_player || "").trim();
  if (!current || current === lastTurnPlayer) return;
  hudSessionSeat = null;
  hudWriteSeat = null;
  lastTurnPlayer = current;
  resetAllVel();
}

/** Reset every HUD field for one display seat. */
export function resetPoolHudTargets(seat: PoolSeat | null | undefined): void {
  if (!seat) return;
  HUD_FIELDS.forEach((field) => {
    hudNodes(field, seat).forEach((element) => {
      element.textContent = POOL_HUD_DEFAULT;
    });
  });
}

/** Reset all HUD values and active session ownership. */
export function resetPoolHud(): void {
  hudSessionSeat = null;
  hudWriteSeat = null;
  HUD_FIELDS.forEach((field) => {
    const text = VEL_FIELDS.has(field) ? POOL_VEL_DEFAULT : POOL_HUD_DEFAULT;
    document.querySelectorAll(`[data-pool-hud="${field}"]`).forEach((element) => {
      element.textContent = text;
    });
  });
}

/** Start or resume telemetry writes for the seat touching the cue. */
export function beginHudSession(seat: PoolSeat | null | undefined): void {
  if (!seat) return;
  if (hudSessionSeat !== seat) {
    resetPoolHudTargets(seat);
    hudSessionSeat = seat;
  }
  hudWriteSeat = seat;
}

/** Write one value into the current interaction seat's HUD. */
export function setPoolHud(field: HudField, value: unknown): void {
  if (!hudWriteSeat) return;
  const text = formatPoolHud(field, value);
  hudNodes(field, hudWriteSeat).forEach((element) => {
    element.textContent = text;
  });
}
