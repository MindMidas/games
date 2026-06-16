import { ensurePoolGlobalOverlay, tableOverlaySvg, tableSvgRoot } from "./poolTableOverlay.js";
import { parseTranslate } from "../features/gameplay/inputDecisions.js";
import type { Point } from "../features/gameplay/inputDecisions.js";

export function poolContainer(): HTMLElement | null {
  return document.getElementById("pool-svg-container");
}

export function poolOverlay(): SVGSVGElement | null {
  return tableOverlaySvg();
}

export function poolGlobalOverlay(): SVGSVGElement {
  return ensurePoolGlobalOverlay();
}

export function refreshCueBall(): Element | null {
  const root = tableSvgRoot();
  if (!root) return null;
  return (
    root.querySelector('[data-ball="0"]')
    || root.querySelector(".pool-ball-cue")
    || root.querySelector('circle[fill="WHITE"]')
    || root.querySelector('circle[fill="#f8f8f8"]')
  );
}

function cueBallRadius(cue: Element): number {
  const hit = cue.querySelector(".pool-ball-hit");
  const radius = Number.parseFloat(hit?.getAttribute("r") || "");
  return Number.isFinite(radius) && radius > 0 ? radius : 28.5;
}

export function getCueBallTableCoords(): Point | null {
  const cue = refreshCueBall();
  if (!cue) return null;
  const { dx, dy } = parseTranslate(cue.getAttribute("transform"));
  const dataCx = Number.parseFloat(cue.getAttribute("data-cx") || "");
  const dataCy = Number.parseFloat(cue.getAttribute("data-cy") || "");
  if (Number.isFinite(dataCx) && Number.isFinite(dataCy)) {
    return { x: dataCx + dx, y: dataCy + dy };
  }
  const hit = cue.querySelector(".pool-ball-hit");
  if (hit) {
    const cx = Number.parseFloat(hit.getAttribute("cx") || "");
    const cy = Number.parseFloat(hit.getAttribute("cy") || "");
    if (Number.isFinite(cx) && Number.isFinite(cy)) {
      return { x: cx + dx, y: cy + dy };
    }
  }
  return null;
}

export function setCueBallTableCoords(x: number, y: number): void {
  const cue = refreshCueBall();
  if (!cue) return;
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;

  const radius = cueBallRadius(cue);
  const glossDy = Math.round(radius * 0.48);

  cue.setAttribute("data-cx", String(Math.round(nx)));
  cue.setAttribute("data-cy", String(Math.round(ny)));

  for (const circle of cue.querySelectorAll("circle")) {
    circle.setAttribute("cx", String(nx));
    circle.setAttribute("cy", String(ny));
  }
  for (const ellipse of cue.querySelectorAll("ellipse")) {
    ellipse.setAttribute("cx", String(nx));
    ellipse.setAttribute("cy", String(ny - glossDy));
  }
  for (const rotateGroup of cue.querySelectorAll("g[transform]")) {
    const raw = rotateGroup.getAttribute("transform") || "";
    if (/rotate\s*\(/i.test(raw)) {
      rotateGroup.setAttribute("transform", `rotate(90 ${nx} ${ny})`);
    }
  }
  cue.removeAttribute("transform");
}

export function bihPlacedStorageKey(gameId: string): string {
  const id = String(gameId || "").trim();
  return id ? `games.pool.bihCuePlaced.${id}` : "";
}

export function readCuePlacedPersisted(gameId: string): boolean {
  const key = bihPlacedStorageKey(gameId);
  if (!key) return false;
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeCuePlacedPersisted(gameId: string, placed: boolean): void {
  const key = bihPlacedStorageKey(gameId);
  if (!key) return;
  try {
    if (placed) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
  } catch {
    /* private mode / quota */
  }
}

export class TouchScrollLock {
  private depth = 0;

  lock(): void {
    this.depth += 1;
    if (this.depth === 1) {
      document.documentElement.classList.add("pool-touch-locked");
    }
  }

  unlock(): void {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) {
      document.documentElement.classList.remove("pool-touch-locked");
    }
  }

  clear(): void {
    this.depth = 0;
    document.documentElement.classList.remove("pool-touch-locked");
  }
}
