import { ACTION, other } from "./contracts.js";
import { effectiveYouColor, raySquares } from "../features/gameplay/gameLogic.js";
import { moveTweenDuration, flingArcDuration } from "../features/gameplay/moveTiming.js";
import type { AnimationEvent } from "./contracts.js";

const EVT_ACTION = 0;
const EVT_CAPTURE = 1;
const EVT_MOVE = 2;
const EVT_PROMOTION = 3;
const EVT_CONTAGION = 4;

type BoardMap = Record<string, string>;
type Color = "w" | "b";
type MoveKind = "move" | "fling";

interface AnimationState {
  current_turn?: string | null;
  you_color?: string | null;
  you_seat?: string | null;
  self_user_id?: string | null;
  players?: {
    w?: { user_id?: string | null };
    b?: { user_id?: string | null };
  };
  [key: string]: unknown;
}

interface ChezzStore {
  getState(): AnimationState | null;
  dispatch(action: { type?: string; payload?: unknown }): void;
}

interface ChezzRender {
  getBoardElement?: () => HTMLElement | null;
  getBoardMap?: () => BoardMap;
  renderBoard?: (state: AnimationState | null) => void;
  setLastMoveHighlight?: (from: string, to: string, payload: string | null) => void;
}

interface GameAnimations {
  animateCannonShot(
    boardElement: HTMLElement,
    shot: {
      from: string;
      direction: string;
      color: string;
      hitSquares: string[];
      pathSquares: string[];
      terminalSquare: string | null;
    },
    snapshot: BoardMap,
  ): Promise<void>;
  animateCatapultFlings(
    boardElement: HTMLElement,
    moves: Array<{
      from: string;
      to: string;
      piece: string;
      captureSquare?: string | null;
      fast?: boolean;
    }>,
  ): Promise<void>;
  animateMoves(
    boardElement: HTMLElement,
    moves: Array<{
      from: string;
      to: string;
      piece: string;
      captureSquare?: string | null;
      fast?: boolean;
      skipFly?: boolean;
    }>,
  ): Promise<void>;
  animatePromotions(boardElement: HTMLElement, promotions: Array<{ square: string; color: string; to: string }>): Promise<void>;
  animateZombieConversions(boardElement: HTMLElement, conversions: Array<{ square: string; color: string }>): Promise<void>;
  snapPieceMove?: (
    boardElement: HTMLElement,
    move: { from: string; to: string; piece: string; captureSquare?: string | null },
  ) => void;
}

interface OptimisticMoveSpec {
  kind?: string;
  from: string;
  to: string;
  catapult?: string;
  piece: string;
  captureSquare?: string | null;
  skipFly?: boolean;
}

interface OptimisticPending {
  kind: MoveKind;
  from: string;
  to: string;
  piece: string;
  capture: boolean;
}

interface OptimisticSkip {
  kind: MoveKind;
  from: string;
  to: string;
}

interface PendingLastMove {
  from: string;
  to: string;
  payload: string | null;
}

interface QueueItem {
  kind: "live" | "replay";
  animation_events: AnimationEvent[];
  nextState: AnimationState | null;
  optimistic?: boolean;
  fast?: boolean;
  skipFly?: boolean;
  onComplete?: () => void;
}

interface PrimitiveOptions {
  replayMode?: boolean;
  fast?: boolean;
  skipFly?: boolean;
  optimisticSkip?: OptimisticSkip | null;
  consumeOptimisticSkip?: () => void;
}

interface AnimatorDeps {
  store: ChezzStore;
  gameAnimations: GameAnimations;
  render: ChezzRender;
  onDrainIdle?: () => void;
}

interface ReplayOptions {
  animation_events?: AnimationEvent[];
  nextState?: AnimationState | null;
  onComplete?: () => void;
  fast?: boolean;
}

export interface ChezzAnimator {
  enqueue(movePayload: { animation_events?: AnimationEvent[]; next_state?: AnimationState | null } | null | undefined): void;
  enqueueOptimisticMove(spec: OptimisticMoveSpec): void;
  enqueueReplay(opts?: ReplayOptions): void;
  cancel(): void;
  cancelOptimistic(): void;
  busy(): boolean;
  primitiveBusy(): boolean;
  drain(): Promise<void>;
  whenIdle(): Promise<void>;
}

function asColor(value: string): Color | "" {
  return value === "w" || value === "b" ? value : "";
}

function pieceColor(code: unknown): string {
  const c = String(code || "").trim();
  if (!c) return "";
  return c[0] === "w" || c[0] === "b" ? c[0] : "";
}

function isShootAction(event: AnimationEvent | null | undefined): boolean {
  if (!event || event.type !== EVT_ACTION) return false;
  const action = String(event.action || "").toLowerCase();
  if (action.includes("shot") || action.includes("shoot")) return true;
  return Boolean(event.direction && event.square);
}

function isFlingAction(event: AnimationEvent | null | undefined): boolean {
  if (!event || event.type !== EVT_ACTION) return false;
  return String(event.action || "").toLowerCase().includes("fling");
}

function cannonRayAndHits(boardMap: BoardMap, fromSquare: string, direction: string): { ray: string[]; hits: string[] } {
  const ray = raySquares(fromSquare, direction);
  const hits: string[] = [];
  for (const sq of ray) {
    if (boardMap[sq]) hits.push(sq);
  }
  return { ray, hits };
}

function matchesOptimisticSkip(
  kind: MoveKind,
  from: string,
  to: string,
  optimisticSkip: OptimisticSkip | null | undefined,
): boolean {
  if (!optimisticSkip) return false;
  const f = String(from || "").toLowerCase().trim();
  const t = String(to || "").toLowerCase().trim();
  return (
    optimisticSkip.kind === kind
    && optimisticSkip.from === f
    && optimisticSkip.to === t
  );
}


async function playPrimitive(
  event: AnimationEvent,
  gameAnimations: GameAnimations,
  render: ChezzRender,
  nextState: AnimationState | null,
  store: ChezzStore,
  opts: PrimitiveOptions = {},
): Promise<void> {
  const replayMode = Boolean(opts.replayMode);
  const fastDefault = Boolean(opts.fast);
  const skipFly = Boolean(opts.skipFly);
  const optimisticSkip = opts.optimisticSkip || null;
  const consumeOptimisticSkip = typeof opts.consumeOptimisticSkip === "function"
    ? opts.consumeOptimisticSkip
    : () => {};
  if (!event || typeof event !== "object") return;
  const boardEl = render.getBoardElement ? render.getBoardElement() : null;
  if (!boardEl) return;
  const type = Number(event.type);

  // cannon shoot ray (action header carries direction + origin square).
  if (isShootAction(event)) {
    const fromSquare = String(event.square || event.from_square || "");
    const direction = String(event.direction || "").toLowerCase();
    const snapshot = render.getBoardMap ? render.getBoardMap() : {};
    const onCannon = String(event.piece || snapshot[fromSquare] || "");
    const color = pieceColor(event.piece) || pieceColor(onCannon);
    const { ray, hits } = cannonRayAndHits(snapshot, fromSquare, direction);
    const terminalSquare = ray.length ? ray[ray.length - 1] : "";
    await gameAnimations.animateCannonShot(
      boardEl,
      {
        from: fromSquare,
        direction,
        color,
        hitSquares: hits,
        pathSquares: ray,
        terminalSquare: terminalSquare || null,
      },
      snapshot,
    );
    return;
  }

  // catapult fling action header (payload square -> target square).
  if (isFlingAction(event)) {
    const from = String(event.payload_square || "");
    const to = String(event.target_square || "");
    if (
      !replayMode
      && matchesOptimisticSkip("fling", from, to, optimisticSkip)
    ) {
      consumeOptimisticSkip();
      return;
    }
    const boardMap = render.getBoardMap ? render.getBoardMap() : {};
    const piece = String(event.piece || event.from_piece || boardMap[from] || ""); // server often omits piece
    const targetPc = boardMap[to];
    const payCol = pieceColor(piece);
    const tgtCol = pieceColor(targetPc);
    const captureSquare =
      to && targetPc && payCol && tgtCol && payCol !== tgtCol ? to : null;
    const live = store?.getState?.() ?? null;
    const myColor = effectiveYouColor(live || nextState || {});
    const turnAfter = String(nextState?.current_turn || "").toLowerCase();
    const mover =
      turnAfter === "w" || turnAfter === "b" ? other(turnAfter) : "";
    const isOwnLiveMove = !replayMode && mover && myColor && mover === myColor;
    await gameAnimations.animateCatapultFlings(
      boardEl,
      [{ from, to, piece, captureSquare, fast: isOwnLiveMove || fastDefault }],
    );
    return;
  }

  if (type === EVT_MOVE) {
    const from = String(event.from_square || "");
    const to = String(event.to_square || "");
    const piece = String(event.piece || event.from_piece || "");
    if (!from || !to || !piece) return;
    if (
      !replayMode
      && matchesOptimisticSkip("move", from, to, optimisticSkip)
    ) {
      consumeOptimisticSkip();
      return;
    }
    const snapshot = render.getBoardMap ? render.getBoardMap() : {};
    const tgtPc = snapshot[to];
    const cap =
      tgtPc && pieceColor(tgtPc) && pieceColor(piece) && pieceColor(tgtPc) !== pieceColor(piece)
        ? to
        : null;
    const live = store?.getState?.() ?? null;
    const myColor = effectiveYouColor(live || nextState || {});
    const turnAfter = String(nextState?.current_turn || "").toLowerCase();
    const mover =
      turnAfter === "w" || turnAfter === "b" ? other(turnAfter) : "";
    const isOwnLiveMove = !replayMode && mover && myColor && mover === myColor;
    await gameAnimations.animateMoves(
      boardEl,
      [{
        from,
        to,
        piece,
        captureSquare: cap,
        fast: isOwnLiveMove || fastDefault,
        skipFly,
      }],
    );
    return;
  }

  if (type === EVT_CAPTURE) {
    // eVT_CAPTURE visuals owned by move/cannon/fling primitives
    return;
  }

  if (type === EVT_PROMOTION) {
    const square = String(event.square || event.to_square || "");
    const toPiece = String(event.to_piece || event.piece || "");
    if (!square || !toPiece) return;
    await gameAnimations.animatePromotions(
      boardEl,
      [{ square, color: pieceColor(toPiece), to: toPiece }],
    );
    return;
  }

  if (type === EVT_CONTAGION) {
    const square = String(event.square || event.to_square || "");
    const piece = String(event.to_piece || event.piece || "");
    if (!square) return;
    await gameAnimations.animateZombieConversions(
      boardEl,
      [{ square, color: pieceColor(piece) }],
    );
    return;
  }
}


export function createAnimator({
  store,
  gameAnimations,
  render,
  onDrainIdle,
}: AnimatorDeps): ChezzAnimator {
  const queue: QueueItem[] = [];
  let draining = false;
  let primitiveInFlight = false;
  let cancelEpoch = 0;
  let optimisticPending: OptimisticPending | null = null;
  let optimisticSkip: OptimisticSkip | null = null;

  function buildFlingSkipIndices(events: AnimationEvent[]): Set<number> {
    const skipIndices = new Set<number>();
    for (let i = 0; i < events.length; i++) {
      if (!isFlingAction(events[i])) continue;
      const fFrom = String(events[i].payload_square || "").toLowerCase().trim();
      const fTo = String(events[i].target_square || "").toLowerCase().trim();
      for (let j = i + 1; j < events.length; j++) {
        const next = events[j];
        const nextType = Number(next.type);
        if (nextType === EVT_ACTION) break;
        if (nextType === EVT_MOVE) {
          const mFrom = String(next.from_square || "").toLowerCase().trim();
          const mTo = String(next.to_square || "").toLowerCase().trim();
          if (fFrom && fFrom === mFrom && fTo && fTo === mTo) skipIndices.add(j);
          break;
        }
        if (nextType === EVT_CAPTURE) {
          const capSq = String(next.square || next.to_square || "").toLowerCase().trim();
          if (capSq && (capSq === fFrom || capSq === fTo)) skipIndices.add(j);
        }
      }
    }
    return skipIndices;
  }

  async function runEventPrimitives(
    events: AnimationEvent[],
    nextState: AnimationState | null,
    epochAtItem: number,
    flags: PrimitiveOptions & { replayMode: boolean },
  ): Promise<boolean> {
    const skipIndices = buildFlingSkipIndices(events);
    for (let i = 0; i < events.length; i++) {
      if (epochAtItem !== cancelEpoch) return false;
      if (skipIndices.has(i)) continue;
      const evt = events[i];
      primitiveInFlight = true;
      try {
        await playPrimitive(evt, gameAnimations, render, nextState, store, {
          replayMode: flags.replayMode,
          fast: flags.fast,
          skipFly: flags.skipFly,
          optimisticSkip: flags.optimisticSkip,
          consumeOptimisticSkip: flags.consumeOptimisticSkip,
        });
      } catch (err) {
        console.error("[chezz/animator] primitive error:", err);
      } finally {
        primitiveInFlight = false;
      }
    }
    return epochAtItem === cancelEpoch;
  }

  function buildOptimisticEvents(spec: OptimisticMoveSpec & { kind: string }): AnimationEvent[] {
    const kind = String(spec?.kind || "move").toLowerCase();
    const from = String(spec?.from || "").toLowerCase().trim();
    const to = String(spec?.to || "").toLowerCase().trim();
    const piece = String(spec?.piece || "");
    if (!from || !to || !piece) return [];
    if (kind === "fling") {
      return [{
        type: EVT_ACTION,
        action: "catapult_fling",
        payload_square: from,
        target_square: to,
        piece,
      }];
    }
    return [{ type: EVT_MOVE, from_square: from, to_square: to, piece }];
  }

  function clearOptimisticState(): void {
    optimisticPending = null;
    optimisticSkip = null;
  }

  function pendingLastMoveFromSpec(
    spec: OptimisticMoveSpec,
    kind: string,
    from: string,
    to: string,
  ): PendingLastMove {
    if (kind === "fling") {
      const catapult = String(spec.catapult || "").toLowerCase().trim();
      return { from: catapult || from, to, payload: from };
    }
    return { from, to, payload: null };
  }

  function scheduleNextFrame(fn: () => void): void {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(fn);
    } else {
      setTimeout(fn, 0);
    }
  }

  function syncLiveMoveHighlightTiming(
    boardEl: HTMLElement,
    kind: string,
    from: string,
    to: string,
    skipFly = false,
  ): void {
    if (!boardEl || typeof boardEl.querySelector !== "function") return;
    let ms = 0;
    if (!skipFly) {
      const fromEl = boardEl.querySelector(`[data-square="${from}"]`);
      const toEl = boardEl.querySelector(`[data-square="${to}"]`);
      ms = 100;
      if (fromEl && toEl) {
        const fr = fromEl.getBoundingClientRect();
        const tr = toEl.getBoundingClientRect();
        const dist = Math.hypot(tr.left - fr.left, tr.top - fr.top);
        ms = kind === "fling" ? flingArcDuration(dist, true) : moveTweenDuration(dist, true);
      }
    }
    if (typeof boardEl.classList?.add === "function") {
      boardEl.classList.add("board--live-move");
    }
    if (typeof boardEl.style?.setProperty === "function") {
      boardEl.style.setProperty("--live-move-ms", `${ms}ms`);
    }
  }

  function enqueueOptimisticMove(spec: OptimisticMoveSpec): void {
    if (!spec?.from || !spec?.to || !spec?.piece) return;
    const kind = String(spec.kind || "move").toLowerCase();
    const from = String(spec.from).toLowerCase().trim();
    const to = String(spec.to).toLowerCase().trim();
    const piece = String(spec.piece || "");
    const skipFly = spec.skipFly === true && kind === "move";
    const normalizedKind: MoveKind = kind === "fling" ? "fling" : "move";
    optimisticPending = {
      kind: normalizedKind,
      from,
      to,
      piece,
      capture: Boolean(spec.captureSquare),
    };
    optimisticSkip = null;
    const boardEl = render.getBoardElement?.();
    const pendingLastMove = pendingLastMoveFromSpec(spec, kind, from, to);
    if (skipFly && boardEl && gameAnimations?.snapPieceMove) {
      gameAnimations.snapPieceMove(boardEl, {
        from,
        to,
        piece,
        captureSquare: spec.captureSquare || null,
      });
    } else if (boardEl?.dataset) {
      if (from) boardEl.dataset.moveAnimFrom = from;
      if (spec.captureSquare && to) boardEl.dataset.moveAnimCapture = to;
      if (boardEl && from && typeof boardEl.querySelector === "function") {
        boardEl.querySelector(`[data-square="${from}"]`)?.classList.remove("drag-lift-hidden");
      }
    }
    if (boardEl) {
      syncLiveMoveHighlightTiming(boardEl, kind, from, to, skipFly);
    }
    try {
      store.dispatch({
        type: ACTION.OPTIMISTIC_ANIMATION,
        payload: { pendingLastMove },
      });
    } catch (err) {
      console.error("[chezz/animator] OPTIMISTIC_ANIMATION dispatch error:", err);
    }
    if (skipFly) {
      try {
        store.dispatch({
          type: ACTION.OPTIMISTIC_BOARD_PATCH,
          payload: {
            from,
            to,
            piece,
            capture: Boolean(spec.captureSquare),
          },
        });
      } catch (err) {
        console.error("[chezz/animator] OPTIMISTIC_BOARD_PATCH dispatch error:", err);
      }
    }
    try {
      if (typeof render.setLastMoveHighlight === "function") {
        render.setLastMoveHighlight(
          pendingLastMove.from,
          pendingLastMove.to,
          pendingLastMove.payload,
        );
      }
      if (!skipFly) {
        render.renderBoard?.(store.getState());
        if (typeof render.setLastMoveHighlight === "function") {
          render.setLastMoveHighlight(
            pendingLastMove.from,
            pendingLastMove.to,
            pendingLastMove.payload,
          );
        }
      }
    } catch (err) {
      console.error("[chezz/animator] optimistic highlight error:", err);
    }
    queue.push({
      kind: "live",
      optimistic: true,
      fast: true,
      skipFly,
      animation_events: buildOptimisticEvents({ ...spec, kind, from, to }),
      nextState: null,
    });
    if (!draining) {
      if (skipFly) {
        void drain();
      } else {
        scheduleNextFrame(() => {
          if (!draining) void drain();
        });
      }
    }
  }

  function enqueue(movePayload: { animation_events?: AnimationEvent[]; next_state?: AnimationState | null } | null | undefined): void {
    if (!movePayload) return;
    queue.push({
      kind: "live",
      animation_events: Array.isArray(movePayload.animation_events)
        ? movePayload.animation_events
        : [],
      nextState: movePayload.next_state || null,
    });
    if (!draining) void drain();
  }

  function enqueueReplay({ animation_events, nextState, onComplete, fast = false }: ReplayOptions = {}): void {
    queue.push({
      kind: "replay",
      fast: fast === true,
      animation_events: Array.isArray(animation_events) ? animation_events : [],
      nextState: nextState || null,
      onComplete: typeof onComplete === "function" ? onComplete : undefined,
    });
    if (!draining) void drain();
  }

  function cancel(): void {
    cancelEpoch += 1;
    queue.length = 0;
    clearOptimisticState();
  }

  function cancelOptimistic(): void {
    if (!optimisticPending && !optimisticSkip) return;
    cancelEpoch += 1;
    queue.length = 0;
    clearOptimisticState();
    draining = false;
    try {
      store.dispatch({ type: ACTION.OPTIMISTIC_CANCEL });
    } catch (err) {
      console.error("[chezz/animator] OPTIMISTIC_CANCEL dispatch error:", err);
    }
    try {
      render.renderBoard?.(store.getState());
    } catch (err) {
      console.error("[chezz/animator] cancelOptimistic renderBoard error:", err);
    }
  }

  let idleWaiters: Array<() => void> = [];

  function resolveIdleWaiters(): void {
    if (busy()) return;
    const waiters = idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;
        const epochAtItem = cancelEpoch;
        if (item.optimistic && item.skipFly) {
          if (epochAtItem !== cancelEpoch) continue;
          if (optimisticPending) {
            optimisticSkip = { ...optimisticPending };
            optimisticPending = null;
          }
          continue;
        }
        const events = item.animation_events || [];
        const skipForItem = item.optimistic ? null : optimisticSkip;
        const completed = await runEventPrimitives(events, item.nextState, epochAtItem, {
          replayMode: item.kind === "replay",
          fast: item.fast === true,
          skipFly: item.skipFly === true,
          optimisticSkip: skipForItem,
          consumeOptimisticSkip: () => { optimisticSkip = null; },
        });
        if (!completed) continue;
        if (item.optimistic && optimisticPending) {
          optimisticSkip = { ...optimisticPending };
          optimisticPending = null;
        }
        if (item.kind === "live" && !item.optimistic) {
          try {
            store.dispatch({ type: ACTION.ANIMATION_DONE });
          } catch (err) {
            console.error("[chezz/animator] ANIMATION_DONE dispatch error:", err);
          }
        } else {
          try {
            item.onComplete?.();
          } catch (err) {
            console.error("[chezz/animator] replay onComplete error:", err);
          }
        }
      }
    } finally {
      draining = false;
      queueMicrotask(() => {
        if (typeof onDrainIdle === "function") {
          try {
            onDrainIdle();
          } catch (err) {
            console.error("[chezz/animator] onDrainIdle error:", err);
          }
        }
        resolveIdleWaiters();
      });
    }
  }

  function whenIdle(): Promise<void> {
    if (!busy()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      idleWaiters.push(resolve);
      if (!draining) void drain();
    });
  }

  function busy(): boolean {
    return queue.length > 0 || primitiveInFlight || draining;
  }

  function primitiveBusy(): boolean {
    return queue.length > 0 || primitiveInFlight;
  }

  return {
    enqueue,
    enqueueOptimisticMove,
    enqueueReplay,
    cancel,
    cancelOptimistic,
    busy,
    primitiveBusy,
    drain,
    whenIdle,
  };
}
