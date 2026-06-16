import { postShot, postValidatePlaceCue } from "./http.js";
import { cancelTrajectory, clearGlobalCueOverlay, isTrajectoryPlaying } from "./trajectory.js";
import { beginHudSession, hudSeatForTurn, resetAllVel, setPoolHud } from "./hud.js";
import { isReceiver as seatIsReceiver } from "./seatUtils.js";
import {
  tablePointToOverlay,
  tableRotor,
  tableSvgRoot,
} from "./poolTableOverlay.js";
import {
  getCueBallTableCoords,
  poolContainer,
  poolGlobalOverlay,
  poolOverlay,
  readCuePlacedPersisted,
  refreshCueBall,
  setCueBallTableCoords,
  TouchScrollLock,
  writeCuePlacedPersisted,
} from "./poolInputDom.js";
import {
  clampPull,
  clampTablePoint,
  isValidCuePlacement,
  tableVelocityFromOverlayPull,
} from "../features/gameplay/inputDecisions.js";
import type { Point } from "../features/gameplay/inputDecisions.js";
import type { PoolActionResponse, PoolSeat, PoolState } from "./contracts.js";

/** Max cue pull in overlay px - caps aim line length and shot power together. */
const MAX_PULL_PX = 145;
/** Overlay pull distance -> table speed magnitude before engine speed clamp. */
const VEL_SCALE = 24;
/** Pull distance -> cue-stick visual pullback (px in overlay units). */
const CUE_PULLBACK_SCALE = 0.58;

interface PoolInputOptions {
  gameId: string;
  getState: () => Partial<PoolState>;
  onShotAccepted?: (result: PoolActionResponse) => void | Promise<void>;
  onPlacementRejected?: () => void;
  onError: (error: unknown) => void;
  isExploreLocked?: () => boolean;
}

interface AimState {
  cuePos: Point;
  angle: number;
  baseOffset: number;
  pullOffset: number;
  pullDist: number;
  pullDxPx: number;
  pullDyPx: number;
}

interface MoveGesture {
  startClientX: number;
  startClientY: number;
  lastValid: Point | null;
}

export function createPoolInput({
  gameId,
  getState,
  onShotAccepted,
  onPlacementRejected,
  onError,
  isExploreLocked = () => false,
}: PoolInputOptions) {
  let isDragging = false;
  let cueStick: SVGGElement | null = null;
  let cueStickParts: {
    shadow: SVGPathElement;
    shaft: SVGPathElement;
    butt: SVGPathElement;
    ferrule: SVGRectElement;
    tip: SVGCircleElement;
  } | null = null;
  let lastAim: AimState | null = null;
  let activePointerId: number | null = null;
  let xVel = 0;
  let yVel = 0;

  let preferPlaceCue = false;
  let lastBih = false;
  /** Last ball-in-hand receiver id (new scratch episode when this changes). */
  let lastBihReceiverId = "";
  let userModeOverride = false;
  /** Set after a validated ball-in-hand placement until the next scratch episode. */
  let cuePlacedThisBih = false;
  const touchScrollLock = new TouchScrollLock();

  let moveGesture: MoveGesture | null = null;
  // track the cue node + handler we last attached so we can remove the
  // listener cleanly when the user toggles mode without a re-render.
  let boundCueEl: Element | null = null;
  let boundCueHandler: ((event: PointerEvent) => void) | null = null;
  let shotInFlight = false;
  let shotPlaybackLock = false;
  let pendingPlacement: Point | null = null;
  let validateInFlight = false;
  let moveToggleBtn: HTMLElement | null = null;
  let shootToggleBtn: HTMLElement | null = null;
  const onMoveToggleClick = () => setPreferPlaceCue(true);
  const onShootToggleClick = () => setPreferPlaceCue(false);

  function container() {
    return poolContainer();
  }

  function overlay() {
    return poolOverlay();
  }

  function globalOverlay() {
    return poolGlobalOverlay();
  }

  function interactionSeat(state: Partial<PoolState>): PoolSeat | null {
    if (state?.mode === "pnp") return hudSeatForTurn(state);
    return state?.you_seat || null;
  }

  function isReceiver(state: Partial<PoolState>): boolean {
    return seatIsReceiver(state);
  }

  function isShotPlaybackLocked() {
    return shotInFlight || shotPlaybackLock || isTrajectoryPlaying();
  }

  function isGestureActive() {
    return isDragging || Boolean(moveGesture);
  }

  function isDrawerOpen() {
    return Boolean(document.getElementById("game-app")?.classList.contains("game-drawer-open"));
  }

  function lockTouchScroll() {
    touchScrollLock.lock();
  }

  function unlockTouchScroll() {
    touchScrollLock.unlock();
  }

  function clearTouchScrollLock(): void {
    touchScrollLock.clear();
  }

  function preventTouchScroll(event: PointerEvent): void {
    if (event?.cancelable) {
      event.preventDefault();
    }
  }

  function isInteractionLocked() {
    return (
      isExploreLocked()
      || isShotPlaybackLocked()
      || isGestureActive()
    );
  }

  /** Keep lastBih in sync even when we bail early (e.g. during shot playback). */

  function applyBallInHandModeDefaults(state: Partial<PoolState>): void {
    const bih = Boolean(state?.table?.ball_in_hand);
    const receiverId = String(state?.table?.ball_in_hand_for_player_id || "").trim();
    const enteringBih = bih && !lastBih;
    const newBihEpisode = bih && receiverId && receiverId !== lastBihReceiverId;

    if (!bih) {
      preferPlaceCue = false;
      userModeOverride = false;
      cuePlacedThisBih = false;
      writeCuePlacedPersisted(gameId, false);
      lastBihReceiverId = "";
    } else if (enteringBih || newBihEpisode) {
      userModeOverride = false;
      cuePlacedThisBih = false;
      writeCuePlacedPersisted(gameId, false);
      if (isReceiver(state)) {
        preferPlaceCue = true;
      }
    } else if (bih) {
      cuePlacedThisBih = readCuePlacedPersisted(gameId);
      if (isReceiver(state) && !userModeOverride && !cuePlacedThisBih) {
        preferPlaceCue = true;
      }
    }

    lastBih = bih;
    if (bih && receiverId) {
      lastBihReceiverId = receiverId;
    }
  }

  function canShoot(state: Partial<PoolState>): boolean {
    if (isShotPlaybackLocked()) return false;
    if (state?.table?.game_over) return false;
    return Boolean(state?.can_fire_shot);
  }

  function canPlaceCue(state: Partial<PoolState>): boolean {
    if (isShotPlaybackLocked()) return false;
    if (state?.table?.game_over) return false;
    return Boolean(state?.can_place_cue);
  }

  function getTableCoordsFromEvent(event: PointerEvent): Point | null {
    const root = tableSvgRoot();
    const rotor = tableRotor();
    if (!root || !rotor) return null;
    const pt = root.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = rotor.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  /** Pointer position in overlay SVG units (works outside the table bounds). */

  function getOverlayCoordsFromEvent(event: PointerEvent): Point | null {
    const svgOverlayEl = overlay();
    if (!svgOverlayEl) return null;
    const pt = svgOverlayEl.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svgOverlayEl.getScreenCTM()?.inverse();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm);
    return { x: local.x, y: local.y };
  }

  /** Map a table-space point to browser screen (client) pixels. */

  function tablePointToScreen(tx: number, ty: number): Point | null {
    const root = tableSvgRoot();
    const rotor = tableRotor();
    if (!root || !rotor) return null;
    const pt = root.createSVGPoint();
    pt.x = tx;
    pt.y = ty;
    const ctm = rotor.getScreenCTM();
    if (!ctm) return null;
    const screen = pt.matrixTransform(ctm);
    return { x: screen.x, y: screen.y };
  }

  /** Return the rendered cue-ball hit radius. */
  function cueBallRadius(cue: Element): number {
    const hit = cue.querySelector(".pool-ball-hit");
    const r = Number.parseFloat(hit?.getAttribute("r") || "");
    return Number.isFinite(r) && r > 0 ? r : 28.5;
  }

  // shoot mode

  function tableRadiusToScreenPx(cueTable: Point, tableRadius: number): number {
    const r = Number(tableRadius) || 0;
    if (!Number.isFinite(r) || r <= 0) return 22;
    const s0 = tablePointToScreen(cueTable.x, cueTable.y);
    const sx = tablePointToScreen(cueTable.x + r, cueTable.y);
    if (!s0 || !sx) return 22;
    const d = Math.hypot(sx.x - s0.x, sx.y - s0.y);
    return Number.isFinite(d) && d > 0 ? d : 22;
  }

  function ensureCueStick(svgOverlayEl: SVGSVGElement): SVGGElement {
    if (cueStick) return cueStick;
    const ns = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(ns, "g");
    g.setAttribute("data-ui", "cue-stick");
    g.style.pointerEvents = "none";
    /* pin transform origin to the cue tip (local 0,0) so rotate() stays aligned */
    g.style.transformOrigin = '0 0';

    const shadow = document.createElementNS(ns, "path");
    shadow.setAttribute("fill", "rgba(0,0,0,0.18)");

    const shaft = document.createElementNS(ns, "path");
    shaft.setAttribute("fill", "#d7b27c");
    shaft.setAttribute("opacity", "0.96");

    const butt = document.createElementNS(ns, "path");
    butt.setAttribute("fill", "#141414");
    butt.setAttribute("opacity", "0.92");

    const ferrule = document.createElementNS(ns, "rect");
    ferrule.setAttribute("fill", "#f2efe9");
    ferrule.setAttribute("opacity", "0.95");
    ferrule.setAttribute("rx", "2.5");

    const tip = document.createElementNS(ns, "circle");
    tip.setAttribute("fill", "#7a4b2a");
    tip.setAttribute("opacity", "0.95");

    g.appendChild(shadow);
    g.appendChild(shaft);
    g.appendChild(butt);
    g.appendChild(ferrule);
    g.appendChild(tip);
    svgOverlayEl.appendChild(g);
    cueStick = g;
    cueStickParts = { shadow, shaft, butt, ferrule, tip };
    return g;
  }

  function clearCueStick() {
    const svgOverlayEl = globalOverlay();
    if (cueStick && svgOverlayEl) {
      try { svgOverlayEl.removeChild(cueStick); } catch { /* noop */ }
    }
    cueStick = null;
    cueStickParts = null;
    lastAim = null;
    clearGlobalCueOverlay();
  }

  function overlayWidthUnits(svgOverlayEl: SVGSVGElement): number {
    const rect = svgOverlayEl.getBoundingClientRect?.();
    const w = rect ? rect.width : window.innerWidth;
    return Number.isFinite(w) && w > 0 ? w : 800;
  }

  function updateCueStickGeometry(svgOverlayEl: SVGSVGElement): {
    stickLen: number;
    tipLen: number;
    gripStart: number;
  } {
    if (!cueStickParts) return { stickLen: 320, tipLen: 22, gripStart: 180 };
    const w = overlayWidthUnits(svgOverlayEl);
    const stickLen = Math.min(360, Math.max(180, w * 0.42));
    const buttLen = stickLen * 0.28;
    const tipLen = Math.min(26, Math.max(14, stickLen * 0.055));
    const buttW = Math.min(12.5, Math.max(7.2, w * 0.0108));
    const midW = Math.min(10.8, Math.max(6.6, w * 0.0096));
    const tipW = Math.min(7.4, Math.max(4.8, w * 0.0072));

    const x0 = -stickLen;
    const x1 = -buttLen;
    const x2 = 0;

    const shaftD = [
      `M ${x0} ${-midW / 2}`,
      `L ${x1} ${-midW / 2}`,
      `L ${x2} ${-tipW / 2}`,
      `L ${x2} ${tipW / 2}`,
      `L ${x1} ${midW / 2}`,
      `L ${x0} ${midW / 2}`,
      "Z",
    ].join(" ");
    cueStickParts.shaft.setAttribute("d", shaftD);

    const buttD = [
      `M ${x0} ${-buttW / 2}`,
      `L ${x1} ${-buttW / 2}`,
      `L ${x1} ${buttW / 2}`,
      `L ${x0} ${buttW / 2}`,
      "Z",
    ].join(" ");
    cueStickParts.butt.setAttribute("d", buttD);

    const shadowD = [
      `M ${x0} ${-midW / 2 + 3}`,
      `L ${x1} ${-midW / 2 + 3}`,
      `L ${x2} ${-tipW / 2 + 3}`,
      `L ${x2} ${tipW / 2 + 3}`,
      `L ${x1} ${midW / 2 + 3}`,
      `L ${x0} ${midW / 2 + 3}`,
      "Z",
    ].join(" ");
    cueStickParts.shadow.setAttribute("d", shadowD);

    const ferruleLen = Math.min(18, Math.max(10, tipLen * 0.7));
    const ferruleH = tipW * 1.45;
    cueStickParts.ferrule.setAttribute("x", String(-ferruleLen));
    cueStickParts.ferrule.setAttribute("y", String(-ferruleH / 2));
    cueStickParts.ferrule.setAttribute("width", String(ferruleLen));
    cueStickParts.ferrule.setAttribute("height", String(ferruleH));
    cueStickParts.ferrule.setAttribute("rx", String(Math.max(2, ferruleH * 0.18)));

    cueStickParts.tip.setAttribute("cx", "0");
    cueStickParts.tip.setAttribute("cy", "0");
    cueStickParts.tip.setAttribute("r", String(Math.max(2.1, tipW * 0.19)));
    const gripStart = x0;
    return { stickLen, tipLen, gripStart };
  }

  function drawAimToCursor(event: PointerEvent): void {
    if (!isDragging) return;
    if (isDrawerOpen()) {
      isDragging = false;
      activePointerId = null;
      clearCueStick();
      detachAll();
      return;
    }
    preventTouchScroll(event);
    const svgOverlayEl = overlay();
    const global = globalOverlay();
    if (!svgOverlayEl || !global) return;

    const cueTable = getCueBallTableCoords();
    const cursorTable = getTableCoordsFromEvent(event);
    if (!cueTable || !cursorTable) return;

    const cuePos = tablePointToOverlay(svgOverlayEl, cueTable.x, cueTable.y);
    const cursor = getOverlayCoordsFromEvent(event);
    if (!cuePos || !cursor) return;

    const rawDx = cuePos.x - cursor.x;
    const rawDy = cuePos.y - cursor.y;
    const { dx: pullDx, dy: pullDy, len: pullDist } = clampPull(rawDx, rawDy, MAX_PULL_PX);

    const vel = tableVelocityFromOverlayPull(
      (x, y) => tablePointToOverlay(svgOverlayEl, x, y),
      cueTable.x,
      cueTable.y,
      pullDx,
      pullDy,
      pullDist * VEL_SCALE,
    );
    xVel = vel.xVel;
    yVel = vel.yVel;

    const cueScreen = tablePointToScreen(cueTable.x, cueTable.y);
    if (!cueScreen) return;
    const cue = refreshCueBall();
    const rPx = cue ? tableRadiusToScreenPx(cueTable, cueBallRadius(cue)) : 22;
    const tipGapPx = 10;
    const baseOffset = rPx + tipGapPx;

    // visual pull uses screen pixels so it can render outside #game-app.
    const rawDxPx = cueScreen.x - event.clientX;
    const rawDyPx = cueScreen.y - event.clientY;
    const { dx: pullDxPx, dy: pullDyPx, len: pullDistPx } = clampPull(rawDxPx, rawDyPx, MAX_PULL_PX);
    const pullOffset = pullDistPx * CUE_PULLBACK_SCALE;
    const angle = Math.atan2(pullDyPx, pullDxPx) * (180 / Math.PI);

    const stick = ensureCueStick(global);
    updateCueStickGeometry(global);
    lastAim = {
      cuePos: cueScreen,
      angle,
      baseOffset,
      pullOffset,
      pullDist: pullDistPx,
      pullDxPx,
      pullDyPx,
    };
    stick.style.transform = `translate(${cueScreen.x}px, ${cueScreen.y}px) rotate(${angle}deg) translate(${-baseOffset - pullOffset}px, 0px)`;

    setPoolHud("cue-x", cueTable.x);
    setPoolHud("cue-y", cueTable.y);
    setPoolHud("cursor-x", cursorTable.x);
    setPoolHud("cursor-y", cursorTable.y);
    setPoolHud("xvel", xVel);
    setPoolHud("yvel", yVel);
  }

  function updateMoveHud(event: PointerEvent): void {
    const cue = refreshCueBall();
    if (!cue || !moveGesture) return;
    const raw = getTableCoordsFromEvent(event);
    if (!raw) return;
    const p = clampTablePoint(raw.x, raw.y);
    setPoolHud("cue-x", p.x);
    setPoolHud("cue-y", p.y);
    setPoolHud("cursor-x", p.x);
    setPoolHud("cursor-y", p.y);
    setPoolHud("xvel", 0);
    setPoolHud("yvel", 0);
  }

  function cueCoordsForShot(state: Partial<PoolState>): { cueX: number | null; cueY: number | null } {
    const pos = pendingPlacement || getCueBallTableCoords();
    pendingPlacement = null;
    if (!state?.table?.ball_in_hand || !pos) return { cueX: null, cueY: null };
    return { cueX: pos.x, cueY: pos.y };
  }

  async function validatePlacementWithServer(x: number, y: number): Promise<boolean> {
    if (validateInFlight) return true;
    validateInFlight = true;
    try {
      await postValidatePlaceCue(gameId, x, y);
      return true;
    } catch (err) {
      onError(err);
      if (typeof onPlacementRejected === "function") onPlacementRejected();
      return false;
    } finally {
      validateInFlight = false;
    }
  }

  async function sendShot() {
    const state = getState();
    if (!canShoot(state)) return;
    shotInFlight = true;
    clearCueStick();
    container()?.classList.remove("pool-aim-dragging");
    detachAll();
    try {
      const { cueX, cueY } = cueCoordsForShot(state);
      const aimPayload = lastAim
        ? {
            angle: lastAim.angle,
            base_offset: lastAim.baseOffset,
            pull_offset: lastAim.pullOffset,
            pull_dist: lastAim.pullDist,
            pull_dx_px: lastAim.pullDxPx,
            pull_dy_px: lastAim.pullDyPx,
          }
        : null;
      const result = await postShot(gameId, xVel, yVel, cueX, cueY, aimPayload);
      if (typeof onShotAccepted === "function") {
        await onShotAccepted(result);
      }
    } catch (err) {
      onError(err);
    } finally {
      shotInFlight = false;
      resetAllVel();
      if (!getState()?.table?.ball_in_hand) {
        userModeOverride = false;
        cuePlacedThisBih = false;
        writeCuePlacedPersisted(gameId, false);
      }
      syncInteraction();
    }
  }

  function onShotPlaybackStart() {
    shotPlaybackLock = true;
    clearCueStick();
    container()?.classList.remove("pool-aim-dragging");
    detachAll();
  }

  function onShotPlaybackEnd() {
    shotPlaybackLock = false;
    cancelTrajectory();
    clearCueStick();
    syncInteraction();
  }

  function handleShootPointerDown(event: PointerEvent): void {
    if (!event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const state = getState();
    if (isInteractionLocked() || !canShoot(state)) return;
    if (isDrawerOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    lockTouchScroll();
    const cueTable = getCueBallTableCoords();
    if (!cueTable) {
      unlockTouchScroll();
      return;
    }
    beginHudSession(interactionSeat(state));
    isDragging = true;
    activePointerId = event.pointerId;
    const root = container();
    root?.classList.add("pool-aim-dragging");
    if (root) root.style.cursor = "grabbing";
    try { boundCueEl?.setPointerCapture?.(event.pointerId); } catch { /* noop */ }
    window.addEventListener("pointermove", drawAimToCursor, { passive: false });
    window.addEventListener("pointerup", handleShootPointerUp);
    window.addEventListener("pointercancel", handleShootPointerUp);
  }

  function handleShootPointerUp(event: PointerEvent): void {
    if (activePointerId != null && event?.pointerId != null && event.pointerId !== activePointerId) {
      return;
    }
    isDragging = false;
    activePointerId = null;
    removeShootWindowListeners();
    const root = container();
    // if the cue stick is still visible (we're waiting for the server),
    // keep overflow visible so the cue can extend outside the table bounds.
    if (!cueStick) {
      root?.classList.remove("pool-aim-dragging");
    }
    if (root) root.style.cursor = "";
    unlockTouchScroll();
    if (cueStick) {
      void sendShot();
    } else {
      resetAllVel();
    }
  }

  // move mode

  function clearMovePreview() {
    container()?.classList.remove("pool-cue-move-invalid");
  }

  function applyMovePreview(event: PointerEvent): void {
    if (!moveGesture) return;
    const raw = getTableCoordsFromEvent(event);
    if (!raw) return;
    const p = clampTablePoint(raw.x, raw.y);
    const valid = isValidCuePlacement(p.x, p.y, getState()?.table?.balls);
    moveGesture.lastValid = valid ? p : null;
    container()?.classList.toggle("pool-cue-move-invalid", !valid);
    if (valid) setCueBallTableCoords(p.x, p.y);
  }

  function handleMoveCueDown(event: PointerEvent): void {
    if (!event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (isInteractionLocked()) return;
    const state = getState();
    if (!canPlaceCue(state)) return;
    if (isDrawerOpen()) return;
    if (!isReceiver(state) || state?.table?.game_over) return;
    event.preventDefault();
    event.stopPropagation();
    lockTouchScroll();
    const center = getCueBallTableCoords() || getTableCoordsFromEvent(event);
    if (!center) {
      unlockTouchScroll();
      return;
    }
    beginHudSession(interactionSeat(state));
    moveGesture = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastValid: { x: center.x, y: center.y },
    };
    activePointerId = event.pointerId;
    try { boundCueEl?.setPointerCapture?.(event.pointerId); } catch { /* noop */ }
    window.addEventListener("pointermove", handleMoveWindowMove, { passive: false });
    window.addEventListener("pointerup", handleMoveWindowUp);
    window.addEventListener("pointercancel", handleMoveWindowUp);
  }

  function handleMoveWindowMove(event: PointerEvent): void {
    if (activePointerId != null && event?.pointerId != null && event.pointerId !== activePointerId) {
      return;
    }
    if (!moveGesture) return;
    preventTouchScroll(event);
    applyMovePreview(event);
    updateMoveHud(event);
  }

  async function handleMoveWindowUp() {
    activePointerId = null;
    if (!moveGesture) return;
    removeMoveWindowListeners();
    const target = moveGesture.lastValid;
    moveGesture = null;
    if (!target) {
      unlockTouchScroll();
      if (pendingPlacement) setCueBallTableCoords(pendingPlacement.x, pendingPlacement.y);
      clearMovePreview();
      syncInteraction();
      return;
    }
    pendingPlacement = target;
    setCueBallTableCoords(target.x, target.y);
    const valid = await validatePlacementWithServer(target.x, target.y);
    if (valid) {
      cuePlacedThisBih = true;
      writeCuePlacedPersisted(gameId, true);
      preferPlaceCue = false;
      userModeOverride = true;
    }
    syncInteraction();
  }

  // mode plumbing

  function removeShootWindowListeners(): void {
    window.removeEventListener("pointermove", drawAimToCursor);
    window.removeEventListener("pointerup", handleShootPointerUp);
    window.removeEventListener("pointercancel", handleShootPointerUp);
  }

  function removeMoveWindowListeners(): void {
    window.removeEventListener("pointermove", handleMoveWindowMove);
    window.removeEventListener("pointerup", handleMoveWindowUp);
    window.removeEventListener("pointercancel", handleMoveWindowUp);
  }

  function unbindCuePointer(): void {
    if (boundCueEl && boundCueHandler) {
      boundCueEl.removeEventListener("pointerdown", boundCueHandler as EventListener);
    }
    boundCueEl = null;
    boundCueHandler = null;
  }

  function bindCuePointer(cue: Element, handler: (event: PointerEvent) => void): void {
    unbindCuePointer();
    boundCueEl = cue;
    boundCueHandler = handler;
    cue.addEventListener("pointerdown", handler as EventListener, { passive: false });
  }

  function detachAll(): void {
    const root = container();
    root?.classList.remove("pool-cue-move", "pool-cue-move-invalid");
    root?.classList.remove("pool-aim-dragging");
    removeShootWindowListeners();
    removeMoveWindowListeners();
    unbindCuePointer();
    clearCueStick();
    moveGesture = null;
    activePointerId = null;
    clearTouchScrollLock();
  }

  function setPreferPlaceCue(place: boolean): void {
    preferPlaceCue = Boolean(place);
    userModeOverride = true;
    updateToggleUi();
    syncInteraction();
  }

  function updateToggleUi() {
    const moveBtn = document.getElementById("pool-cue-mode-move-btn");
    const shootBtn = document.getElementById("pool-cue-mode-shoot-btn");
    moveBtn?.classList.toggle("is-active", preferPlaceCue);
    shootBtn?.classList.toggle("is-active", !preferPlaceCue);
  }

  function bindToggleButtons() {
    const nextMove = document.getElementById("pool-cue-mode-move-btn");
    const nextShoot = document.getElementById("pool-cue-mode-shoot-btn");
    if (moveToggleBtn && moveToggleBtn !== nextMove) {
      moveToggleBtn.removeEventListener("click", onMoveToggleClick);
      moveToggleBtn = null;
    }
    if (shootToggleBtn && shootToggleBtn !== nextShoot) {
      shootToggleBtn.removeEventListener("click", onShootToggleClick);
      shootToggleBtn = null;
    }
    if (nextMove && moveToggleBtn !== nextMove) {
      nextMove.addEventListener("click", onMoveToggleClick);
      moveToggleBtn = nextMove;
    }
    if (nextShoot && shootToggleBtn !== nextShoot) {
      nextShoot.addEventListener("click", onShootToggleClick);
      shootToggleBtn = nextShoot;
    }
  }

  function unbindToggleButtons() {
    if (moveToggleBtn) {
      moveToggleBtn.removeEventListener("click", onMoveToggleClick);
      moveToggleBtn = null;
    }
    if (shootToggleBtn) {
      shootToggleBtn.removeEventListener("click", onShootToggleClick);
      shootToggleBtn = null;
    }
  }

  function syncInteraction() {
    const root = container();
    const state = getState();
    const bihNow = Boolean(state?.table?.ball_in_hand);
    applyBallInHandModeDefaults(state);

    if (isDrawerOpen()) {
      root?.classList.add("pool-history-locked");
      detachAll();
      return;
    }

    // do not tear down aim / move gestures mid-pointer (paintall / SSE can call sync).
    if (isGestureActive()) {
      updateToggleUi();
      return;
    }

    if (isExploreLocked()) {
      root?.classList.add("pool-history-locked");
      detachAll();
      return;
    }
    root?.classList.remove("pool-history-locked");

    if (!isShotPlaybackLocked()) {
      root?.classList.remove("pool-shot-animating");
    }
    if (isShotPlaybackLocked()) {
      detachAll();
      updateToggleUi();
      return;
    }

    container()?.classList.remove("pool-aim-dragging");
    detachAll();
    bindToggleButtons();
    updateToggleUi();

    const cue = refreshCueBall();
    if (!cue) return;
    const placeActive =
      bihNow && canPlaceCue(state) && preferPlaceCue;
    if (placeActive) {
      container()?.classList.add("pool-cue-move");
      bindCuePointer(cue, handleMoveCueDown);
    } else if (canShoot(state)) {
      bindCuePointer(cue, handleShootPointerDown);
    }
  }

  function unbind() {
    container()?.classList.remove("pool-history-locked");
    pendingPlacement = null;
    detachAll();
    unbindToggleButtons();
  }

  function hasPendingCuePlacement() {
    return pendingPlacement != null;
  }

  function cancelPendingCuePlacement() {
    pendingPlacement = null;
  }

  return {
    bind: syncInteraction,
    syncInteraction,
    unbind,
    refreshCueBall,
    hasPendingCuePlacement,
    cancelPendingCuePlacement,
    isShotPlaybackLocked,
    isGestureActive,
    onShotPlaybackStart,
    onShotPlaybackEnd,
  };
}
