import { playGameSound } from "../sound/controller.js";
import { shouldPlayFlingSound } from "../../game/sound.js";
import {
  toCoord,
  toSquare,
  inBounds,
  directionDelta,
  raySquares,
} from "./gameLogic.js";
import { clamp, moveTweenDuration, flingArcDuration } from "./moveTiming.js";

export { toCoord, toSquare, inBounds, directionDelta, raySquares };
export { clamp, moveTweenDuration, flingArcDuration } from "./moveTiming.js";

type BoardMap = Record<string, string>;

interface SquareCenter {
  x: number;
  y: number;
  size: number;
}

interface ConversionSpec {
  square: string;
  color?: string;
}

interface PromotionSpec {
  square: string;
  color?: string;
  to: string;
}

interface MoveSpec {
  from: string;
  to: string;
  piece: string;
  captureSquare?: string | null;
  suppressSfx?: boolean;
  skipFly?: boolean;
  fast?: boolean;
}

interface MoveAnimationOptions {
  fast?: boolean;
}

interface LandOptions {
  fromKey?: string;
  captureSquare?: string | null;
}

interface CannonShotSpec {
  from: string;
  direction: string;
  color?: string;
  hitSquares?: string[];
  pathSquares?: string[];
  terminalSquare?: string | null;
}

type FrameCallback = () => void;

export function cannonBallDiameter(squareSizePx: number): number {
  const sq = Number(squareSizePx) || 0;
  let d = sq * 0.19;
  const boardPx = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--board-size") || "",
  );
  if (Number.isFinite(boardPx)) {
    if (boardPx <= 260) {
      d *= 0.78;
    } else if (boardPx <= 320) {
      d *= 0.88;
    } else if (boardPx <= 380) {
      d *= 0.94;
    }
  }
  return clamp(d, 4, 11);
}

export function squareCenter(boardElement: HTMLElement, square: string): SquareCenter | null {
  const squareEl = boardElement.querySelector(`[data-square="${square}"]`);
  if (!squareEl) return null;
  const boardRect = boardElement.getBoundingClientRect();
  const rect = squareEl.getBoundingClientRect();
  return {
    x: rect.left - boardRect.left + rect.width / 2,
    y: rect.top - boardRect.top + rect.height / 2,
    size: Math.min(rect.width, rect.height),
  };
}

export function flashSquare(
  boardElement: HTMLElement,
  square: string,
  className = "bullet-impact",
  duration = 260,
): void {
  const squareEl = boardElement.querySelector(`[data-square="${square}"]`);
  if (!squareEl) return;
  squareEl.classList.add(className);
  setTimeout(() => squareEl.classList.remove(className), duration);
}

export function collectCannonRayHits(board: BoardMap, fromSquare: string, direction: string): string[] {
  const ray = raySquares(fromSquare, direction);
  return ray.filter((square) => Boolean(board[square]));
}

export function spawnImpactSmoke(boardElement: HTMLElement, square: string, type = "catapult"): void {
  const center = squareCenter(boardElement, square);
  if (!center) return;
  const smoke = document.createElement("div");
  smoke.className = `impact-smoke ${type}`;
  smoke.style.left = `${center.x}px`;
  smoke.style.top = `${center.y}px`;
  smoke.style.width = `${center.size * 0.92}px`;
  smoke.style.height = `${center.size * 0.92}px`;
  boardElement.appendChild(smoke);
  setTimeout(() => smoke.remove(), 620);
}

export function spawnZombieConversionEffect(boardElement: HTMLElement, conversion: ConversionSpec): void {
  const center = squareCenter(boardElement, conversion.square);
  if (!center) return;

  const squareEl = boardElement.querySelector(`[data-square="${conversion.square}"]`);
  if (squareEl) {
    squareEl.classList.add("zombie-convert");
    setTimeout(() => squareEl.classList.remove("zombie-convert"), 620);
  }

  const bloom = document.createElement("div");
  bloom.className = "zombie-bloom green";
  bloom.style.left = `${center.x}px`;
  bloom.style.top = `${center.y}px`;
  bloom.style.width = `${center.size * 0.66}px`;
  bloom.style.height = `${center.size * 0.66}px`;

  const ring = document.createElement("div");
  ring.className = "zombie-ring green";
  ring.style.left = `${center.x}px`;
  ring.style.top = `${center.y}px`;
  ring.style.width = `${center.size * 0.36}px`;
  ring.style.height = `${center.size * 0.36}px`;

  boardElement.appendChild(ring);
  boardElement.appendChild(bloom);
  setTimeout(() => { bloom.remove(); ring.remove(); }, 700);
}

export function spawnPromotionEffect(boardElement: HTMLElement, promotion: PromotionSpec): void {
  const center = squareCenter(boardElement, promotion.square);
  if (!center) return;

  const squareEl = boardElement.querySelector(`[data-square="${promotion.square}"]`);
  if (squareEl) {
    squareEl.classList.add("promotion-square");
    setTimeout(() => squareEl.classList.remove("promotion-square"), 700);
  }

  const flare = document.createElement("div");
  flare.className = "promotion-flare green";
  flare.style.left = `${center.x}px`;
  flare.style.top = `${center.y}px`;
  flare.style.width = `${center.size * 0.72}px`;
  flare.style.height = `${center.size * 0.72}px`;

  const ring = document.createElement("div");
  ring.className = "promotion-ring green";
  ring.style.left = `${center.x}px`;
  ring.style.top = `${center.y}px`;
  ring.style.width = `${center.size * 0.56}px`;
  ring.style.height = `${center.size * 0.56}px`;

  const piece = document.createElement("img");
  piece.className = "promotion-zombie-preview";
  piece.src = `/static/games/chezz/assets/pieces/${promotion.to}.png`;
  piece.alt = promotion.to;
  piece.style.left = `${center.x}px`;
  piece.style.top = `${center.y}px`;
  piece.style.width = `${center.size * 0.72}px`;
  piece.style.height = `${center.size * 0.72}px`;

  boardElement.appendChild(ring);
  boardElement.appendChild(flare);
  boardElement.appendChild(piece);
  setTimeout(() => { flare.remove(); ring.remove(); piece.remove(); }, 760);
}

export function squarePieceCodeFromDom(boardElement: HTMLElement, square: string): string | null {
  const squareEl = boardElement.querySelector(`[data-square="${square}"]`);
  if (!squareEl) return null;
  const pieceImg = squareEl.querySelector(".piece-img");
  if (!pieceImg) return null;
  return pieceImg.getAttribute("alt") || null;
}


export function spawnPieceShatter(boardElement: HTMLElement, square: string, pieceCode: string): void {
  const center = squareCenter(boardElement, square);
  if (!center) return;
  const shatter = document.createElement("div");
  const pieceColorClass = pieceCode?.[0] === "w" ? "white" : "black";
  shatter.className = `cannon-shatter ${pieceColorClass}`;
  shatter.style.left = `${center.x}px`;
  shatter.style.top = `${center.y}px`;
  shatter.style.width = `${center.size * 0.7}px`;
  shatter.style.height = `${center.size * 0.7}px`;
  boardElement.appendChild(shatter);
  flashSquare(boardElement, square, "bullet-impact", 280);
  setTimeout(() => shatter.remove(), 620);
}

export function removeHitPieceAfterSmoke(boardElement: HTMLElement, square: string): void {
  const squareEl = boardElement.querySelector(`[data-square="${square}"]`);
  if (!squareEl) return;
  const pieceImg = squareEl.querySelector(".piece-img");
  if (!pieceImg || pieceImg.classList.contains("cannon-hit-fade")) return;
  pieceImg.classList.add("cannon-hit-fade");
  setTimeout(() => { if (pieceImg.isConnected) pieceImg.remove(); }, 200);
}

export function clearCannonPreviewIndicators(boardElement: HTMLElement): void {
  boardElement.querySelectorAll(".square").forEach((squareEl) => {
    squareEl.classList.remove("cannon-hit");
    for (const cls of [...squareEl.classList]) {
      if (cls === "cannon-ray" || cls.startsWith("cannon-ray-")) {
        squareEl.classList.remove(cls);
      }
    }
  });
}

function raf2(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function startTransition(_animEl: HTMLElement, applyTransform: FrameCallback, fast: boolean): void {
  const kick = fast
    ? (fn: FrameCallback) => requestAnimationFrame(fn)
    : (fn: FrameCallback) => { void raf2().then(fn); };
  kick(applyTransform);
}

function landFlyingPiece(
  boardElement: HTMLElement,
  toEl: Element,
  toKey: string,
  pieceEl: HTMLImageElement,
  opts: LandOptions = {},
): void {
  const fromKey = String(opts.fromKey || "").toLowerCase().trim();
  void fromKey;
  if (opts.captureSquare) {
    toEl.querySelector(".piece-img")?.remove();
  }
  for (const img of toEl.querySelectorAll(".piece-img, .move-anim-piece")) {
    if (img !== pieceEl) img.remove();
  }
  if (toKey) boardElement.dataset.moveAnimTo = toKey;
  if (opts.captureSquare) {
    boardElement.dataset.moveAnimCapture = toKey;
  }
  // Keep moveAnimFrom until animationPending clears so stale boardBefore cannot repaint FROM.
  pieceEl.classList.remove("piece-img--flight", "move-anim-piece", "catapult-fling-piece");
  pieceEl.removeAttribute("style");
  if (!pieceEl.classList.contains("piece-img")) {
    pieceEl.className = "piece-img";
  }
  if (pieceEl.parentElement !== toEl) toEl.appendChild(pieceEl);
}

export function snapPieceMove(boardElement: HTMLElement, move: MoveSpec): void {
  const fromEl = boardElement.querySelector(`[data-square="${move.from}"]`);
  const toEl = boardElement.querySelector(`[data-square="${move.to}"]`);
  if (!fromEl || !toEl) return;

  const fromKey = String(move.from || "").toLowerCase().trim();
  const toKey = String(move.to || "").toLowerCase().trim();

  if (fromKey) boardElement.dataset.moveAnimFrom = fromKey;
  if (move.captureSquare && toKey) boardElement.dataset.moveAnimCapture = toKey;
  fromEl.classList.remove("drag-lift-hidden", "drag-source", "drag-hover", "drag-invalid-hover");
  toEl.classList.remove("drag-hover", "drag-invalid-hover", "selected");

  let src = fromEl.querySelector<HTMLImageElement>(".piece-img");
  if (!src && move.piece) {
    const onTo = toEl.querySelector<HTMLImageElement>(".piece-img");
    if (onTo && onTo.getAttribute("alt") === move.piece) src = onTo;
  }
  if (move.captureSquare) {
    toEl.querySelector(".piece-img")?.remove();
    if (!move.suppressSfx) playGameSound("capture");
  } else if (!move.suppressSfx) {
    playGameSound("move");
  }
  if (src) {
    for (const img of toEl.querySelectorAll(".piece-img")) {
      if (img !== src) img.remove();
    }
    if (src.parentElement !== toEl) toEl.appendChild(src);
    src.removeAttribute("style");
    src.style.opacity = "";
    src.style.visibility = "";
    src.classList.remove("piece-img--flight", "catapult-fling-piece", "move-anim-piece");
  }
  if (toKey) boardElement.dataset.moveAnimTo = toKey;
}

function animateSingleMove(boardElement: HTMLElement, move: MoveSpec): Promise<void> {
  const fromEl = boardElement.querySelector(`[data-square="${move.from}"]`);
  const toEl   = boardElement.querySelector(`[data-square="${move.to}"]`);
  if (!fromEl || !toEl) return Promise.resolve();

  const fromKey = String(move.from || "").toLowerCase().trim();
  const toKey = String(move.to || "").toLowerCase().trim();

  /* ----- 1. Instant snap ----- */
  if (move.skipFly) {
    snapPieceMove(boardElement, move);
    return Promise.resolve();
  }

  if (fromKey) boardElement.dataset.moveAnimFrom = fromKey;
  if (move.captureSquare && toKey) boardElement.dataset.moveAnimCapture = toKey;

  /* ----- 2. Flying tween ----- */
  const boardRect = boardElement.getBoundingClientRect();
  const fromRect  = fromEl.getBoundingClientRect();
  const toRect    = toEl.getBoundingClientRect();
  const size      = Math.min(fromRect.width, fromRect.height) * 0.78;
  const startX    = fromRect.left - boardRect.left + (fromRect.width - size) / 2;
  const startY    = fromRect.top  - boardRect.top  + (fromRect.height - size) / 2;
  const deltaX    = toRect.left - fromRect.left;
  const deltaY    = toRect.top  - fromRect.top;
  const distance  = Math.hypot(deltaX, deltaY);
  const fast = move.fast === true;
  const duration  = moveTweenDuration(distance, fast);
  const easing    = fast ? "ease-out" : "cubic-bezier(0.33, 0.02, 0.2, 1)";
  const settlePad = fast ? 24 : 100;

  const onLand = () => {
    if (move.captureSquare) playGameSound("capture");
    else playGameSound("move");
  };

  // grab the real piece image from the FROM square; fall back to a sprite copy
  // when the board has already been re-rendered (e.g. pendingState overwrite).
  const sourceImage = fromEl.querySelector<HTMLImageElement>(".piece-img");
  if (!sourceImage) {
    const sprite = document.createElement("img");
    sprite.className = "move-anim-piece";
    sprite.src = `/static/games/chezz/assets/pieces/${move.piece}.png`;
    sprite.alt = move.piece;
    Object.assign(sprite.style, {
      width: `${size}px`, height: `${size}px`,
      left: `${startX}px`, top: `${startY}px`,
      transition: `transform ${duration}ms ${easing}`,
      transform: "translate3d(0,0,0)",
    });
    boardElement.appendChild(sprite);

    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        onLand();
        landFlyingPiece(boardElement, toEl, toKey, sprite, {
          fromKey,
          captureSquare: move.captureSquare,
        });
        resolve();
      };
      sprite.addEventListener("transitionend", settle, { once: true });
      startTransition(sprite, () => {
        sprite.style.transform = `translate3d(${deltaX}px,${deltaY}px,0)`;
      }, fast);
      setTimeout(settle, duration + (fast ? 24 : 100));
    });
  }

  // fly the real piece node across the board.
  sourceImage.parentNode?.removeChild(sourceImage);
  boardElement.appendChild(sourceImage);
  sourceImage.classList.add("piece-img--flight");
  Object.assign(sourceImage.style, {
    position: "absolute",
    left: `${startX}px`, top: `${startY}px`,
    width: `${size}px`,  height: `${size}px`,
    zIndex: "26",
    pointerEvents: "none",
    transformBox: "fill-box",
    transformOrigin: "50% 50%",
    willChange: "transform",
    transition: `transform ${duration}ms ${easing}`,
    transform: "translate3d(0,0,0)",
  });

  return new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      onLand();
      landFlyingPiece(boardElement, toEl, toKey, sourceImage, {
        fromKey,
        captureSquare: move.captureSquare,
      });
      resolve();
    };
    sourceImage.addEventListener("transitionend", settle, { once: true });
    startTransition(sourceImage, () => {
      sourceImage.style.transform = `translate3d(${deltaX}px,${deltaY}px,0)`;
    }, fast);
    setTimeout(settle, duration + settlePad);
  });
}


export async function animateMoves(
  boardElement: HTMLElement,
  moves: MoveSpec[],
  opts: MoveAnimationOptions = {},
): Promise<void> {
  const fast = opts.fast === true;
  for (const move of moves || []) {
    await animateSingleMove(boardElement, { ...move, fast: move.fast === true || fast });
  }
}

function catapultArcKeyframes(
  deltaX: number,
  deltaY: number,
  spinDeg: number,
  scaleEnd: number,
): Keyframe[] {
  const dist    = Math.hypot(deltaX, deltaY);
  const arcLift = -Math.min(80, dist * 0.32);
  const apex    = 0.46;
  const spinMid = Math.round(spinDeg * apex);
  return [
    { transform: "translate3d(0,0,0) rotate(0deg) scale(1.08)", offset: 0 },
    { transform: `translate3d(${deltaX * apex}px,${deltaY * apex + arcLift}px,0) rotate(${spinMid}deg) scale(0.96)`, offset: apex },
    { transform: `translate3d(${deltaX}px,${deltaY}px,0) rotate(${spinDeg}deg) scale(${scaleEnd})`, offset: 1 },
  ];
}

function getOrCreateFlightLayer(): HTMLElement {
  let layer = document.getElementById("chezz-flight-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "chezz-flight-layer";
    Object.assign(layer.style, {
      position: "fixed", top: "0", left: "0",
      width: "0", height: "0",
      overflow: "visible", pointerEvents: "none", zIndex: "9999",
    });
    document.body.appendChild(layer);
  }
  return layer;
}

function animateSingleCatapultFling(boardElement: HTMLElement, move: MoveSpec): Promise<void> {
  const fromEl = boardElement.querySelector(`[data-square="${move.from}"]`);
  const toEl   = boardElement.querySelector(`[data-square="${move.to}"]`);
  if (!fromEl || !toEl || !move?.piece) return Promise.resolve();

  const fromRect = fromEl.getBoundingClientRect();
  const toRect   = toEl.getBoundingClientRect();
  const size     = Math.min(fromRect.width, fromRect.height) * 0.76;
  const startX   = fromRect.left + (fromRect.width - size) / 2;
  const startY   = fromRect.top  + (fromRect.height - size) / 2;
  const deltaX   = toRect.left - fromRect.left;
  const deltaY   = toRect.top  - fromRect.top;
  const distance = Math.hypot(deltaX, deltaY);
  const fast = move.fast === true;
  const duration = flingArcDuration(distance, fast);
  const fromKey   = String(move.from || "").toLowerCase().trim();
  const toKey     = String(move.to || "").toLowerCase().trim();
  const isCapture = Boolean(move.captureSquare);
  const flingColor = String(move.piece || "")[0];
  const spinDeg    = (deltaX >= 0 ? 1 : -1) * 360 * Math.max(4, Math.round(distance / 58) + 2);

  // grab real piece image or fall back to a sprite.
  let flyingImg  = fromEl.querySelector<HTMLImageElement>(".piece-img");
  let usingSprite = false;
  if (!flyingImg) {
    usingSprite = true;
    flyingImg = document.createElement("img");
    flyingImg.className = "piece-img";
    flyingImg.src = `/static/games/chezz/assets/pieces/${move.piece}.png`;
    flyingImg.alt = move.piece;
  }

  if (fromKey) boardElement.dataset.moveAnimFrom = fromKey;
  if (isCapture && toKey) boardElement.dataset.moveAnimCapture = toKey;

  // mount on the fixed flight layer using viewport coordinates.
  flyingImg.classList.add("piece-img--flight", "catapult-fling-piece");
  Object.assign(flyingImg.style, {
    position: "fixed",
    left: `${startX}px`, top: `${startY}px`,
    width: `${size}px`,  height: `${size}px`,
    zIndex: "9999",
    transformBox: "fill-box", transformOrigin: "50% 50%",
    willChange: "transform",
  });
  getOrCreateFlightLayer().appendChild(flyingImg);

  return new Promise<void>((resolve) => {
    let impactDone = false;
    let settled    = false;
    let activeAnim: Animation | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      flyingImg.classList.remove("piece-img--flight", "catapult-fling-piece");
      flyingImg.removeAttribute("style");
      resolve();
    };

    const onImpact = () => {
      if (impactDone) return;
      impactDone = true;

      // cancel WAAPI fill:forwards before reparenting so stale transform
      // doesn't push the piece off-screen once it becomes a toEl child.
      if (activeAnim) { try { activeAnim.cancel(); } catch { /* noop */ } activeAnim = null; }
      flyingImg.style.transition = "none";
      flyingImg.style.transform  = "";

      // landing effects on TO square only.
      const smokeType = flingColor === "w" ? "catapult-white" : flingColor === "b" ? "catapult-black" : "catapult";
      if (isCapture) {
        spawnImpactSmoke(boardElement, move.to, smokeType);
        flashSquare(boardElement, move.to, "bullet-hit", 220);
        playGameSound("capture");
      } else {
        flashSquare(boardElement, move.to, "bullet-hit", 220);
        playGameSound("move");
      }

      if (!usingSprite) {
        landFlyingPiece(boardElement, toEl, toKey, flyingImg, {
          fromKey,
          captureSquare: isCapture ? toKey : null,
        });
      } else {
        flyingImg.remove();
        toEl.querySelector(".piece-img")?.remove();
        const img = document.createElement("img");
        img.className = "piece-img";
        img.alt = move.piece;
        img.draggable = false;
        img.src = `/static/games/chezz/assets/pieces/${move.piece}.png`;
        toEl.appendChild(img);
        if (toKey) boardElement.dataset.moveAnimTo = toKey;
        if (isCapture && toKey) boardElement.dataset.moveAnimCapture = toKey;
      }

      setTimeout(cleanup, fast ? 60 : 120);
    };

    const kick = fast
      ? (fn: FrameCallback) => requestAnimationFrame(fn)
      : (fn: FrameCallback) => { void raf2().then(fn); };
    kick(() => {
      // establish a clear WAAPI "from" state.
      flyingImg.style.transform = "translate3d(0,0,0) rotate(0deg) scale(1.08)";
      void flyingImg.offsetHeight;

      requestAnimationFrame(() => {
        // sound and animation start in the same frame.
        if (shouldPlayFlingSound()) playGameSound("fling");

        const easing = fast
          ? "cubic-bezier(0.25, 0.85, 0.35, 1)"
          : "cubic-bezier(0.18, 0.75, 0.22, 1)";
        try {
          activeAnim = flyingImg.animate(catapultArcKeyframes(deltaX, deltaY, spinDeg, 0.92), { duration, easing, fill: "none" });
          activeAnim.onfinish = () => { if (!impactDone) onImpact(); };
          activeAnim.oncancel = () => { if (!impactDone) onImpact(); };
        } catch {
          // CSS fallback if WAAPI unavailable.
          flyingImg.style.transition = `transform ${duration}ms ${easing}`;
          requestAnimationFrame(() => {
            flyingImg.style.transform = `translate3d(${deltaX}px,${deltaY}px,0) rotate(${spinDeg}deg) scale(0.92)`;
            flyingImg.addEventListener("transitionend", () => { if (!impactDone) onImpact(); }, { once: true });
          });
        }

        setTimeout(() => { if (!impactDone) onImpact(); }, duration + (fast ? 80 : 220));
      });
    });
  });
}

export async function animateCatapultFlings(
  boardElement: HTMLElement,
  moves: MoveSpec[],
  opts: MoveAnimationOptions = {},
): Promise<void> {
  const fast = opts.fast === true;
  for (const move of moves || []) {
    await animateSingleCatapultFling(boardElement, { ...move, fast: move.fast === true || fast });
  }
}

export function animateCannonShot(
  boardElement: HTMLElement,
  shot: CannonShotSpec,
  boardSnapshot: BoardMap = {},
): Promise<void> {
  if (!shot?.from || !shot?.direction) return Promise.resolve();

  const pathSquares = Array.isArray(shot.pathSquares) && shot.pathSquares.length > 0
    ? shot.pathSquares
    : raySquares(shot.from, shot.direction);
  if (pathSquares.length === 0) return Promise.resolve();

  const cannonCenter = squareCenter(boardElement, shot.from);
  if (!cannonCenter) return Promise.resolve();

  // build center-point list: [cannon, sq0, sq1, ...].
  const centers = [cannonCenter];
  for (const sq of pathSquares) {
    const c = squareCenter(boardElement, sq);
    if (c) centers.push(c);
  }
  if (centers.length < 2) return Promise.resolve();

  // cumulative distances for proportional hit timing.
  const cumDist = [0];
  for (let i = 1; i < centers.length; i++) {
    cumDist.push(cumDist[i - 1] + Math.hypot(centers[i].x - centers[i - 1].x, centers[i].y - centers[i - 1].y));
  }
  const totalDist = cumDist[cumDist.length - 1];
  const totalMs   = clamp(400 + totalDist * 0.55, 480, 1600);

  // snapshot hit squares before the animation moves anything.
  const pieceAtSq = (sq: string): string | null => boardSnapshot[sq] || squarePieceCodeFromDom(boardElement, sq) || null;
  const initialBySq = new Map<string, string>();
  for (const sq of pathSquares) {
    const pc = pieceAtSq(sq);
    if (pc) initialBySq.set(sq, pc);
  }

  const smokeType    = shot.color === "w" ? "catapult-white" : shot.color === "b" ? "catapult-black" : "catapult";
  const shooterColor = shot.color === "w" ? "white-shot"     : shot.color === "b" ? "black-shot"     : "red-shot";

  clearCannonPreviewIndicators(boardElement);

  const ball = document.createElement("div");
  ball.className = `cannon-ball ${shooterColor}`;
  const ballD = cannonBallDiameter(cannonCenter.size);
  ball.style.setProperty("--cannon-ball-d", `${ballD}px`);
  ball.style.left = `${centers[0].x}px`;
  ball.style.top  = `${centers[0].y}px`;
  ball.style.willChange = "transform";
  boardElement.appendChild(ball);

  return (async () => {
    await raf2();
    ball.classList.add("in-flight");
    playGameSound("shoot");

    // animate with transform (GPU compositor path) rather than left/top (layout).
    const last = centers[centers.length - 1];
    const dx = last.x - centers[0].x;
    const dy = last.y - centers[0].y;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        ball.style.transition = `transform ${totalMs}ms linear`;
        requestAnimationFrame(() => {
          ball.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
          resolve();
        });
      });
    });

    // schedule hit effects timed to when the ball crosses each occupied square.
    for (let i = 0; i < pathSquares.length; i++) {
      const sq = pathSquares[i];
      if (!initialBySq.has(sq)) continue;
      const snapPc = initialBySq.get(sq);
      setTimeout(() => {
        const livePc = squarePieceCodeFromDom(boardElement, sq) || snapPc;
        spawnImpactSmoke(boardElement, sq, smokeType);
        spawnPieceShatter(boardElement, sq, livePc || "wP");
        setTimeout(() => removeHitPieceAfterSmoke(boardElement, sq), 380);
      }, (cumDist[i + 1] / totalDist) * totalMs);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, totalMs + 40));
    ball.classList.add("fade-out");
    ball.classList.remove("in-flight");
    await new Promise<void>((resolve) => setTimeout(() => { ball.remove(); resolve(); }, 240));
  })();
}

export async function animateZombieConversions(
  boardElement: HTMLElement,
  conversions: ConversionSpec[],
): Promise<void> {
  for (const conversion of conversions || []) {
    playGameSound("zombie");
    spawnZombieConversionEffect(boardElement, conversion);
    await new Promise<void>((resolve) => setTimeout(resolve, 180));
  }
}

export async function animatePromotions(
  boardElement: HTMLElement,
  promotions: PromotionSpec[],
): Promise<void> {
  for (const promotion of promotions || []) {
    playGameSound("promotion");
    spawnPromotionEffect(boardElement, promotion);
    await new Promise<void>((resolve) => setTimeout(resolve, 220));
  }
}
