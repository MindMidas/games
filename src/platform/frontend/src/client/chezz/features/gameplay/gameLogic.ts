export type ActionRecord = Record<string, unknown>;
export type Selection = { selectedSquare: string | null; selectedPayload: string | null };
type PartialSelection = Partial<Selection>;
type HighlightMap = Record<string, string[]>;
export type ActionIndex = {
  all: ActionRecord[];
  moveByFrom: Map<string, ActionRecord[]>;
  shootBySquare: Map<string, ActionRecord[]>;
  flingByCatapult: Map<string, ActionRecord[]>;
};
type ClickOutcome = {
  nextSelection: Selection;
  action: ActionRecord | null;
  illegalSquare: string | null;
  consumed: boolean;
};

export function toCoord(square: string): { file: number; rank: number } {
  return {
    file: square.charCodeAt(0) - "a".charCodeAt(0),
    rank: Number(square[1]),
  };
}


export function toSquare(file: number, rank: number): string {
  return `${String.fromCharCode("a".charCodeAt(0) + file)}${rank}`;
}


export function inBounds(file: number, rank: number): boolean {
  return file >= 0 && file <= 7 && rank >= 1 && rank <= 8;
}


export function directionDelta(direction: string): [number, number] | null {
  const deltas: Record<string, [number, number]> = {
    tl: [-1, 1],
    tr: [1, 1],
    bl: [-1, -1],
    br: [1, -1],
  };
  return deltas[direction] || null;
}


export function raySquares(fromSquare: string, direction: string): string[] {
  const delta = directionDelta(direction);
  if (!delta) return [];
  const from = toCoord(fromSquare);
  const squares: string[] = [];
  let file = from.file + delta[0];
  let rank = from.rank + delta[1];
  while (inBounds(file, rank)) {
    squares.push(toSquare(file, rank));
    file += delta[0];
    rank += delta[1];
  }
  return squares;
}


export { effectiveYouColor } from "../../../platform/game/clock.js";

export function normalizeSquare(value: unknown): string {
  const square = String(value || "").trim().toLowerCase();
  return /^[a-h][1-8]$/.test(square) ? square : "";
}


function indexMoveActions(actions: ActionRecord[]): Map<string, ActionRecord[]> {
  const byFrom = new Map<string, ActionRecord[]>();
  for (const action of actions) {
    if (action?.kind !== "move") continue;
    const from = normalizeSquare(action.from);
    const to = normalizeSquare(action.to);
    if (!from || !to) continue;
    const list = byFrom.get(from) || [];
    list.push(action);
    byFrom.set(from, list);
  }
  return byFrom;
}


function indexShootActions(actions: ActionRecord[]): Map<string, ActionRecord[]> {
  const bySquare = new Map<string, ActionRecord[]>();
  for (const action of actions) {
    if (action?.kind !== "shoot") continue;
    const square = normalizeSquare(action.square);
    const direction = String(action.direction || "").trim().toLowerCase();
    if (!square || !direction) continue;
    const list = bySquare.get(square) || [];
    list.push(action);
    bySquare.set(square, list);
  }
  return bySquare;
}


function indexFlingActions(actions: ActionRecord[]): Map<string, ActionRecord[]> {
  const byCatapult = new Map<string, ActionRecord[]>();
  for (const action of actions) {
    if (action?.kind !== "fling") continue;
    const catapult = normalizeSquare(action.catapult);
    const payload = normalizeSquare(action.payload);
    const target = normalizeSquare(action.target);
    if (!catapult || !payload || !target) continue;
    const list = byCatapult.get(catapult) || [];
    list.push(action);
    byCatapult.set(catapult, list);
  }
  return byCatapult;
}


function hasAnyOrigin(indexed: ActionIndex, square: string): boolean {
  return indexed.moveByFrom.has(square) || indexed.shootBySquare.has(square) || indexed.flingByCatapult.has(square);
}


function pieceColor(code: unknown): string {
  if (!code || typeof code !== "string") return "";
  return String(code[0] || "").toLowerCase();
}


function isOwnPieceOnSquare(
  boardMap: Record<string, string>,
  square: string,
  youColor: string,
): boolean {
  const s = normalizeSquare(square);
  const you = String(youColor || "").toLowerCase();
  if (!s || !you) return false;
  const piece = boardMap?.[s];
  return Boolean(piece && pieceColor(piece) === you);
}


export function squareAllowsPieceDrag(indexed: ActionIndex, sq: unknown): boolean {
  const s = normalizeSquare(sq);
  if (!s || !hasAnyOrigin(indexed, s)) return false;
  return true;
}


function highlightSquare(highlights: HighlightMap, square: string, className: string): void {
  if (!square || !className) return;
  const list = highlights[square] || [];
  if (!list.includes(className)) list.push(className);
  highlights[square] = list;
}


function normalizeSelection(selection: PartialSelection = {}): Selection {
  return {
    selectedSquare: normalizeSquare(selection.selectedSquare) || null,
    selectedPayload: normalizeSquare(selection.selectedPayload) || null,
  };
}


export function buildLegalActionIndex(actions: unknown = []): ActionIndex {
  const safeActions = Array.isArray(actions)
    ? actions.filter((action): action is ActionRecord => Boolean(action) && typeof action === "object")
    : [];
  return {
    all: safeActions,
    moveByFrom: indexMoveActions(safeActions),
    shootBySquare: indexShootActions(safeActions),
    flingByCatapult: indexFlingActions(safeActions),
  };
}


export function highlightForSelection(
  indexed: ActionIndex,
  selection: PartialSelection = {},
  opts: { moveDestinations?: boolean } = {},
): HighlightMap {
  const includeMoveDestinations = opts.moveDestinations !== false;
  const highlights: HighlightMap = {};
  const normalized = normalizeSelection(selection);
  if (!normalized.selectedSquare) return highlights;

  const from = normalized.selectedSquare;

  const shootActions = indexed.shootBySquare.get(from) || [];
  for (const action of shootActions) {
    const direction = String(action.direction || "").trim().toLowerCase();
    const ray = raySquares(from, direction);
    for (const square of ray) {
      highlightSquare(highlights, square, "cannon-ray");
      highlightSquare(highlights, square, `cannon-ray-${direction}`);
    }
  }

  const flingActions = indexed.flingByCatapult.get(from) || [];
  if (flingActions.length > 0) {
    if (!normalized.selectedPayload) {
      const payloadSquares = new Set(
        flingActions.map((action) => normalizeSquare(action.payload)).filter(Boolean),
      );
      for (const square of payloadSquares) {
        highlightSquare(highlights, square, "fling-payload");
      }
    } else {
      const scoped = flingActions.filter(
        (action) => normalizeSquare(action.payload) === normalized.selectedPayload,
      );
      for (const action of scoped) {
        const target = normalizeSquare(action.target);
        if (!target) continue;
        highlightSquare(highlights, target, "fling-target-preview");
      }
    }
  }

  return highlights;
}


function resolveShootAction(
  shootActions: ActionRecord[],
  clickedSquare: string,
): ActionRecord | null {
  let match: ActionRecord | null = null;
  for (const action of shootActions) {
    const ray = raySquares(normalizeSquare(action.square), String(action.direction || ""));
    if (ray.includes(clickedSquare)) {
      if (match) return null;
      match = action;
    }
  }
  return match;
}


export function resolveClickOutcome(
  indexed: ActionIndex,
  boardMap: Record<string, string>,
  selection: PartialSelection,
  clickedSquare: unknown,
  youColor = "",
  opts: { moveAttempt?: boolean } = {},
): ClickOutcome {
  const moveAttempt = opts?.moveAttempt === true;
  const normalized = normalizeSelection(selection);
  const square = normalizeSquare(clickedSquare);
  if (!square) {
    return { nextSelection: normalized, action: null, illegalSquare: null, consumed: false };
  }

  if (!normalized.selectedSquare) {
    if (hasAnyOrigin(indexed, square)) {
      return {
        nextSelection: { selectedSquare: square, selectedPayload: null },
        action: null, illegalSquare: null, consumed: true,
      };
    }
    if (isOwnPieceOnSquare(boardMap, square, youColor)) {
      return {
        nextSelection: { selectedSquare: square, selectedPayload: null },
        action: null, illegalSquare: null, consumed: true,
      };
    }
    return { nextSelection: normalized, action: null, illegalSquare: null, consumed: false };
  }

  const from = normalized.selectedSquare;

  if (square === from) {
    return {
      nextSelection: { selectedSquare: null, selectedPayload: null },
      action: null, illegalSquare: null, consumed: true,
    };
  }

  const flingActions = indexed.flingByCatapult.get(from) || [];
  if (flingActions.length > 0 && !normalized.selectedPayload) {
    const payloadMatch = flingActions.find((action) => normalizeSquare(action.payload) === square);
    if (payloadMatch) {
      return {
        nextSelection: { selectedSquare: from, selectedPayload: square },
        action: null, illegalSquare: null, consumed: true,
      };
    }
  }

  if (flingActions.length > 0 && normalized.selectedPayload) {
    const payloadMatch = flingActions.find((action) => normalizeSquare(action.payload) === square);
    if (payloadMatch) {
      return {
        nextSelection: { selectedSquare: from, selectedPayload: square },
        action: null, illegalSquare: null, consumed: true,
      };
    }

    const fling = flingActions.find(
      (action) => (
        normalizeSquare(action.payload) === normalized.selectedPayload
        && normalizeSquare(action.target) === square
      ),
    );
    if (fling) {
      return {
        nextSelection: { selectedSquare: null, selectedPayload: null },
        action: fling, illegalSquare: null, consumed: true,
      };
    }

    return { nextSelection: normalized, action: null, illegalSquare: square, consumed: true };
  }

  const shootActions = indexed.shootBySquare.get(from) || [];
  if (shootActions.length > 0 && !moveAttempt) {
    const shoot = resolveShootAction(shootActions, square);
    if (shoot) {
      return {
        nextSelection: { selectedSquare: null, selectedPayload: null },
        action: shoot, illegalSquare: null, consumed: true,
      };
    }
  }

  const move = (indexed.moveByFrom.get(from) || []).find((action) => action.to === square);
  if (move) {
    return {
      nextSelection: { selectedSquare: null, selectedPayload: null },
      action: move, illegalSquare: null, consumed: true,
    };
  }

  if (!moveAttempt && (hasAnyOrigin(indexed, square) || isOwnPieceOnSquare(boardMap, square, youColor))) {
    return {
      nextSelection: { selectedSquare: square, selectedPayload: null },
      action: null, illegalSquare: null, consumed: true,
    };
  }

  return { nextSelection: normalized, action: null, illegalSquare: square, consumed: true };
}
