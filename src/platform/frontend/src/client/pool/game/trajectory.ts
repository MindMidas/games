import { createTrajectoryAudio } from "../features/sound/trajectoryAudio.js";
import type { PoolTrajectory, TrajectorySample } from "./contracts.js";
import { clearCueSticksInOverlays, tableOverlaySvg } from "./poolTableOverlay.js";

type BallMap = Record<string, { x: number; y: number }>;

function readBallCenters(tableSvg: Element): BallMap {
  const centers: BallMap = {};
  for (const group of tableSvg.querySelectorAll("[data-ball]")) {
    const ballNumber = group.getAttribute("data-ball");
    if (!ballNumber) continue;
    for (const circle of group.querySelectorAll("circle")) {
      const x = circle.getAttribute("cx");
      const y = circle.getAttribute("cy");
      if (x == null || y == null) continue;
      centers[ballNumber] = { x: parseFloat(x), y: parseFloat(y) };
      break;
    }
  }
  return centers;
}

let trajectoryPlaying = false;
let trajectoryFrame = 0;
let activePlayback: { resolve: () => void } | null = null;
const trajectoryAudio = createTrajectoryAudio();

export function isTrajectoryPlaying(): boolean {
  return trajectoryPlaying;
}

function clearTrajectoryTransforms(tableSvg: Element | null): void {
  if (!tableSvg) return;
  for (const group of tableSvg.querySelectorAll("[data-ball]")) {
    (group as SVGElement).style.opacity = "";
    group.removeAttribute("transform");
  }
}

function setTrajectoryPlaying(active: boolean): void {
  trajectoryPlaying = active;
  document.getElementById("pool-svg-container")?.classList.toggle("pool-shot-animating", active);
}

function endActivePlayback(): void {
  if (trajectoryFrame) {
    cancelAnimationFrame(trajectoryFrame);
    trajectoryFrame = 0;
  }
  trajectoryAudio.reset();
  clearTrajectoryTransforms(document.getElementById("table-svg"));
  setTrajectoryPlaying(false);
  const playback = activePlayback;
  activePlayback = null;
  playback?.resolve();
}

export function cancelTrajectory(): void {
  endActivePlayback();
}

/** Wait for responsive table layout before replaying a trajectory. */
export function waitForPoolArenaLayout(): Promise<void> {
  window.dispatchEvent(new CustomEvent("pool-arena-layout"));
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

export function clearGlobalCueOverlay(): void {
  clearCueSticksInOverlays([
    tableOverlaySvg(),
    document.getElementById("pool-global-overlay"),
  ]);
}

function applySampleToDom(tableSvg: Element, baseline: BallMap, sample: TrajectorySample): void {
  const balls = sample.balls || {};
  for (const [ballNumber, ball] of Object.entries(balls)) {
    const group = tableSvg.querySelector(`[data-ball="${ballNumber}"]`);
    if (!group) continue;
    const x = Number(ball.x);
    const y = Number(ball.y);
    const start = baseline[ballNumber];
    if (!start) {
      group.setAttribute("transform", `translate(${x},${y})`);
      (group as SVGElement).style.opacity = "1";
      continue;
    }
    group.setAttribute("transform", `translate(${x - start.x},${y - start.y})`);
    (group as SVGElement).style.opacity = "1";
  }
  for (const group of tableSvg.querySelectorAll("[data-ball]")) {
    const ballNumber = group.getAttribute("data-ball");
    if (!ballNumber || balls[ballNumber]) continue;
    (group as SVGElement).style.opacity = "0";
  }
}

export function applyTrajectorySampleToTable(sample: TrajectorySample | null | undefined): void {
  const tableSvg = document.getElementById("table-svg");
  if (!tableSvg || !sample) return;
  applySampleToDom(tableSvg, readBallCenters(tableSvg), sample);
}

/** Animate a physics trajectory while keeping collision audio synchronized. */
export function playTrajectory(trajectory: PoolTrajectory | null | undefined): Promise<void> {
  const tableSvg = document.getElementById("table-svg");
  if (!tableSvg || !trajectory?.samples?.length) return Promise.resolve();

  const activeTableSvg = tableSvg;
  const samples = trajectory.samples;
  const baseline = readBallCenters(activeTableSvg);
  const duration = Math.max(Number(trajectory.duration) || 0, 0.001);
  const startedAt = performance.now();

  function sampleAt(elapsed: number): TrajectorySample {
    let index = 0;
    while (index + 1 < samples.length && Number(samples[index + 1].t) <= elapsed) index += 1;
    return samples[index];
  }

  cancelTrajectory();
  trajectoryAudio.reset();
  setTrajectoryPlaying(true);

  return new Promise<void>((resolve) => {
    activePlayback = { resolve };
    function frame(now: number): void {
      if (!activePlayback) return;
      try {
        const elapsed = (now - startedAt) / 1000;
        const sample = elapsed >= duration ? samples[samples.length - 1] : sampleAt(elapsed);
        applySampleToDom(activeTableSvg, baseline, sample);
        trajectoryAudio.tick(sample);
        if (elapsed >= duration) {
          endActivePlayback();
          return;
        }
        trajectoryFrame = requestAnimationFrame(frame);
      } catch {
        endActivePlayback();
      }
    }
    trajectoryFrame = requestAnimationFrame(frame);
  });
}
