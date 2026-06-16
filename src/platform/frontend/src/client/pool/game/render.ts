import { paintGameOverMatchup } from "../../platform/shared/ui/renderGameOver.js";
import { setImageWithFallback } from "../../platform/shared/lib/images.js";
import {
  terminalOutcomeFromPoolState,
} from "../../platform/shared/game/victoryReason.js";
import { renderClocks } from "../../platform/game/clock.js";
import {
  hudSeatForTurn,
  onTurnPlayerChanged,
  resetPoolHud,
  resetVelForSeat,
  shouldShowHudForSeat,
} from "./hud.js";
import { scoresFromSnapshot } from "../shared/lib/poolScores.js";
import {
  bottomDisplaySeat,
  seatProfile,
  topDisplaySeat,
} from "./seatUtils.js";
import type { PoolSeat, PoolState } from "./contracts.js";

interface TableRenderOptions {
  preserveTableSvg?: boolean;
  suppressGameOver?: boolean;
  suppressTurnHighlight?: boolean;
  forceTableSvg?: boolean;
  syncLayout?: boolean;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}


/** Last table SVG applied to #pool-svg-content (skip layout when unchanged). */
let lastRenderedTableSvg = "";

function sanitizedTableSvg(value: string): SVGSVGElement {
  const documentValue = new DOMParser().parseFromString(value, "image/svg+xml");
  if (
    documentValue.querySelector("parsererror")
    || documentValue.documentElement.localName !== "svg"
    || documentValue.documentElement.namespaceURI !== "http://www.w3.org/2000/svg"
  ) {
    throw new Error("Invalid pool table SVG");
  }
  documentValue.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((node) => node.remove());
  documentValue.querySelectorAll("*").forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      const content = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on")
        || ((name === "href" || name === "xlink:href") && !content.startsWith("#"))
      ) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  return documentValue.documentElement as unknown as SVGSVGElement;
}

function setText(id: string, value: unknown): void {
  const el = byId(id);
  if (el) el.textContent = String(value ?? "");
}


export function applyTableState(state: Partial<PoolState>, opts: TableRenderOptions = {}): void {
  const table = state?.table || {};
  const preserveSvg = opts.preserveTableSvg === true;
  const forceTableSvg = opts.forceTableSvg === true;
  const syncLayout = opts.syncLayout === true;
  const turnEl = byId("turn-pill");
  const matchOver = Boolean(opts.suppressTurnHighlight)
    || Boolean(table.game_over)
    || state?.status === "finished"
    || state?.status === "draw";
  if (turnEl) {
    if (matchOver) {
      turnEl.textContent = "Turn: —";
    } else {
      const who = String(table.current_player || "").trim();
      turnEl.textContent = who ? `Turn: ${who}` : "Turn: —";
    }
  }
  const titleEl = byId("pool-game-title");
  if (titleEl) {
    titleEl.textContent = table.game_name || "Pool";
  }
  const scores = scoresFromSnapshot(table);
  const bottomSeat = bottomDisplaySeat(state);
  const topSeat = topDisplaySeat(state);
  const bottomProfile = seatProfile(table, bottomSeat);
  const topProfile = seatProfile(table, topSeat);
  setText("pool-p1-name", bottomProfile.name);
  setText("pool-p2-name", topProfile.name);
  setText("pool-p1-score", scores[bottomProfile.scoreKey]);
  setText("pool-p2-score", scores[topProfile.scoreKey]);
  setImageWithFallback(byId("pool-p1-avatar"), bottomProfile.photoUrl);
  setImageWithFallback(byId("pool-p2-avatar"), topProfile.photoUrl);
  setPlayingBadge(byId("pool-p1-playing"), formatPlayingBadge(bottomProfile.playing));
  setPlayingBadge(byId("pool-p2-playing"), formatPlayingBadge(topProfile.playing));

  const current = String(table.current_player || "").trim();
  const bottomCard = byId("pool-p1-card");
  const topCard = byId("pool-p2-card");
  const passAndPlay = state.mode === "pnp";
  bottomCard?.classList.toggle("pool-local-seat", passAndPlay || state.mode === "pvp");
  topCard?.classList.toggle("pool-local-seat", false);
  const showTurnPulse = !opts.suppressTurnHighlight && !matchOver && state?.status === "active";
  bottomCard?.classList.toggle("side-turn-active", showTurnPulse && !!current && current === bottomProfile.name);
  topCard?.classList.toggle("side-turn-active", showTurnPulse && !!current && current === topProfile.name);

  const container = byId("pool-svg-content");
  let tableSvgChanged = false;
  if (container && table.svg && !preserveSvg) {
    const nextSvg = String(table.svg);
    if (forceTableSvg || nextSvg !== lastRenderedTableSvg) {
      container.replaceChildren(document.importNode(sanitizedTableSvg(nextSvg), true));
      lastRenderedTableSvg = nextSvg;
      tableSvgChanged = true;
    }
  }

  onTurnPlayerChanged(state);
  renderProfileHud(state);
  renderCueModeCluster(state);
  if (table.game_over) {
    resetPoolHud();
  }
  renderClocks(state);
  renderGameOverOverlay(state, { suppress: opts.suppressGameOver === true });
  if (tableSvgChanged || syncLayout) {
    window.dispatchEvent(new CustomEvent("pool-arena-layout"));
  }
}

export function resetTableRenderCache(): void {
  lastRenderedTableSvg = "";
}

function formatPlayingBadge(raw: unknown): string {
  const g = String(raw || "").trim().toLowerCase();
  if (g === "solid" || g === "solids") return "Solids";
  if (g === "stripe" || g === "stripes") return "Stripes";
  return "";
}

function setPlayingBadge(el: HTMLElement | null, value: unknown): void {
  if (!el) {
    return;
  }
  const label = String(value || "").trim();
  if (!label) {
    el.textContent = "";
    el.classList.add("hidden");
    el.setAttribute("hidden", "");
    return;
  }
  el.textContent = label;
  el.classList.remove("hidden");
  el.removeAttribute("hidden");
}

function cueToggleSeat(state: Partial<PoolState>): PoolSeat | null {
  const table = state?.table || {};
  if (!table.ball_in_hand || table.game_over) {
    return null;
  }

  const receiver = String(table.ball_in_hand_for_player_id || "");
  const p1Id = String(table.player1_id || "");
  const p2Id = String(table.player2_id || "");
  let seat: PoolSeat | null = null;
  if (receiver && receiver === p1Id) {
    seat = "player1";
  } else if (receiver && receiver === p2Id) {
    seat = "player2";
  }
  if (!seat) {
    return null;
  }

  if (state.mode === "pnp") {
    return seat;
  }

  const youAreReceiver =
    (state.you_seat === "player1" && receiver === p1Id)
    || (state.you_seat === "player2" && receiver === p2Id);
  if (!youAreReceiver || state.you_seat !== seat) {
    return null;
  }
  return seat;
}

function renderProfileHud(state: Partial<PoolState>): void {
  for (const seat of ["player1", "player2"] as const) {
    const velEl = document.querySelector(`.pool-profile-vel[data-telemetry-seat="${seat}"]`);
    if (velEl) {
      velEl.classList.remove("hidden");
      velEl.removeAttribute("hidden");
    }
    const strip = document.querySelector(`.pool-shot-hud--strip[data-telemetry-seat="${seat}"]`);
    if (strip) {
      const show = shouldShowHudForSeat(state, seat);
      strip.classList.toggle("hidden", !show);
      if (show) {
        strip.removeAttribute("hidden");
      } else {
        strip.setAttribute("hidden", "");
      }
    }
    if (!shouldShowHudForSeat(state, seat)) {
      resetVelForSeat(seat);
    }
  }

}

function cueToggleSlotForSeat(seat: PoolSeat | null, state: Partial<PoolState>): HTMLElement | null {
  if (!seat) {
    return null;
  }
  const bottomSeat = bottomDisplaySeat(state);
  if (seat === bottomSeat) {
    return byId("pool-p1-cue-mode-slot");
  }
  return byId("pool-p2-cue-mode-slot");
}

function renderCueModeCluster(state: Partial<PoolState>): void {
  const cluster = byId("pool-cue-mode-cluster");
  const home = byId("pool-cue-mode-home");
  const p1Slot = byId("pool-p1-cue-mode-slot");
  const p2Slot = byId("pool-p2-cue-mode-slot");
  if (!cluster) {
    return;
  }

  const seat = cueToggleSeat(state);
  const slot = cueToggleSlotForSeat(seat, state);

  if (slot) {
    slot.appendChild(cluster);
    slot.setAttribute("aria-hidden", "false");
    cluster.classList.remove("hidden");
    cluster.removeAttribute("hidden");
  } else {
    home?.appendChild(cluster);
    cluster.classList.add("hidden");
    cluster.setAttribute("hidden", "");
    p1Slot?.setAttribute("aria-hidden", "true");
    p2Slot?.setAttribute("aria-hidden", "true");
  }
}

function renderGameOverOverlay(state: Partial<PoolState>, opts: { suppress?: boolean } = {}): void {
  const overlay = byId("game-over-overlay");
  if (!overlay) {
    return;
  }

  if (opts.suppress) {
    overlay.classList.add("hidden");
    return;
  }

  const table = state?.table || {};
  const finished = Boolean(table.game_over) || state?.status === "finished";
  if (!finished) {
    overlay.classList.add("hidden");
    return;
  }
  if (overlay.getAttribute("data-user-dismissed") === "true") {
    overlay.classList.add("hidden");
    return;
  }

  overlay.classList.remove("hidden");
  const title = byId("game-over-title");
  const subtitle = byId("game-over-subtitle");
  const bottomSeat = bottomDisplaySeat(state);
  const topSeat = topDisplaySeat(state);
  const selfProfile = seatProfile(table, bottomSeat);
  const oppProfile = seatProfile(table, topSeat);
  const selfName = selfProfile.name;
  const oppName = oppProfile.name;
  const readOutcome = terminalOutcomeFromPoolState as (
    value: Partial<PoolState>,
    options: { selfName: string },
  ) => { title: string; subtitle: string };
  const outcome = readOutcome(state, { selfName });
  if (title) {
    title.textContent = outcome.title;
  }
  if (subtitle) {
    subtitle.textContent = outcome.subtitle;
  }

  const selfPhoto = selfProfile.photoUrl;
  const oppPhoto = oppProfile.photoUrl;

  let winnerSide: "self" | "opponent" | null = null;
  if (table.winner) {
    if (table.winner === selfName) winnerSide = "self";
    else if (table.winner === oppName) winnerSide = "opponent";
  }

  const paintMatchup = paintGameOverMatchup as (options: {
    self: { name: string; photoUrl?: string | null; role: string };
    opponent: { name: string; photoUrl?: string | null; role: string };
    winnerSide: "self" | "opponent" | null;
  }) => void;
  paintMatchup({
    self: { name: selfName, photoUrl: selfPhoto, role: bottomSeat === "player1" ? "Player 1" : "Player 2" },
    opponent: { name: oppName, photoUrl: oppPhoto, role: topSeat === "player1" ? "Player 1" : "Player 2" },
    winnerSide,
  });
}
