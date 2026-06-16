import { playGameSound } from "../features/sound/controller.js";
import {
  ensurePoolGlobalOverlay,
  tablePointToOverlay,
  tableRotor,
  tableSvgRoot,
} from "./poolTableOverlay.js";
import type { PoolTrajectory, ShotAim } from "./contracts.js";

interface CueStickParts {
  g: SVGGElement;
  shadow: SVGPathElement;
  shaft: SVGPathElement;
  butt: SVGPathElement;
  ferrule: SVGRectElement;
  tip: SVGCircleElement;
}

interface CueMotion {
  x0: number;
  y0: number;
  x1?: number;
  y1?: number;
}

interface OverlayPull {
  dx: number;
  dy: number;
  pullLen?: number;
}

interface StrikePose {
  angle: number;
  baseOffset: number;
  pullOffset: number;
  anchor?: { x: number; y: number };
}

interface StrikeOptions {
  durationMs?: number;
  fadeMs?: number;
  waitMs?: number;
  onHit?: () => void;
}

type SavedAim = ShotAim & {
  base_offset?: number;
  baseOffset?: number;
  pull_dist?: number;
  pull_offset?: number;
  pullOffset?: number;
  pull_dx_px?: number;
  pullDxPx?: number;
  pull_dy_px?: number;
  pullDyPx?: number;
};

const VEL_SCALE = 24;
const MAX_PULL_PX = 145;
const CUE_PULLBACK_SCALE = 0.58;
const TIP_GAP_PX = 10;
const SVG_NS = "http://www.w3.org/2000/svg";

function overlayWidthUnits(svgOverlayEl: SVGSVGElement): number {
  const rect = svgOverlayEl.getBoundingClientRect?.();
  const width = rect ? rect.width : window.innerWidth;
  return Number.isFinite(width) && width > 0 ? width : 800;
}

function buildCueStick(svgOverlayEl: SVGSVGElement): CueStickParts {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("data-ui", "cue-stick");
  g.setAttribute("data-ui-layer", "replay");
  g.style.pointerEvents = "none";
  g.style.transformOrigin = "0 0";

  const shadow = document.createElementNS(SVG_NS, "path");
  shadow.setAttribute("fill", "rgba(0,0,0,0.18)");

  const shaft = document.createElementNS(SVG_NS, "path");
  shaft.setAttribute("fill", "#d7b27c");
  shaft.setAttribute("opacity", "0.96");

  const butt = document.createElementNS(SVG_NS, "path");
  butt.setAttribute("fill", "#141414");
  butt.setAttribute("opacity", "0.92");

  const ferrule = document.createElementNS(SVG_NS, "rect");
  ferrule.setAttribute("fill", "#f2efe9");
  ferrule.setAttribute("opacity", "0.95");

  const tip = document.createElementNS(SVG_NS, "circle");
  tip.setAttribute("fill", "#7a4b2a");
  tip.setAttribute("opacity", "0.95");

  g.append(shadow, shaft, butt, ferrule, tip);
  svgOverlayEl.appendChild(g);

  const parts = { g, shadow, shaft, butt, ferrule, tip };
  updateCueStickGeometry(svgOverlayEl, parts);
  return parts;
}

function updateCueStickGeometry(svgOverlayEl: SVGSVGElement, parts: CueStickParts): {
  stickLen: number;
  tipLen: number;
} {
  const width = overlayWidthUnits(svgOverlayEl);
  const stickLen = Math.min(360, Math.max(180, width * 0.42));
  const buttLen = stickLen * 0.28;
  const tipLen = Math.min(26, Math.max(14, stickLen * 0.055));
  const buttW = Math.min(12.5, Math.max(7.2, width * 0.0108));
  const midW = Math.min(10.8, Math.max(6.6, width * 0.0096));
  const tipW = Math.min(7.4, Math.max(4.8, width * 0.0072));

  const x0 = -stickLen;
  const x1 = -buttLen;
  const x2 = 0;

  parts.shaft.setAttribute("d", [
    `M ${x0} ${-midW / 2}`,
    `L ${x1} ${-midW / 2}`,
    `L ${x2} ${-tipW / 2}`,
    `L ${x2} ${tipW / 2}`,
    `L ${x1} ${midW / 2}`,
    `L ${x0} ${midW / 2}`,
    "Z",
  ].join(" "));

  parts.butt.setAttribute("d", [
    `M ${x0} ${-buttW / 2}`,
    `L ${x1} ${-buttW / 2}`,
    `L ${x1} ${buttW / 2}`,
    `L ${x0} ${buttW / 2}`,
    "Z",
  ].join(" "));

  parts.shadow.setAttribute("d", [
    `M ${x0} ${-midW / 2 + 3}`,
    `L ${x1} ${-midW / 2 + 3}`,
    `L ${x2} ${-tipW / 2 + 3}`,
    `L ${x2} ${tipW / 2 + 3}`,
    `L ${x1} ${midW / 2 + 3}`,
    `L ${x0} ${midW / 2 + 3}`,
    "Z",
  ].join(" "));

  const ferruleLen = Math.min(18, Math.max(10, tipLen * 0.7));
  const ferruleH = tipW * 1.45;
  parts.ferrule.setAttribute("x", String(-ferruleLen));
  parts.ferrule.setAttribute("y", String(-ferruleH / 2));
  parts.ferrule.setAttribute("width", String(ferruleLen));
  parts.ferrule.setAttribute("height", String(ferruleH));
  parts.ferrule.setAttribute("rx", String(Math.max(2, ferruleH * 0.18)));

  parts.tip.setAttribute("cx", "0");
  parts.tip.setAttribute("cy", "0");
  parts.tip.setAttribute("r", String(Math.max(2.1, tipW * 0.19)));

  return { stickLen, tipLen };
}

function cueBallAtSample(trajectory: PoolTrajectory, index: number): { x: number; y: number } | null {
  const ball = trajectory.samples?.[index]?.balls?.["0"] || trajectory.samples?.[index]?.balls?.[0];
  if (!ball) return null;
  const x = Number(ball.x);
  const y = Number(ball.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function cueBallFromTrajectory(trajectory: PoolTrajectory | null | undefined): CueMotion | null {
  if (!Array.isArray(trajectory?.samples) || trajectory.samples.length < 1) return null;
  const start = cueBallAtSample(trajectory, 0);
  if (!start) return null;

  const out: CueMotion = { x0: start.x, y0: start.y };
  if (trajectory.samples.length >= 2) {
    const next = cueBallAtSample(trajectory, 1);
    if (next) {
      out.x1 = next.x;
      out.y1 = next.y;
    }
  }
  return out;
}

function cueBallRadiusOverlay(svg: SVGSVGElement, cueX: number, cueY: number): number {
  const cue = tableRotor()?.querySelector('[data-ball="0"]');
  if (!cue) return 22;

  const radius = Number(cue.getAttribute("r") || cue.querySelector("circle")?.getAttribute("r") || 0);
  if (!Number.isFinite(radius) || radius <= 0) return 22;

  const origin = tablePointToOverlay(svg, cueX, cueY);
  const edge = tablePointToOverlay(svg, cueX + radius, cueY);
  if (!origin || !edge) return 22;

  const overlayRadius = Math.hypot(edge.x - origin.x, edge.y - origin.y);
  return Number.isFinite(overlayRadius) && overlayRadius > 0 ? overlayRadius : 22;
}

function overlayPullFromTableVelocity(
  svg: SVGSVGElement,
  cueX: number,
  cueY: number,
  xVel: number,
  yVel: number,
): OverlayPull | null {
  const tableSpeed = Math.hypot(xVel, yVel);
  if (tableSpeed < 1e-10) return null;

  const origin = tablePointToOverlay(svg, cueX, cueY);
  const target = tablePointToOverlay(svg, cueX + xVel, cueY + yVel);
  if (!origin || !target) return null;

  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const overlayLen = Math.hypot(dx, dy);
  if (!Number.isFinite(overlayLen) || overlayLen < 1e-6) return null;

  const pullLen = Math.min(MAX_PULL_PX, Math.max(0, tableSpeed / VEL_SCALE));
  const scale = pullLen / overlayLen;
  return { dx: dx * scale, dy: dy * scale, pullLen };
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function poseFromOverlayPull(
  overlayPull: OverlayPull,
  pullDistPx: number | undefined,
  svg: SVGSVGElement,
  cueX: number,
  cueY: number,
  saved: SavedAim = {},
): StrikePose | null {
  const len = Math.hypot(overlayPull.dx, overlayPull.dy);
  if (!Number.isFinite(len) || len < 1e-6) return null;

  const savedPullDist = finiteNumber(saved.pull_dist);
  const fallbackPullDist = finiteNumber(pullDistPx);
  const savedPullOffset = finiteNumber(saved.pull_offset ?? saved.pullOffset);
  const savedBaseOffset = finiteNumber(saved.base_offset ?? saved.baseOffset);
  const pullDist = savedPullDist ?? fallbackPullDist ?? len;

  return {
    angle: Math.atan2(overlayPull.dy, overlayPull.dx) * (180 / Math.PI),
    baseOffset: savedBaseOffset ?? cueBallRadiusOverlay(svg, cueX, cueY) + TIP_GAP_PX,
    pullOffset: savedPullOffset ?? pullDist * CUE_PULLBACK_SCALE,
  };
}

function poseFromSavedScreenAim(
  saved: SavedAim | null | undefined,
  svg: SVGSVGElement,
  cueX: number,
  cueY: number,
): StrikePose | null {
  if (!saved || typeof saved !== "object") return null;

  const pullDx = finiteNumber(saved.pull_dx_px ?? saved.pullDxPx);
  const pullDy = finiteNumber(saved.pull_dy_px ?? saved.pullDyPx);
  if (pullDx != null && pullDy != null) {
    const anchor = tablePointToOverlay(svg, cueX, cueY);
    if (!anchor) return null;
    const len = Math.hypot(pullDx, pullDy);
    if (len >= 1e-6) {
      const pullDist = finiteNumber(saved.pull_dist) ?? len;
      return {
        angle: Math.atan2(pullDy, pullDx) * (180 / Math.PI),
        baseOffset: finiteNumber(saved.base_offset ?? saved.baseOffset)
          ?? cueBallRadiusOverlay(svg, cueX, cueY) + TIP_GAP_PX,
        pullOffset: finiteNumber(saved.pull_offset ?? saved.pullOffset)
          ?? pullDist * CUE_PULLBACK_SCALE,
        anchor,
      };
    }
  }

  const angle = finiteNumber(saved.angle);
  const baseOffset = finiteNumber(saved.base_offset ?? saved.baseOffset);
  const pullOffset = finiteNumber(saved.pull_offset ?? saved.pullOffset);
  const anchor = tablePointToOverlay(svg, cueX, cueY);
  return angle != null && baseOffset != null && pullOffset != null && anchor
    ? { angle, baseOffset, pullOffset, anchor }
    : null;
}

function aimFromTableVelocity(
  svg: SVGSVGElement,
  trajectory: PoolTrajectory,
  cueX: number,
  cueY: number,
  saved: SavedAim = {},
): StrikePose | null {
  const xVel = finiteNumber(trajectory.x_vel);
  const yVel = finiteNumber(trajectory.y_vel);
  if (xVel != null && yVel != null) {
    const overlayPull = overlayPullFromTableVelocity(svg, cueX, cueY, xVel, yVel);
    const pose = overlayPull
      ? poseFromOverlayPull(overlayPull, overlayPull.pullLen, svg, cueX, cueY, saved)
      : null;
    if (pose) return pose;
  }

  const cue = cueBallFromTrajectory(trajectory);
  if (cue && Number.isFinite(cue.x1) && Number.isFinite(cue.y1)) {
    const samples = trajectory.samples;
    const dt = Array.isArray(samples) && samples.length >= 2
      ? Math.max(Number(samples[1]?.t) - Number(samples[0]?.t), 1e-4)
      : 0.02;
    const vx = (Number(cue.x1) - cue.x0) / dt;
    const vy = (Number(cue.y1) - cue.y0) / dt;
    const overlayPull = overlayPullFromTableVelocity(svg, cue.x0, cue.y0, vx, vy);
    const pose = overlayPull
      ? poseFromOverlayPull(overlayPull, overlayPull.pullLen, svg, cue.x0, cue.y0, saved)
      : null;
    if (pose) return pose;
  }

  return null;
}

function aimFromSampleMotion(
  svg: SVGSVGElement,
  trajectory: PoolTrajectory,
  cueX: number,
  cueY: number,
): StrikePose | null {
  const samples = trajectory.samples;
  if (!Array.isArray(samples) || samples.length < 2) return null;

  const saved = trajectory.aim as SavedAim | undefined;
  const t0 = Number(samples[0]?.t) || 0;
  const start = cueBallAtSample(trajectory, 0);
  if (!start) return null;

  for (let index = 1; index < Math.min(samples.length, 12); index += 1) {
    const dt = Number(samples[index]?.t) - t0;
    const sample = cueBallAtSample(trajectory, index);
    if (!Number.isFinite(dt) || dt < 1e-4 || !sample) continue;

    const vx = (sample.x - start.x) / dt;
    const vy = (sample.y - start.y) / dt;
    if (Math.hypot(vx, vy) < 20) continue;

    const overlayPull = overlayPullFromTableVelocity(svg, cueX, cueY, vx, vy);
    const pose = overlayPull
      ? poseFromOverlayPull(overlayPull, overlayPull.pullLen, svg, cueX, cueY, saved)
      : null;
    if (pose) return pose;
  }
  return null;
}

function strikeAimFromTrajectory(
  svg: SVGSVGElement,
  trajectory: PoolTrajectory,
  cueX: number,
  cueY: number,
): StrikePose | null {
  const saved = trajectory.aim as SavedAim | undefined;
  const fromVelocity = aimFromTableVelocity(svg, trajectory, cueX, cueY, saved);
  if (fromVelocity) {
    const anchor = tablePointToOverlay(svg, cueX, cueY);
    return anchor ? { ...fromVelocity, anchor } : fromVelocity;
  }

  const fromSamples = aimFromSampleMotion(svg, trajectory, cueX, cueY);
  if (fromSamples) {
    const anchor = tablePointToOverlay(svg, cueX, cueY);
    return anchor ? { ...fromSamples, anchor } : fromSamples;
  }
  return poseFromSavedScreenAim(saved, svg, cueX, cueY);
}

async function waitForCueStrikeReady(
  svg: SVGSVGElement,
  cueX: number,
  cueY: number,
  trajectory: PoolTrajectory,
  maxMs = 500,
): Promise<boolean> {
  const deadline = performance.now() + Math.max(0, maxMs);
  while (performance.now() < deadline) {
    if (tableSvgRoot() && tableRotor()?.getScreenCTM?.() && svg.getScreenCTM?.()) {
      const anchor = tablePointToOverlay(svg, cueX, cueY);
      const aim = strikeAimFromTrajectory(svg, trajectory, cueX, cueY);
      if (anchor && aim) return true;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
  return false;
}

function isMobileDrawerOpen(): boolean {
  return Boolean(document.getElementById("game-app")?.classList.contains("game-drawer-open"));
}

export async function animateCueStrikeFromTrajectory(
  trajectory: PoolTrajectory,
  opts: StrikeOptions = {},
): Promise<boolean> {
  const cue = cueBallFromTrajectory(trajectory);
  if (!cue) return false;

  if (isMobileDrawerOpen()) {
    try { opts.onHit?.(); } catch { /* noop */ }
    return false;
  }

  const svg = ensurePoolGlobalOverlay();

  const waitMs = Number(opts.waitMs);
  const maxWait = Number.isFinite(waitMs) ? waitMs : 500;
  const ready = await waitForCueStrikeReady(svg, cue.x0, cue.y0, trajectory, maxWait);
  if (!ready) return false;

  const anchor = tablePointToOverlay(svg, cue.x0, cue.y0);
  const aim = strikeAimFromTrajectory(svg, trajectory, cue.x0, cue.y0);
  if (!anchor || !aim) return false;

  const cuePos = aim.anchor || anchor;
  const { angle, baseOffset, pullOffset } = aim;
  const parts = buildCueStick(svg);

  const fromX = -baseOffset - pullOffset;
  const toX = -baseOffset + Math.max(4, Math.min(10, pullOffset * 0.12));

  const duration = Number(opts.durationMs);
  const strikeMs = Number.isFinite(duration) ? duration : 140;
  const fadeMs = Number.isFinite(Number(opts.fadeMs)) ? Number(opts.fadeMs) : 190;

  const from = `translate(${cuePos.x}px, ${cuePos.y}px) rotate(${angle}deg) translate(${fromX}px, 0px)`;
  const to = `translate(${cuePos.x}px, ${cuePos.y}px) rotate(${angle}deg) translate(${toX}px, 0px)`;
  parts.g.style.opacity = "1";
  parts.g.style.transform = from;

  const anim = parts.g.animate(
    [{ transform: from, opacity: 1 }, { transform: to, opacity: 1 }],
    { duration: Math.round(strikeMs), easing: "cubic-bezier(0.18, 0.9, 0.2, 1)", fill: "forwards" },
  );

  playGameSound("ball_hit", 0.55);
  try { await anim.finished; } catch { /* noop */ }
  try { opts.onHit?.(); } catch { /* noop */ }

  const fade = parts.g.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: Math.round(fadeMs), easing: "ease-out", fill: "forwards" },
  );
  try { await fade.finished; } catch { /* noop */ }

  try { svg.removeChild(parts.g); } catch { /* noop */ }
  return true;
}
