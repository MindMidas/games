import { pieceCodeLooksValid } from "../shared/lib/security.js";

export type ParsedActionKey =
  | { kind: "move"; from: string; to: string }
  | { kind: "shoot"; square: string; direction: string }
  | { kind: "fling"; catapult: string; payload: string; target: string };

export interface HistoryRow {
  seq?: number | string;
  step?: number | string;
  color?: string;
  from_?: string | null;
  to?: string | null;
  piece?: string | null;
  captured?: unknown[];
  spawned?: unknown[];
  transformed?: unknown[];
  notation?: string | null;
}

export interface HistoryRowMeta {
  hasCapture: boolean;
  caps: string[];
  parsed: ParsedActionKey | null;
  zombiePromoZ: string | null;
  contagionZombieCodes: string[];
  regularPromoCode: string | null;
}

export function parseActionKey(notation: string | null | undefined): ParsedActionKey | null {
  const text = String(notation || "").trim();
  if (!text) {
    return null;
  }
  let m = text.match(/^fling:([a-h][1-8]):([a-h][1-8])>([a-h][1-8])/i);
  if (m) {
    return { kind: "fling", catapult: m[1].toLowerCase(), payload: m[2].toLowerCase(), target: m[3].toLowerCase() };
  }
  m = text.match(/^Fling\s+([a-h][1-8])\s*:\s*([a-h][1-8])\s*(?:->|>|→)\s*([a-h][1-8])/i);
  if (m) {
    return { kind: "fling", catapult: m[1].toLowerCase(), payload: m[2].toLowerCase(), target: m[3].toLowerCase() };
  }
  m = text.match(/^shoot:([a-h][1-8]):([a-z]+)/i);
  if (m) {
    return { kind: "shoot", square: m[1].toLowerCase(), direction: m[2].toLowerCase() };
  }
  m = text.match(/^move:([a-h][1-8])>([a-h][1-8])/i);
  if (m) {
    return { kind: "move", from: m[1].toLowerCase(), to: m[2].toLowerCase() };
  }
  return null;
}

export function parseFlingSquares(
  notation: string | null | undefined,
): { catapult: string; payload: string; target: string } | null {
  const p = parseActionKey(notation);
  if (p && p.kind === "fling") {
    return { catapult: p.catapult, payload: p.payload, target: p.target };
  }
  return null;
}

function isZombieCode(code: unknown): boolean {
  return /^[wb]Z$/i.test(String(code || ""));
}

function removeOnePieceCode(list: string[], code: unknown): string[] {
  const target = String(code || "").trim().toLowerCase();
  if (!target) {
    return list;
  }
  let removed = false;
  const out: string[] = [];
  for (const c of list) {
    if (!removed && String(c).trim().toLowerCase() === target) {
      removed = true;
      continue;
    }
    out.push(c);
  }
  return out;
}

export function historyRowMeta(row: HistoryRow): HistoryRowMeta {
  const parsed = parseActionKey(row?.notation);
  const rawCaps = Array.isArray(row?.captured) ? row.captured.filter(Boolean).map(String) : [];
  const moving = String(row.piece || "").trim();
  /** Fling removes the payload from the board; engine may list it in ``captured`` - do not show as a capture. */
  const caps =
    parsed?.kind === "fling" && moving && pieceCodeLooksValid(moving)
      ? rawCaps.filter((c) => String(c).trim().toLowerCase() !== moving.toLowerCase())
      : rawCaps;
  const spawned = Array.isArray(row?.spawned) ? row.spawned.filter(Boolean).map(String) : [];
  const transformed = Array.isArray(row?.transformed) ? row.transformed.filter(Boolean).map(String) : [];

  const pawnMoved = /^[wb]P$/i.test(moving);
  const moverCh = row.color === "b" ? "b" : "w";

  const isPawnPromoMove =
    pawnMoved &&
    parsed?.kind === "move" &&
    typeof parsed.to === "string" &&
    parsed.to.length >= 2 &&
    ((moverCh === "w" && parsed.to[1] === "8") || (moverCh === "b" && parsed.to[1] === "1"));

  let zombiePromoZ: string | null = null;
  const transformedZ = transformed.filter((c) => pieceCodeLooksValid(c) && isZombieCode(c));
  if (isPawnPromoMove && transformedZ.length > 0) {
    zombiePromoZ =
      transformedZ.find((z) => String(z).toLowerCase().startsWith(moverCh)) || transformedZ[0];
  }

  const regularPromo = transformed.find((t) => /^[wb][QRBN]$/i.test(String(t)) && !isZombieCode(t));
  const regularPromoCode =
    isPawnPromoMove &&
    regularPromo &&
    pieceCodeLooksValid(regularPromo) &&
    !zombiePromoZ &&
    String(regularPromo).trim().toLowerCase() !== moving.toLowerCase()
      ? String(regularPromo)
      : null;

  /**
   * Contagion rail:
   * - Classic: adjacent enemy pieces become friendly zombies (wZ/bZ).
   * - Some rulesets: adjacent enemy pieces "flip" to friendly pieces of the same type (e.g. bN -> wN).
   *
   * The move table should show the hazard glyph + the resulting friendly piece codes for either case.
   */
  const spawnedFriendly = spawned.filter(
    (c) => pieceCodeLooksValid(c) && String(c).trim().toLowerCase().startsWith(moverCh),
  );
  const transformedFriendly = transformed.filter(
    (c) => pieceCodeLooksValid(c) && String(c).trim().toLowerCase().startsWith(moverCh),
  );

  const spawnedCounts = new Map<string, number>();
  const transformedCounts = new Map<string, number>();
  const inc = (m: Map<string, number>, code: string): void => {
    m.set(code, (m.get(code) || 0) + 1);
  };
  for (const c of spawnedFriendly) {
    const code = String(c).trim();
    if (!code) continue;
    if (zombiePromoZ && String(zombiePromoZ).trim() === code) continue;
    if (regularPromoCode && String(regularPromoCode).trim() === code) continue;
    inc(spawnedCounts, code);
  }
  for (const c of transformedFriendly) {
    const code = String(c).trim();
    if (!code) continue;
    if (zombiePromoZ && String(zombiePromoZ).trim() === code) continue;
    if (regularPromoCode && String(regularPromoCode).trim() === code) continue;
    inc(transformedCounts, code);
  }
  const contagionZombieCodes: string[] = [];
  const allCodes = new Set([...spawnedCounts.keys(), ...transformedCounts.keys()]);
  for (const code of allCodes) {
    const copies = Math.max(spawnedCounts.get(code) || 0, transformedCounts.get(code) || 0);
    for (let i = 0; i < copies; i++) contagionZombieCodes.push(code);
  }

  // zombie arriving on the destination square is a move/capture, not contagion.
  if (isZombieCode(moving) && parsed?.kind === "move") {
    const filtered = removeOnePieceCode(contagionZombieCodes, moving);
    contagionZombieCodes.length = 0;
    contagionZombieCodes.push(...filtered);
  }

  const hasCapture = caps.length > 0;

  return {
    hasCapture,
    caps,
    parsed,
    zombiePromoZ,
    contagionZombieCodes,
    regularPromoCode,
  };
}
