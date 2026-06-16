export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function moveTweenDuration(distance: number, fast = false): number {
  if (fast) return clamp(80 + distance * 0.12, 100, 180);
  return clamp(200 + distance * 0.32, 240, 520);
}

export function flingArcDuration(distance: number, fast = false): number {
  if (fast) return clamp(280 + distance * 0.42, 320, 620);
  return clamp(720 + distance * 1.0, 800, 1600);
}
