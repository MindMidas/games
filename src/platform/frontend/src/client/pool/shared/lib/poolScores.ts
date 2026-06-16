import type { PoolTable } from "../../game/contracts.js";

const SOLIDS = new Set([1, 2, 3, 4, 5, 6, 7]);
const STRIPES = new Set([9, 10, 11, 12, 13, 14, 15]);

export function normalizeGroup(raw: unknown): "solids" | "stripes" | null {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "solid" || s === "solids") return "solids";
  if (s === "stripe" || s === "stripes") return "stripes";
  return null;
}

export function ballNumbersOnTable(snapshot: Partial<PoolTable> | null | undefined): Set<number> {
  const balls = snapshot?.balls;
  if (!Array.isArray(balls)) {
    return new Set();
  }
  const out = new Set<number>();
  for (const row of balls) {
    const n = Number(row?.n);
    if (Number.isFinite(n)) {
      out.add(n);
    }
  }
  return out;
}

/** Count object balls no longer on the table. */
export function ballsMadeCounts(
  snapshot: Partial<PoolTable> | null | undefined,
): { solids: number; stripes: number } {
  const on = ballNumbersOnTable(snapshot);
  let solidsOn = 0;
  let stripesOn = 0;
  for (const n of SOLIDS) {
    if (on.has(n)) {
      solidsOn += 1;
    }
  }
  for (const n of STRIPES) {
    if (on.has(n)) {
      stripesOn += 1;
    }
  }
  return {
    solids: 7 - solidsOn,
    stripes: 7 - stripesOn,
  };
}

/** Per-player pocket counts for profile chips. */
export function scoresFromSnapshot(snapshot: unknown): {
  p1: number;
  p2: number;
  solids: number;
  stripes: number;
} {
  const snap: Partial<PoolTable> = snapshot && typeof snapshot === "object" ? snapshot : {};
  const made = ballsMadeCounts(snap);
  const p1g = normalizeGroup(snap.p1_playing);
  const p2g = normalizeGroup(snap.p2_playing);

  let p1 = Number(snap.p1_score);
  let p2 = Number(snap.p2_score);
  if (p1g === "solids") {
    p1 = made.solids;
  } else if (p1g === "stripes") {
    p1 = made.stripes;
  } else if (!Number.isFinite(p1)) {
    p1 = 0;
  }

  if (p2g === "solids") {
    p2 = made.solids;
  } else if (p2g === "stripes") {
    p2 = made.stripes;
  } else if (!Number.isFinite(p2)) {
    p2 = 0;
  }

  return { p1, p2, solids: made.solids, stripes: made.stripes };
}
