import type { BallPosition } from "../../game/contracts.js";

const MAX_VELOCITY = 4000;
const TABLE_W = 1350;
const TABLE_L = 2700;
const BALL_RADIUS = 28.5;
const BALL_DIAMETER = 2 * BALL_RADIUS;
const HOLE_RADIUS = BALL_DIAMETER * 1.25;
const WALL_MARGIN = BALL_RADIUS + 1;
const HOLE_MARGIN = HOLE_RADIUS + BALL_RADIUS + 1;
const BALL_MIN_SEP = BALL_DIAMETER + 1;
const HOLES: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, TABLE_L / 2],
  [0, TABLE_L],
  [TABLE_W, 0],
  [TABLE_W, TABLE_L / 2],
  [TABLE_W, TABLE_L],
];

export interface Point {
  x: number;
  y: number;
}

export interface PullVector {
  dx: number;
  dy: number;
  len: number;
}

export interface ShotVelocity {
  xVel: number;
  yVel: number;
}

/** Parse the translation applied to a rendered SVG cue-ball group. */
export function parseTranslate(transform: string | null | undefined): { dx: number; dy: number } {
  if (!transform) return { dx: 0, dy: 0 };
  const match = transform.match(/translate\(\s*([-\d.eE+]+)\s*[, ]\s*([-\d.eE+]+)\s*\)/);
  if (!match) return { dx: 0, dy: 0 };
  return {
    dx: Number.parseFloat(match[1]) || 0,
    dy: Number.parseFloat(match[2]) || 0,
  };
}

/** Clamp a pointer pull while preserving its direction. */
export function clampPull(dx: number, dy: number, maxLength: number): PullVector {
  const length = Math.hypot(dx, dy);
  if (length <= maxLength || length < 1e-10) return { dx, dy, len: length };
  const scale = maxLength / length;
  return { dx: dx * scale, dy: dy * scale, len: maxLength };
}

/** Clamp cue placement to the playable table rectangle. */
export function clampTablePoint(x: number, y: number): Point {
  return {
    x: Math.min(TABLE_W - WALL_MARGIN, Math.max(WALL_MARGIN, x)),
    y: Math.min(TABLE_L - WALL_MARGIN, Math.max(WALL_MARGIN, y)),
  };
}

/** Return whether a cue-ball placement avoids rails, holes, and object balls. */
export function isValidCuePlacement(
  x: number,
  y: number,
  balls: readonly Partial<BallPosition>[] | null | undefined,
): boolean {
  if (x < WALL_MARGIN || x > TABLE_W - WALL_MARGIN) return false;
  if (y < WALL_MARGIN || y > TABLE_L - WALL_MARGIN) return false;
  for (const [holeX, holeY] of HOLES) {
    if (Math.hypot(holeX - x, holeY - y) < HOLE_MARGIN) return false;
  }
  for (const ball of balls || []) {
    if (!ball || ball.n === 0) continue;
    const ballX = Number(ball.x);
    const ballY = Number(ball.y);
    if (Number.isFinite(ballX) && Number.isFinite(ballY) && Math.hypot(ballX - x, ballY - y) < BALL_MIN_SEP) {
      return false;
    }
  }
  return true;
}

/**
 * Convert a visual overlay pull into table velocity.
 * The sampled projection keeps aim direction correct across responsive transforms.
 */
export function tableVelocityFromOverlayPull(
  project: (x: number, y: number) => Point | null,
  cueX: number,
  cueY: number,
  pullX: number,
  pullY: number,
  speedMagnitude: number,
): ShotVelocity {
  const epsilon = 40;
  const origin = project(cueX, cueY);
  const xPoint = project(cueX + epsilon, cueY);
  const yPoint = project(cueX, cueY + epsilon);
  if (!origin || !xPoint || !yPoint) return { xVel: 0, yVel: 0 };

  const xx = (xPoint.x - origin.x) / epsilon;
  const xy = (yPoint.x - origin.x) / epsilon;
  const yx = (xPoint.y - origin.y) / epsilon;
  const yy = (yPoint.y - origin.y) / epsilon;
  const determinant = xx * yy - xy * yx;
  if (Math.abs(determinant) < 1e-10) return { xVel: 0, yVel: 0 };

  const tableX = (yy * pullX - xy * pullY) / determinant;
  const tableY = (-yx * pullX + xx * pullY) / determinant;
  const tableLength = Math.hypot(tableX, tableY);
  if (tableLength < 1e-10) return { xVel: 0, yVel: 0 };

  const scale = speedMagnitude / tableLength;
  return {
    xVel: Math.min(MAX_VELOCITY, Math.max(-MAX_VELOCITY, tableX * scale)),
    yVel: Math.min(MAX_VELOCITY, Math.max(-MAX_VELOCITY, tableY * scale)),
  };
}
