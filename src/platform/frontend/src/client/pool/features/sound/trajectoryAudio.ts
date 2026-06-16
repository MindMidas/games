import { playGameSound } from "./controller.js";

type BallMap = Record<string, { x: number; y: number }>;
type Velocity = { vx: number; vy: number; speed: number };
type VelocityMap = Map<string, Velocity>;
type PlaySound = typeof playGameSound;

interface AudioSample {
  t?: number;
  balls?: BallMap;
}

const TABLE_W = 1350;
const TABLE_L = 2700;
const BALL_RADIUS = 28.5;
const BALL_DIAMETER = 2 * BALL_RADIUS;
const WALL_MARGIN = BALL_RADIUS + 1;
const RAIL_ZONE = WALL_MARGIN + 22;

const MIN_BALL_HIT_SPEED = 90;
const MIN_RAIL_IMPULSE = 85;
const PAIR_COOLDOWN_S = 0.045;
const RAIL_COOLDOWN_S = 0.07;
const BALL_CONTACT_TOLERANCE = 1.005;

function impactIntensity(speed: number): number {
  return Math.min(1, Math.max(0, (speed - 50) / 1400));
}

function computeVelocities(previous: BallMap, balls: BallMap, elapsed: number): VelocityMap {
  const velocities: VelocityMap = new Map();
  if (elapsed <= 0) return velocities;
  for (const [id, ball] of Object.entries(balls)) {
    const prior = previous[id];
    if (!prior) continue;
    const vx = (Number(ball.x) - Number(prior.x)) / elapsed;
    const vy = (Number(ball.y) - Number(prior.y)) / elapsed;
    velocities.set(id, { vx, vy, speed: Math.hypot(vx, vy) });
  }
  return velocities;
}

function detectBallHits(
  velocities: VelocityMap,
  time: number,
  cooldowns: Map<string, number>,
  previousBalls: BallMap,
  balls: BallMap,
  playSound: PlaySound,
): void {
  const ids = Object.keys(balls);
  for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
      const leftId = ids[leftIndex];
      const rightId = ids[rightIndex];
      const left = balls[leftId];
      const right = balls[rightId];
      const leftVelocity = velocities.get(leftId);
      const rightVelocity = velocities.get(rightId);
      if (!left || !right || !leftVelocity || !rightVelocity) continue;

      const dx = Number(right.x) - Number(left.x);
      const dy = Number(right.y) - Number(left.y);
      const distance = Math.hypot(dx, dy);
      if (distance > BALL_DIAMETER * BALL_CONTACT_TOLERANCE || distance <= 0) continue;

      const previousLeft = previousBalls[leftId];
      const previousRight = previousBalls[rightId];
      if (previousLeft && previousRight) {
        const previousDistance = Math.hypot(
          Number(previousRight.x) - Number(previousLeft.x),
          Number(previousRight.y) - Number(previousLeft.y),
        );
        if (previousDistance <= distance) continue;
      }

      const relativeX = rightVelocity.vx - leftVelocity.vx;
      const relativeY = rightVelocity.vy - leftVelocity.vy;
      const closingSpeed = -(relativeX * dx / distance + relativeY * dy / distance);
      if (closingSpeed < MIN_BALL_HIT_SPEED) continue;

      const key = leftId < rightId ? `${leftId}:${rightId}` : `${rightId}:${leftId}`;
      const previousHit = cooldowns.get(key) ?? -Infinity;
      if (time - previousHit < PAIR_COOLDOWN_S) continue;
      cooldowns.set(key, time);

      playSound("ball_hit", impactIntensity(Math.max(closingSpeed, leftVelocity.speed, rightVelocity.speed)));
    }
  }
}

/**
 * Detect cushion collisions from velocity impulses. This preserves grazes where
 * the instantaneous axis velocity is noisy near short rails.
 */
function detectRailHits(
  velocities: VelocityMap,
  previousVelocities: VelocityMap,
  previousBalls: BallMap,
  time: number,
  cooldowns: Map<string, number>,
  balls: BallMap,
  playSound: PlaySound,
): void {
  for (const [id, ball] of Object.entries(balls)) {
    const velocity = velocities.get(id);
    const previousVelocity = previousVelocities.get(id);
    if (!velocity || !previousVelocity || !previousBalls[id]) continue;

    const x = Number(ball.x);
    const y = Number(ball.y);
    const deltaX = velocity.vx - previousVelocity.vx;
    const deltaY = velocity.vy - previousVelocity.vy;
    let wall: string | null = null;
    let hitSpeed = 0;

    if (x <= RAIL_ZONE && deltaX >= MIN_RAIL_IMPULSE) {
      wall = "left";
      hitSpeed = Math.max(Math.abs(deltaX), Math.abs(previousVelocity.vx));
    } else if (x >= TABLE_W - RAIL_ZONE && deltaX <= -MIN_RAIL_IMPULSE) {
      wall = "right";
      hitSpeed = Math.max(Math.abs(deltaX), Math.abs(previousVelocity.vx));
    } else if (y <= RAIL_ZONE && deltaY >= MIN_RAIL_IMPULSE) {
      wall = "top";
      hitSpeed = Math.max(Math.abs(deltaY), Math.abs(previousVelocity.vy));
    } else if (y >= TABLE_L - RAIL_ZONE && deltaY <= -MIN_RAIL_IMPULSE) {
      wall = "bottom";
      hitSpeed = Math.max(Math.abs(deltaY), Math.abs(previousVelocity.vy));
    }
    if (!wall) continue;

    const key = `${wall}:${id}`;
    const previousHit = cooldowns.get(key) ?? -Infinity;
    if (time - previousHit < RAIL_COOLDOWN_S) continue;
    cooldowns.set(key, time);
    playSound("rail_hit", impactIntensity(hitSpeed));
  }
}

function detectPockets(
  previousBalls: BallMap,
  balls: BallMap,
  pocketed: Set<string>,
  previousVelocities: VelocityMap,
  playSound: PlaySound,
): void {
  for (const id of Object.keys(previousBalls)) {
    if (balls[id] || pocketed.has(id)) continue;
    pocketed.add(id);
    playSound("pocket", impactIntensity(previousVelocities.get(id)?.speed ?? 180));
  }
}

/** Derive collision sounds from rendered physics samples without mutating playback. */
export function createTrajectoryAudio(playSound: PlaySound = playGameSound) {
  let previousSample: { t: number; balls: BallMap } | null = null;
  let previousVelocities: VelocityMap = new Map();
  const pairCooldowns = new Map<string, number>();
  const railCooldowns = new Map<string, number>();
  const pocketed = new Set<string>();

  function reset(): void {
    previousSample = null;
    previousVelocities = new Map();
    pairCooldowns.clear();
    railCooldowns.clear();
    pocketed.clear();
  }

  function tick(sample: AudioSample): void {
    const balls = sample.balls || {};
    const time = Number(sample.t) || 0;
    if (!previousSample) {
      previousSample = { t: time, balls };
      return;
    }

    const elapsed = time - previousSample.t;
    if (elapsed <= 0) {
      previousSample = { t: time, balls };
      return;
    }

    const velocities = computeVelocities(previousSample.balls, balls, elapsed);
    detectBallHits(velocities, time, pairCooldowns, previousSample.balls, balls, playSound);
    detectRailHits(velocities, previousVelocities, previousSample.balls, time, railCooldowns, balls, playSound);
    detectPockets(previousSample.balls, balls, pocketed, previousVelocities, playSound);
    previousVelocities = velocities;
    previousSample = { t: time, balls };
  }

  return { reset, tick };
}
