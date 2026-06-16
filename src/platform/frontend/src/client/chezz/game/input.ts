import {
  buildLegalActionIndex,
  highlightForSelection,
  resolveClickOutcome,
  normalizeSquare,
  effectiveYouColor,
  raySquares,
} from "../features/gameplay/gameLogic.js";
import {
  animatorPrimitivesBusy,
  canRegisterPremove,
  canStartPieceDrag,
  dragSelectionForResolve,
  isInputAllowed,
  isOwnPiece,
  legalActionMatchesSaved,
  normalizeSelectionState,
  premoveActionsFromPayload,
  premoveFireContextReady,
  selectionIfOwnPieceOrigin,
  squaresForPremoveAction,
  toPremoveHintClass,
} from "../features/gameplay/inputDecisions.js";
import { clearOptimisticMoveSoundPair } from "./sound.js";
import type { ActionIndex, ActionRecord, Selection } from "../features/gameplay/gameLogic.js";
import type { GameOver, MoveAccepted } from "./contracts.js";
import type { ClientGameState } from "./store.js";

const PIECE_IMG_BASE = "/static/games/chezz/assets/pieces";

/** Squared distance threshold before a pointer gesture counts as a drag. */
const DRAG_THRESHOLD_SQ = 8 * 8;

const SQUARE_DECORATION_CLASSES = [
  "selected",
  "legal-target",
  "picked-up",
  "drag-source",
  "drag-hover",
  "drag-invalid-hover",
  "drag-lift-hidden",
  "cannon-ray",
  "cannon-ray-tl",
  "cannon-ray-tr",
  "cannon-ray-br",
  "cannon-ray-bl",
  "fling-payload",
  "fling-target-preview",
  "move-hint-to",
  "premove-selected",
  "premove-mark",
  "premove-drag-hover",
  "premove-drag-invalid-hover",
  "premove-hint-legal-target",
  "premove-hint-move-hint-to",
  "premove-hint-fling-payload",
  "premove-hint-fling-target-preview",
  "premove-hint-cannon-ray",
  "premove-hint-cannon-ray-tl",
  "premove-hint-cannon-ray-tr",
  "premove-hint-cannon-ray-br",
  "premove-hint-cannon-ray-bl",
];

type MoveActionKind = "move" | "shoot" | "fling";

interface ActionMeta {
  square?: string;
  direction?: string;
  catapult?: string;
  payload?: string;
  target?: string;
}

interface SubmitMoveArgs {
  gameId: string;
  fromSq: string;
  toSq: string;
  kind: MoveActionKind;
  meta: ActionMeta;
  legalCursor: string;
  clientMoveId: string;
  expectedSeq: number;
}

interface LegalPayload {
  legal_cursor?: string;
  actions?: unknown[];
  premove_actions?: unknown;
  premove_by_color?: unknown;
}

type InputClientState = ClientGameState
  & NonNullable<Parameters<typeof isInputAllowed>[0]>
  & NonNullable<Parameters<typeof effectiveYouColor>[0]>;

interface ChezzStore {
  getState(): InputClientState | null;
  dispatch?: (action: { type?: string; payload?: unknown }) => void;
  subscribe?: (listener: (state: InputClientState | null) => void) => () => void;
}

interface ChezzHttp {
  submitMove(args: SubmitMoveArgs): Promise<MoveAccepted | GameOver>;
}

interface ChezzRender {
  renderBoard(state: ClientGameState | null): void;
}

interface ChezzSound {
  play(id: string): void;
}

interface OptimisticMoveSpec {
  kind: MoveActionKind;
  from: string;
  to: string;
  catapult?: string;
  piece: string;
  captureSquare?: string | null;
  skipFly?: boolean;
}

interface ChezzAnimator {
  busy?: () => boolean;
  primitiveBusy?: () => boolean;
  enqueueOptimisticMove?: (spec: OptimisticMoveSpec) => void;
  cancelOptimistic?: () => void;
}

interface CreateInputDeps {
  store: ChezzStore;
  http: ChezzHttp;
  gameId: string;
  render: ChezzRender;
  sound: ChezzSound;
  animator: ChezzAnimator;
  onPlayerMoveAccepted?: (evt: MoveAccepted | GameOver) => void;
  notify?: (message: string, isError?: boolean) => void;
  onSelectionChange?: (info: { indexed: ActionIndex; selection: Selection }) => void;
  isExploreLocked?: (() => boolean) | null;
  onStale?: (() => Promise<void> | void) | null;
}

interface PressPending {
  sq: string;
  x: number;
  y: number;
  pointerId: number;
}

interface InputController {
  attach(targetEl: HTMLElement | null): void;
  detach(): void;
  setLegalActions(payload: LegalPayload | null): void;
  setGameId(id: string | number): void;
  consumeAndFirePremove(retryCount?: number): void;
}

function newClientMoveId(): string {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `move-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createInput({
  store,
  http,
  gameId,
  render,
  sound,
  animator,
  onPlayerMoveAccepted,
  notify = () => {},
  onSelectionChange,
  isExploreLocked = null,
  onStale = null,
}: CreateInputDeps): InputController {
  let activeGameId = String(gameId || "").trim();
  const exploreLocked = typeof isExploreLocked === "function" ? isExploreLocked : () => false;
  let boardEl: HTMLElement | null = null;
  let legalCursor = "";
  let indexedMain: ActionIndex = buildLegalActionIndex([]);
  /** Legal actions as if ``you_color`` were to move (opponent's clock); pre-move UI. */
  let indexedPremove: ActionIndex = buildLegalActionIndex([]);
  let selection: Selection = { selectedSquare: null, selectedPayload: null };

  let pressPending: PressPending | null = null;
  let dragCommitted = false;
  let activeFromSquare = "";
  let activePointerId: number | null = null;
  let pickPointerId: number | null = null;
  let ghostEl: HTMLImageElement | null = null;
  let lastHoverSquareForCursor = "";
  /** True when the active drag started during opponent-clock pre-move mode. */
  let activeDragIsPremove = false;

  /** Pre-move selection (parallel to ``selection``) while opponent is on the clock. */
  let premoveSel: Selection = { selectedSquare: null, selectedPayload: null };
  /** Committed pre-move action (move / shoot / fling) awaiting auto-submit. */
  let premoveAction: ActionRecord | null = null;
  /** True while a player move HTTP request is in flight (blocks further live moves, not pre-moves). */
  let moveSubmitPending = false;

  function lockMoveSubmit(): boolean {
    if (moveSubmitPending) return false;
    moveSubmitPending = true;
    boardEl?.classList.add("input-locked");
    return true;
  }

  function unlockMoveSubmit(): void {
    moveSubmitPending = false;
    boardEl?.classList.remove("input-locked");
  }

  function clearPremoveDecorDom(): void {
    if (!boardEl) return;
    for (const el of boardEl.querySelectorAll(".premove-from, .premove-to, .premove-mark")) {
      el.classList.remove("premove-from", "premove-to", "premove-mark");
    }
  }

  function paintPremoveDecorDom(): void {
    clearPremoveDecorDom();
    if (!boardEl) return;
    if (premoveAction) {
      for (const sq of squaresForPremoveAction(premoveAction)) {
        boardEl.querySelector(`[data-square="${sq}"]`)?.classList.add("premove-mark");
      }
      return;
    }
    const pay = normalizeSquare(premoveSel?.selectedPayload);
    if (pay) boardEl.querySelector(`[data-square="${pay}"]`)?.classList.add("premove-to");
  }

  function cancelPremove(): void {
    premoveSel = { selectedSquare: null, selectedPayload: null };
    premoveAction = null;
    clearPremoveDecorDom();
  }

  function releasePointerCaptureIfHeld(): void {
    if (activePointerId == null || !boardEl) return;
    try {
      if (typeof boardEl.hasPointerCapture === "function" && boardEl.hasPointerCapture(activePointerId)) {
        boardEl.releasePointerCapture(activePointerId);
      }
    } catch {
      /* noop */
    }
    activePointerId = null;
  }

  function removeGhost(): void {
    if (ghostEl) {
      try {
        ghostEl.remove();
      } catch {
        /* noop */
      }
      ghostEl = null;
    }
  }

  function showGhost(pieceCode: string, clientX: number, clientY: number, sourceSquare: string): void {
    removeGhost();
    const img = document.createElement("img");
    img.className = "piece-drag-ghost";
    img.draggable = false;
    img.alt = "";
    img.decoding = "async";
    img.src = `${PIECE_IMG_BASE}/${pieceCode}.png`;
    img.style.left = `${clientX}px`;
    img.style.top = `${clientY}px`;
    const sq = normalizeSquare(sourceSquare);
    const sourceImg = sq && boardEl?.querySelector(`[data-square="${sq}"] .piece-img`);
    if (sourceImg) {
      const r = sourceImg.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        img.style.width = `${r.width}px`;
        img.style.height = `${r.height}px`;
      }
    }
    document.body.appendChild(img);
    ghostEl = img;
  }

  function syncGhost(clientX: number, clientY: number): void {
    if (!ghostEl || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    ghostEl.style.left = `${clientX}px`;
    ghostEl.style.top = `${clientY}px`;
  }

  function resetBoardCursorUi(): void {
    if (!boardEl) return;
    boardEl.style.cursor = "";
    boardEl.classList.remove("is-dragging");
    lastHoverSquareForCursor = "";
  }

  function setLegalActions(payload: LegalPayload | null): void {
    if (payload == null) {
      selection = { selectedSquare: null, selectedPayload: null };
      legalCursor = "";
      indexedMain = buildLegalActionIndex([]);
      indexedPremove = buildLegalActionIndex([]);
      cancelPremove();
      paintSelectionDecorations();
      return;
    }
    const nextPk = String(payload.legal_cursor || "");
    if (nextPk !== legalCursor) {
      selection = { selectedSquare: null, selectedPayload: null };
      premoveSel = { selectedSquare: null, selectedPayload: null };
      // keep ``premoveAction``: it is validated on our turn against fresh
      // ``indexedMain`` (post-opponent snapshot). Clearing it here raced the
      // ``legal`` / ``stream_seq`` refresh and dropped valid pre-moves.
    }
    legalCursor = nextPk;
    const st = store.getState();
    indexedMain = buildLegalActionIndex(Array.isArray(payload.actions) ? payload.actions : []);
    indexedPremove = buildLegalActionIndex(premoveActionsFromPayload(payload, st));
    paintSelectionDecorations();
  }

  function clearDragHoverMarks(): void {
    if (!boardEl) return;
    boardEl.querySelectorAll(
      ".drag-hover, .drag-invalid-hover, .premove-drag-hover, .premove-drag-invalid-hover",
    ).forEach((el: Element) => {
      el.classList.remove("drag-hover", "drag-invalid-hover", "premove-drag-hover", "premove-drag-invalid-hover");
    });
  }

  function clearSquareDecorations(): void {
    if (!boardEl) return;
    clearDragHoverMarks();
    for (const cell of boardEl.querySelectorAll(".square")) {
      for (const c of [...cell.classList]) {
        if (
          SQUARE_DECORATION_CLASSES.includes(c)
          || c.startsWith("premove-hint-")
        ) {
          cell.classList.remove(c);
        }
      }
    }
  }

  function paintSelectionDecorations(): void {
    if (!boardEl) return;
    clearSquareDecorations();
    const st = store.getState();
    const usePremoveHints = Boolean(st && (canRegisterPremove(st) || premoveAction));
    const ix = usePremoveHints ? indexedPremove : indexedMain;
    const sel = usePremoveHints ? premoveSel : selection;
    // Live turn: FROM square + cannon lanes / catapult payloads only (no slide destinations).
    const merged = usePremoveHints
      ? { ...highlightForSelection(ix, sel) }
      : { ...highlightForSelection(ix, sel, { moveDestinations: false }) };
    const bm = (st && st.board && st.board.board) || {};
    const fromSel = normalizeSquare(sel.selectedSquare);
    if (fromSel && isOwnPiece(bm, st, fromSel)) {
      const fromCell = boardEl.querySelector(`[data-square="${fromSel}"]`);
      if (fromCell) fromCell.classList.add(usePremoveHints ? "premove-selected" : "selected");
    }
    for (const [sq, classes] of Object.entries(merged)) {
      const cell = boardEl.querySelector(`[data-square="${sq}"]`);
      if (!cell) continue;
      for (const cls of classes) {
        cell.classList.add(usePremoveHints ? toPremoveHintClass(cls) : cls);
      }
    }
    paintPremoveDecorDom();
    if (typeof onSelectionChange === "function") {
      try {
        onSelectionChange({ indexed: ix, selection: { ...sel } });
      } catch {
        /* noop */
      }
    }
  }

  function squareFromClient(clientX: number, clientY: number): string {
    if (!boardEl || typeof document === "undefined") return "";
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return "";
    const stack = document.elementsFromPoint(clientX, clientY);
    if (!stack || !stack.length) return "";
    for (const el of stack) {
      if (el === ghostEl) continue;
      if (typeof el.closest !== "function") continue;
      const cell = el.closest<HTMLElement>("[data-square]");
      if (cell && boardEl.contains(cell)) {
        return String(cell.dataset.square || "").toLowerCase();
      }
    }
    return "";
  }

  function squareFromEvent(event: PointerEvent): string {
    const target = event.target;
    if (!target) return "";
    const targetEl = target as { closest?: (selector: string) => HTMLElement | null };
    const cell = typeof targetEl.closest === "function" ? targetEl.closest("[data-square]") : null;
    if (cell && boardEl && boardEl.contains(cell)) {
      return String(cell.dataset.square || "").toLowerCase();
    }
    return "";
  }

  function squareFromPointerEvent(event: PointerEvent): string {
    const direct = squareFromEvent(event);
    if (direct) return direct;
    return squareFromClient(event.clientX, event.clientY);
  }

  function updateDragHoverMarks(fromSquare: string, clientX: number, clientY: number): void {
    clearDragHoverMarks();
    const sq = squareFromClient(clientX, clientY);
    if (!sq) return;
    const cell = boardEl?.querySelector(`[data-square="${sq}"]`);
    if (!cell) return;
    if (sq === fromSquare) return;
    cell.classList.add(activeDragIsPremove ? "premove-drag-hover" : "drag-hover");
  }

  function updateHoverGrabCursor(clientX: number, clientY: number): void {
    if (!boardEl) return;
    const st = store.getState();
    const inputOk = isInputAllowed(st, animator, legalCursor, exploreLocked, moveSubmitPending);
    const premoveHover = Boolean(st && canRegisterPremove(st) && !inputOk);
    if ((!inputOk && !premoveHover) || pressPending || dragCommitted) {
      boardEl.style.cursor = "";
      lastHoverSquareForCursor = "";
      return;
    }
    if (!st) return;
    const sq = squareFromClient(clientX, clientY);
    if (sq === lastHoverSquareForCursor) return;
    lastHoverSquareForCursor = sq;
    if (!sq) {
      boardEl.style.cursor = "";
      return;
    }
    const bm = (st.board && st.board.board) || {};
    const ix = premoveHover ? indexedPremove : indexedMain;
    if (canStartPieceDrag(ix, bm, st, sq)) {
      boardEl.style.cursor = "grab";
    } else {
      boardEl.style.cursor = "";
    }
  }

  async function trySubmit(action: ActionRecord, opts: { instantDrop?: boolean } = {}): Promise<void> {
    if (!lockMoveSubmit()) return;
    const instantDrop = opts.instantDrop === true;
    const state = store.getState();
    if (!state) {
      unlockMoveSubmit();
      return;
    }
    if (!String(legalCursor || "").trim()) {
      unlockMoveSubmit();
      return;
    }
    selection = { selectedSquare: null, selectedPayload: null };
    paintSelectionDecorations();
    const expectedSeq = Number.isFinite(state.stream_seq) ? state.stream_seq : -1;
    const clientMoveId = newClientMoveId();
    const kind = String(action?.kind || "move").toLowerCase() as MoveActionKind;
    let fromSq = "";
    let toSq = "";
    const meta: ActionMeta = {};
    if (kind === "shoot") {
      fromSq = normalizeSquare(action.square);
      toSq = fromSq;
      meta.square = String(action.square || "");
      meta.direction = String(action.direction || "");
    } else if (kind === "fling") {
      fromSq = normalizeSquare(action.catapult);
      toSq = normalizeSquare(action.target);
      meta.catapult = String(action.catapult || "");
      meta.payload = String(action.payload || "");
      meta.target = String(action.target || "");
    } else {
      fromSq = normalizeSquare(action.from);
      toSq = normalizeSquare(action.to);
    }

    const bm = (state.board && state.board.board) || {};
    if (kind === "move" && fromSq && toSq) {
      const piece = bm[fromSq];
      if (piece && typeof animator?.enqueueOptimisticMove === "function") {
        const tgt = bm[toSq];
        const captureSquare = tgt && piece[0] !== tgt[0] ? toSq : null;
        animator.enqueueOptimisticMove({
          kind: "move",
          from: fromSq,
          to: toSq,
          piece,
          captureSquare,
          skipFly: instantDrop,
        });
      }
    } else if (kind === "fling" && toSq) {
      const payloadSq = normalizeSquare(action.payload);
      const piece = payloadSq ? bm[payloadSq] : "";
      if (payloadSq && piece && typeof animator?.enqueueOptimisticMove === "function") {
        const tgt = bm[toSq];
        const captureSquare = tgt && piece[0] !== tgt[0] ? toSq : null;
        animator.enqueueOptimisticMove({
          kind: "fling",
          from: payloadSq,
          to: toSq,
          catapult: fromSq,
          piece,
          captureSquare,
        });
      }
    }

    if (kind === "fling") {
      // prime the fling sound system and play immediately in user-gesture context.
      // animation will skip its fling sound to avoid double-play.
      import("./sound.js").then((soundMod) => soundMod.primeFlingSound());
      sound.play("fling");
    }

    let moveAccepted = false;
    try {
      const body = await http.submitMove({
        gameId: activeGameId,
        fromSq,
        toSq,
        kind,
        meta,
        legalCursor,
        clientMoveId,
        expectedSeq,
      });
      if (typeof onPlayerMoveAccepted === "function" && body && String(body.type || "") === "move_accepted") {
        moveAccepted = true;
        onPlayerMoveAccepted(body);
      }
    } catch (err: unknown) {
      if (typeof animator?.cancelOptimistic === "function") {
        animator.cancelOptimistic();
      }
      const errorLike = err as { message?: unknown; status?: unknown };
      const msg = String(errorLike?.message || "Move rejected.");
      const stale = errorLike?.status === 409 && /stale/i.test(msg);
      if (stale && typeof onStale === "function") {
        try {
          await onStale();
        } catch {
          /* ignore resync failure */
        }
      }
      sound.play("illegal");
      notify(msg, true);
      clearOptimisticMoveSoundPair();
      render.renderBoard(store.getState());
    } finally {
      unlockMoveSubmit();
    }
  }

  function endDragVisuals(): void {
    activeDragIsPremove = false;
    removeGhost();
    clearDragHoverMarks();
    if (boardEl) {
      boardEl.querySelectorAll(".square.drag-source").forEach((el: Element) => el.classList.remove("drag-source"));
    }
    resetBoardCursorUi();
  }

  function clearLiftHidden(liftSquare: string): void {
    const sq = normalizeSquare(liftSquare);
    if (!boardEl || !sq) return;
    const cell = boardEl.querySelector(`[data-square="${sq}"]`);
    cell?.classList.remove("drag-lift-hidden");
    cell?.classList.remove("drag-source");
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!boardEl) return;
    if (pressPending && pressPending.pointerId === event.pointerId && !dragCommitted) {
      const dx = event.clientX - pressPending.x;
      const dy = event.clientY - pressPending.y;
      if (dx * dx + dy * dy > DRAG_THRESHOLD_SQ) {
        const st = store.getState();
        const inputOk = isInputAllowed(st, animator, legalCursor, exploreLocked, moveSubmitPending);
        const premoveOk = Boolean(st && canRegisterPremove(st) && !inputOk);
        if (!st || (!inputOk && !premoveOk)) return;
        const downSq = pressPending.sq;
        const bm = (st.board && st.board.board) || {};
        const piece = bm[downSq];
        const ix = premoveOk ? indexedPremove : indexedMain;
        if (piece && canStartPieceDrag(ix, bm, st, downSq)) {
          activeDragIsPremove = premoveOk;
          dragCommitted = true;
          activeFromSquare = downSq;
          pickPointerId = event.pointerId;
          showGhost(piece, event.clientX, event.clientY, downSq);
          const cell = boardEl.querySelector(`[data-square="${downSq}"]`);
          cell?.classList.add("drag-lift-hidden", "drag-source");
          boardEl.classList.add("is-dragging");
          boardEl.style.cursor = "grabbing";
          try {
            if (typeof boardEl.setPointerCapture === "function" && Number.isFinite(event.pointerId)) {
              boardEl.setPointerCapture(event.pointerId);
              activePointerId = event.pointerId;
            }
          } catch {
            activePointerId = null;
          }
        }
      }
    }
    if (dragCommitted && pickPointerId != null && event.pointerId === pickPointerId) {
      syncGhost(event.clientX, event.clientY);
      updateDragHoverMarks(activeFromSquare, event.clientX, event.clientY);
      return;
    }
    updateHoverGrabCursor(event.clientX, event.clientY);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const state = store.getState();
    const myTurn = isInputAllowed(state, animator, legalCursor, exploreLocked, moveSubmitPending);
    const premoveMode = !myTurn && canRegisterPremove(state);
    if (!myTurn && !premoveMode) return;
    event.preventDefault();
    const square = squareFromPointerEvent(event);
    if (!square) return;
    pressPending = {
      sq: square,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    dragCommitted = false;
  }

  function handlePointerUp(event: PointerEvent): void {
    if (event.button !== 0) return;
    const state = store.getState();
    const bm = (state && state.board && state.board.board) || {};

    if (dragCommitted) {
      if (pickPointerId != null && event.pointerId !== pickPointerId) return;
      const from = activeFromSquare;
      const liftSq = from;
      const toSquare = squareFromPointerEvent(event);
      releasePointerCaptureIfHeld();
      pickPointerId = null;
      activeFromSquare = "";
      pressPending = null;
      dragCommitted = false;

      if (!state || !from) {
        endDragVisuals();
        clearLiftHidden(liftSq);
        return;
      }
      const inputOk = isInputAllowed(state, animator, legalCursor, exploreLocked, moveSubmitPending);
      const premoveOk = Boolean(canRegisterPremove(state) && !inputOk);

      if (premoveOk) {
        endDragVisuals();
        clearLiftHidden(liftSq);
        const ix = indexedPremove;
        const you = effectiveYouColor(state);
        const dragSel = dragSelectionForResolve(ix, premoveSel, from);
        const dragOutcome = resolveClickOutcome(ix, bm, dragSel, toSquare || from, you, { moveAttempt: true });
        const action = dragOutcome.action;
        if (dragOutcome.illegalSquare) {
          endDragVisuals();
          clearLiftHidden(liftSq);
          sound.play("illegal");
          premoveSel = normalizeSelectionState(ix, bm, state, dragOutcome.nextSelection);
          paintSelectionDecorations();
          return;
        }
        if (!action && dragOutcome.consumed) {
          premoveSel = normalizeSelectionState(ix, bm, state, dragOutcome.nextSelection);
          paintSelectionDecorations();
          return;
        }
        if (!action) {
          endDragVisuals();
          clearLiftHidden(liftSq);
          if (toSquare && normalizeSquare(toSquare) !== normalizeSquare(from)) {
            sound.play("illegal");
          }
          return;
        }
        premoveAction = action;
        premoveSel = { selectedSquare: null, selectedPayload: null };
        paintSelectionDecorations();
        return;
      }

      if (!inputOk) {
        endDragVisuals();
        clearLiftHidden(liftSq);
        sound.play("illegal");
        return;
      }
      const dragSel = dragSelectionForResolve(indexedMain, selection, from);
      const you = effectiveYouColor(state);
      const dragOutcome = resolveClickOutcome(indexedMain, bm, dragSel, toSquare || from, you, { moveAttempt: true });
      const action = dragOutcome.action;
      if (dragOutcome.illegalSquare) {
        endDragVisuals();
        clearLiftHidden(liftSq);
        sound.play("illegal");
        selection = normalizeSelectionState(indexedMain, bm, state, dragOutcome.nextSelection);
        paintSelectionDecorations();
        return;
      }
      if (!action && dragOutcome.consumed) {
        endDragVisuals();
        clearLiftHidden(liftSq);
        selection = normalizeSelectionState(indexedMain, bm, state, dragOutcome.nextSelection);
        paintSelectionDecorations();
        return;
      }
      if (!action) {
        endDragVisuals();
        clearLiftHidden(liftSq);
        if (toSquare && normalizeSquare(toSquare) !== normalizeSquare(from)) {
          sound.play("illegal");
        }
        return;
      }
      if (moveSubmitPending) {
        endDragVisuals();
        clearLiftHidden(liftSq);
        return;
      }
      selection = { selectedSquare: null, selectedPayload: null };
      removeGhost();
      if (boardEl) {
        boardEl.classList.remove("is-dragging");
        boardEl.style.cursor = "";
      boardEl.querySelectorAll(".square.drag-source").forEach((el: Element) => el.classList.remove("drag-source"));
      }
      lastHoverSquareForCursor = "";
      void trySubmit(action, { instantDrop: true });
      clearDragHoverMarks();
      return;
    }

    if (!pressPending || pressPending.pointerId !== event.pointerId) {
      releasePointerCaptureIfHeld();
      pressPending = null;
      return;
    }

    const downSq = pressPending.sq;
    const upSq = squareFromPointerEvent(event) || downSq;
    const dx = event.clientX - pressPending.x;
    const dy = event.clientY - pressPending.y;
    const smallMove = dx * dx + dy * dy <= DRAG_THRESHOLD_SQ;
    pressPending = null;

    if (!state) return;

    // Premove tap path
    if (!isInputAllowed(state, animator, legalCursor, exploreLocked, moveSubmitPending)) {
      if (!canRegisterPremove(state)) {
        return;
      }
      const you = effectiveYouColor(state);
      const sqUp = normalizeSquare(upSq);
      const pieceAtUp = sqUp ? bm[sqUp] : null;
      const isOwnPiece = Boolean(pieceAtUp) && String(String(pieceAtUp || "")[0] || "").toLowerCase() === you;

      if (premoveAction) {
        if (isOwnPiece) {
          premoveAction = null;
          premoveSel = { selectedSquare: sqUp || upSq, selectedPayload: null };
          paintSelectionDecorations();
          return;
        }
        cancelPremove();
        paintSelectionDecorations();
        return;
      }

      const ixP = indexedPremove;
      let outcome: ReturnType<typeof resolveClickOutcome>;
      if (downSq === upSq) {
        outcome = resolveClickOutcome(ixP, bm, premoveSel, upSq, you);
      } else if (smallMove) {
        const sel = premoveSel.selectedSquare
          ? premoveSel
          : selectionIfOwnPieceOrigin(ixP, bm, state, downSq, premoveSel);
        outcome = resolveClickOutcome(ixP, bm, sel, upSq, you, { moveAttempt: true });
      } else {
        const sel =
          premoveSel.selectedSquare && premoveSel.selectedSquare !== normalizeSquare(downSq)
            ? premoveSel
            : selectionIfOwnPieceOrigin(ixP, bm, state, downSq, premoveSel);
        outcome = resolveClickOutcome(ixP, bm, sel, upSq, you, { moveAttempt: true });
      }

      if (!outcome.consumed && !isOwnPiece) {
        cancelPremove();
        paintSelectionDecorations();
        return;
      }

      if (outcome.illegalSquare) {
        sound.play("illegal");
      }
      if (outcome.consumed) {
        premoveSel = normalizeSelectionState(ixP, bm, state, outcome.nextSelection);
        if (outcome.action) {
          premoveAction = outcome.action;
          premoveSel = { selectedSquare: null, selectedPayload: null };
        }
        paintSelectionDecorations();
      }
      return;
    }

    // Live tap path (our turn)
    // clear any stale pre-move when the player acts on their turn.
    cancelPremove();

    let outcome: ReturnType<typeof resolveClickOutcome>;
    const you = effectiveYouColor(state);
    if (downSq === upSq) {
      outcome = resolveClickOutcome(indexedMain, bm, selection, upSq, you);
    } else if (smallMove) {
      const sel = selection.selectedSquare
        ? selection
        : selectionIfOwnPieceOrigin(indexedMain, bm, state, downSq, selection);
      outcome = resolveClickOutcome(indexedMain, bm, sel, upSq, you, { moveAttempt: true });
    } else {
      const sel =
        selection.selectedSquare && selection.selectedSquare !== normalizeSquare(downSq)
          ? selection
          : selectionIfOwnPieceOrigin(indexedMain, bm, state, downSq, selection);
      outcome = resolveClickOutcome(indexedMain, bm, sel, upSq, you, { moveAttempt: true });
    }

    if (outcome.illegalSquare) {
      sound.play("illegal");
    }
    if (outcome.action) {
      if (!moveSubmitPending) {
        void trySubmit(outcome.action);
      }
      return;
    }
    if (outcome.consumed) {
      selection = normalizeSelectionState(indexedMain, bm, state, outcome.nextSelection);
      paintSelectionDecorations();
    }
    // empty-board tap with no selection: ignore (chess.com does not flash "illegal").
    // true illegal attempts set `illegalSquare` while a piece is selected.
  }

  function handlePointerLeave(): void {
    if (!pressPending && !dragCommitted) {
      resetBoardCursorUi();
    }
  }

  function handlePointerCancel(): void {
    const liftSq = activeFromSquare;
    releasePointerCaptureIfHeld();
    pickPointerId = null;
    activeFromSquare = "";
    pressPending = null;
    dragCommitted = false;
    clearLiftHidden(liftSq);
    endDragVisuals();
    paintSelectionDecorations();
  }

  function attach(targetEl: HTMLElement | null): void {
    boardEl = targetEl;
    if (!boardEl) return;
    boardEl.addEventListener("pointerdown", handlePointerDown);
    boardEl.addEventListener("pointermove", handlePointerMove);
    boardEl.addEventListener("pointerup", handlePointerUp);
    boardEl.addEventListener("pointercancel", handlePointerCancel);
    boardEl.addEventListener("pointerleave", handlePointerLeave);
    paintSelectionDecorations();
  }

  function detach(): void {
    unsubscribePremoveDrain?.();
    unsubscribePremoveDrain = null;
    if (!boardEl) return;
    const liftSq = activeFromSquare;
    releasePointerCaptureIfHeld();
    pickPointerId = null;
    activeFromSquare = "";
    pressPending = null;
    dragCommitted = false;
    moveSubmitPending = false;
    clearLiftHidden(liftSq);
    endDragVisuals();
    clearSquareDecorations();
    cancelPremove();
    boardEl.removeEventListener("pointerdown", handlePointerDown);
    boardEl.removeEventListener("pointermove", handlePointerMove);
    boardEl.removeEventListener("pointerup", handlePointerUp);
    boardEl.removeEventListener("pointercancel", handlePointerCancel);
    boardEl.removeEventListener("pointerleave", handlePointerLeave);
    boardEl = null;
  }

  function consumeAndFirePremove(retryCount = 0): void {
    if (!premoveAction) return;
    const state = store.getState();
    if (!state || state.status !== "active") { cancelPremove(); return; }

    if (!premoveFireContextReady(state, legalCursor)) return;

    if (animatorPrimitivesBusy(animator)) {
      if (retryCount < 48) {
        queueMicrotask(() => consumeAndFirePremove(retryCount + 1));
      }
      return;
    }

    const saved = premoveAction;
    premoveAction = null;
    clearPremoveDecorDom();

    const currentBm = (state.board && state.board.board) || {};
    const you = effectiveYouColor(state);
    const matched = indexedMain.all.find((a) => legalActionMatchesSaved(saved, a));
    if (matched) {
      void trySubmit(matched);
      return;
    }

    const kind = String(saved?.kind || "move").toLowerCase();
    let outcome: ReturnType<typeof resolveClickOutcome>;
    if (kind === "shoot") {
      const sq = normalizeSquare(saved.square);
      const dir = String(saved.direction || "").toLowerCase();
      const ray = sq ? raySquares(sq, dir) : [];
      const clickSq = ray[0] || sq;
      outcome = resolveClickOutcome(
        indexedMain,
        currentBm,
        { selectedSquare: String(saved.square || ""), selectedPayload: null },
        clickSq,
        you,
        { moveAttempt: true },
      );
    } else if (kind === "fling") {
      outcome = resolveClickOutcome(
        indexedMain,
        currentBm,
        { selectedSquare: String(saved.catapult || ""), selectedPayload: String(saved.payload || "") },
        String(saved.target || ""),
        you,
        { moveAttempt: true },
      );
    } else {
      outcome = resolveClickOutcome(
        indexedMain,
        currentBm,
        { selectedSquare: String(saved.from || ""), selectedPayload: null },
        String(saved.to || ""),
        you,
        { moveAttempt: true },
      );
    }
    if (!outcome.action) {
      paintSelectionDecorations();
      return;
    }
    void trySubmit(outcome.action);
  }

  function setGameId(id: string | number): void {
    activeGameId = String(id || "").trim();
    legalCursor = "";
    indexedMain = buildLegalActionIndex([]);
    indexedPremove = buildLegalActionIndex([]);
    selection = { selectedSquare: null, selectedPayload: null };
  }

  let previousAnimationPending = Boolean(store.getState()?.animationPending);
  let unsubscribePremoveDrain: (() => void) | null = typeof store.subscribe === "function"
    ? store.subscribe((state) => {
      const animationPending = Boolean(state?.animationPending);
      if (previousAnimationPending && !animationPending) {
        queueMicrotask(() => consumeAndFirePremove());
      }
      previousAnimationPending = animationPending;
    })
    : null;

  return { attach, detach, setLegalActions, setGameId, consumeAndFirePremove };
}
