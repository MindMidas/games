import { effectiveYouColor, normalizeSquare } from "./gameLogic.js";
import type { ActionIndex, ActionRecord, Selection } from "./gameLogic.js";

interface InputState {
  status?: string;
  animationPending?: boolean;
  current_turn?: unknown;
  you_color?: string | null;
  you_seat?: string | null;
  self_user_id?: string | null;
  players?: {
    w?: { user_id?: string | null };
    b?: { user_id?: string | null };
  };
  [key: string]: unknown;
}

interface InputAnimator {
  busy?: () => boolean;
  primitiveBusy?: () => boolean;
}

interface LegalPayload {
  premove_actions?: unknown;
  premove_by_color?: unknown;
}

function asActionRecord(value: unknown): ActionRecord | null {
  return value !== null && typeof value === "object"
    ? value as ActionRecord
    : null;
}

function turnColor(state: InputState): "w" | "b" | "" {
  const turn = String(state.current_turn || "").toLowerCase();
  return turn === "w" || turn === "b" ? turn : "";
}

/** Return whether a live move may resolve for the hydrated player. */
export function isInputAllowed(
  state: InputState | null | undefined,
  animator: InputAnimator | null | undefined,
  legalCursor: string,
  exploreLocked: (() => boolean) | null | undefined,
  moveSubmitPending: boolean,
): boolean {
  if (!state || moveSubmitPending || state.status !== "active" || state.animationPending) return false;
  if (exploreLocked?.()) return false;
  if (!legalCursor.trim()) return false;
  if (animator?.busy?.()) return false;
  const turn = turnColor(state);
  return Boolean(turn && effectiveYouColor(state) === turn);
}

/** Return whether a square contains a piece controlled by the hydrated player. */
export function isOwnPiece(
  board: Record<string, string>,
  state: InputState | null | undefined,
  square: string,
): boolean {
  const normalized = normalizeSquare(square);
  if (!normalized) return false;
  const piece = board[normalized];
  return Boolean(piece && piece[0]?.toLowerCase() === effectiveYouColor(state));
}

/** Return whether a player-owned piece may begin a drag gesture. */
export function canStartPieceDrag(
  _indexed: ActionIndex,
  board: Record<string, string>,
  state: InputState | null | undefined,
  square: string,
): boolean {
  return isOwnPiece(board, state, square);
}

/** Select an owned piece while preserving a staged catapult payload. */
export function selectionIfOwnPieceOrigin(
  _indexed: ActionIndex,
  board: Record<string, string>,
  state: InputState | null | undefined,
  square: string,
  fallback: Selection,
): Selection {
  const normalized = normalizeSquare(square);
  if (!normalized || !isOwnPiece(board, state, normalized)) return fallback;
  return { selectedSquare: normalized, selectedPayload: fallback.selectedPayload };
}

/** Remove selections that no longer identify an owned piece. */
export function normalizeSelectionState(
  _indexed: ActionIndex,
  board: Record<string, string>,
  state: InputState | null | undefined,
  selection: Selection,
): Selection {
  const selectedSquare = normalizeSquare(selection.selectedSquare);
  if (!selectedSquare || !isOwnPiece(board, state, selectedSquare)) {
    return { selectedSquare: null, selectedPayload: null };
  }
  return {
    selectedSquare,
    selectedPayload: normalizeSquare(selection.selectedPayload) || null,
  };
}

/** Return whether the player may queue a move while the opponent is on clock. */
export function canRegisterPremove(state: InputState | null | undefined): boolean {
  if (!state || state.status !== "active") return false;
  const turn = turnColor(state);
  return Boolean(turn && effectiveYouColor(state) !== turn);
}

/** Return whether a queued premove may be matched against the current legal rows. */
export function premoveFireContextReady(
  state: InputState | null | undefined,
  legalCursor: string,
): boolean {
  if (!state || state.status !== "active" || state.animationPending || !legalCursor.trim()) return false;
  const turn = turnColor(state);
  return Boolean(turn && effectiveYouColor(state) === turn);
}

/** Return whether a move primitive is still animating. */
export function animatorPrimitivesBusy(animator: InputAnimator | null | undefined): boolean {
  return Boolean(animator?.primitiveBusy?.());
}

/** Convert a normal board highlight into its premove presentation class. */
export function toPremoveHintClass(className: string): string {
  return className === "selected" ? "premove-selected" : `premove-hint-${className}`;
}

/** Read the hydrated player's premove rows from the legal payload. */
export function premoveActionsFromPayload(
  payload: LegalPayload | null | undefined,
  state: InputState | null | undefined,
): ActionRecord[] {
  if (Array.isArray(payload?.premove_actions)) {
    return payload.premove_actions.map(asActionRecord).filter((action): action is ActionRecord => action !== null);
  }
  const byColor = asActionRecord(payload?.premove_by_color);
  const color = effectiveYouColor(state);
  const actions = byColor?.[color];
  return Array.isArray(actions)
    ? actions.map(asActionRecord).filter((action): action is ActionRecord => action !== null)
    : [];
}

/** Return the squares tagged when a premove is queued. */
export function squaresForPremoveAction(actionValue: unknown): string[] {
  const action = asActionRecord(actionValue);
  if (!action) return [];
  const kind = String(action.kind || "move").toLowerCase();
  if (kind === "shoot") {
    const square = normalizeSquare(action.square);
    return square ? [square] : [];
  }
  if (kind === "fling") {
    return [action.catapult, action.payload, action.target]
      .map(normalizeSquare)
      .filter(Boolean);
  }
  return [action.from, action.to].map(normalizeSquare).filter(Boolean);
}

/** Resolve drag selection, including picking up a staged catapult payload. */
export function dragSelectionForResolve(
  indexed: ActionIndex,
  selection: Selection,
  fromSquare: string,
): Selection {
  const from = normalizeSquare(fromSquare);
  const selectedSquare = normalizeSquare(selection.selectedSquare);
  const selectedPayload = normalizeSquare(selection.selectedPayload);
  if (selectedSquare && selectedPayload) {
    return { selectedSquare, selectedPayload };
  }
  if (selectedSquare) {
    const flings = indexed.flingByCatapult.get(selectedSquare) || [];
    if (flings.some((action) => normalizeSquare(action.payload) === from)) {
      return { selectedSquare, selectedPayload: from };
    }
  }
  return { selectedSquare: from || null, selectedPayload: null };
}

/** Match a queued premove against a fresh legal action row. */
export function legalActionMatchesSaved(savedValue: unknown, candidateValue: unknown): boolean {
  const saved = asActionRecord(savedValue);
  const candidate = asActionRecord(candidateValue);
  if (!saved || !candidate) return false;
  const kind = String(saved.kind || "move").toLowerCase();
  if (kind !== String(candidate.kind || "move").toLowerCase()) return false;
  if (kind === "shoot") {
    return normalizeSquare(saved.square) === normalizeSquare(candidate.square)
      && String(saved.direction || "").toLowerCase() === String(candidate.direction || "").toLowerCase();
  }
  if (kind === "fling") {
    return normalizeSquare(saved.catapult) === normalizeSquare(candidate.catapult)
      && normalizeSquare(saved.payload) === normalizeSquare(candidate.payload)
      && normalizeSquare(saved.target) === normalizeSquare(candidate.target);
  }
  return normalizeSquare(saved.from) === normalizeSquare(candidate.from)
    && normalizeSquare(saved.to) === normalizeSquare(candidate.to);
}
