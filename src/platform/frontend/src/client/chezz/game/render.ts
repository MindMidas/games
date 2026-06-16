import { renderClocks } from "../../platform/game/clock.js";
export { renderClocks } from "../../platform/game/clock.js";
import { effectiveYouColor } from "../features/gameplay/gameLogic.js";
import { parseFlingSquares } from "./historyMeta.js";
import { renderMoveHistoryList } from "./historyView.js";
import {
  terminalOutcomeFromChezzState,
} from "../../platform/shared/game/victoryReason.js";
import { paintGameOverMatchup } from "../../platform/shared/ui/renderGameOver.js";
import { setImageWithFallback } from "../../platform/shared/lib/images.js";
import { getDefaultAvatar, pieceCodeLooksValid } from "../shared/lib/security.js";
import type { Color, PlayerInfo } from "./contracts.js";
import type { HistoryRow } from "./historyMeta.js";
import type { ClientGameState } from "./store.js";

const PIECE_ASSET_BASE = "/static/games/chezz/assets/pieces";
const DEFAULT_USER_AVATAR = getDefaultAvatar("chezz");
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"];
const ENGINE_USER_ID = "engine";

type BoardMap = Record<string, string>;
type Orientation = Color;
type WinnerSide = "self" | "opponent" | null;

interface PendingLastMove {
  from?: string | null;
  to?: string | null;
  payload?: string | null;
}

type SharedClockState = Parameters<typeof renderClocks>[0];

interface RenderState {
  mode?: "pve" | "pvp" | string;
  status?: string;
  current_turn?: Color | string | null;
  move_number?: number;
  animationPending?: boolean;
  you_color?: Color | string | null;
  you_seat?: string | null;
  self_user_id?: string | null;
  clock_a_ms?: number;
  clock_b_ms?: number;
  clock_active_color?: Color | string | null;
  clock_anchor_iso?: string | null;
  players?: Partial<Record<Color, PlayerInfo>>;
  board?: {
    board?: BoardMap;
    engine_name?: string;
    result?: unknown;
  } | null;
  captured?: Partial<Record<Color, string[]>>;
  move_history?: HistoryRow[];
  pendingAnimation?: (ClientGameState["pendingAnimation"] & {
    pendingLastMove?: PendingLastMove | null;
  }) | null;
  result?: {
    status?: unknown;
    winner?: unknown;
    reason?: unknown;
  } | null;
}

function youColorFor(state: RenderState | null | undefined): Color {
  return effectiveYouColor(state as SharedClockState);
}

function renderSharedClocks(state: RenderState): void {
  renderClocks(state as SharedClockState);
}

interface HistoryRenderOptions {
  showOutcome?: boolean;
  outcomeState?: RenderState | null;
}

interface PlayerTurnHighlightOptions {
  suppress?: boolean;
}

interface OverlayOptions {
  suppress?: boolean;
  overlayState?: RenderState | null;
  onRevealed?: () => void;
}

interface RenderAllOptions {
  historyActiveRow?: number;
  fullMoveHistory?: HistoryRow[] | null;
  outcomeState?: RenderState | null;
  showOutcome?: boolean;
  suppressGameOver?: boolean;
  suppressTurnHighlight?: boolean;
  overlayState?: RenderState | null;
  onTerminalPopupRevealed?: () => void;
}

function pveEngineSeatColor(state: RenderState | null | undefined): Color | null {
  if (state?.mode !== "pve") return null;
  const wId = String(state?.players?.w?.user_id || "").toLowerCase();
  const bId = String(state?.players?.b?.user_id || "").toLowerCase();
  if (wId === ENGINE_USER_ID && bId !== ENGINE_USER_ID) return "w";
  if (bId === ENGINE_USER_ID && wId !== ENGINE_USER_ID) return "b";
  return null;
}

function seatIsEngine(
  state: RenderState | null | undefined,
  youColor: Color,
  seatColor: Color,
): boolean {
  const seatId = String(state?.players?.[seatColor]?.user_id || "").toLowerCase();
  if (seatId === ENGINE_USER_ID) return true;
  if (state?.mode !== "pve") return false;
  return pveEngineSeatColor(state) === seatColor;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function imageById(id: string): HTMLImageElement | null {
  const el = document.getElementById(id);
  return el instanceof HTMLImageElement ? el : null;
}

function ensureBoardSquares(boardEl: HTMLElement, orientation: Orientation): void {
  const wantedOrientation = orientation === "b" ? "b" : "w";
  if (boardEl.dataset.orientation === wantedOrientation && boardEl.childElementCount > 0) {
    return;
  }
  boardEl.innerHTML = "";
  boardEl.dataset.orientation = wantedOrientation;
  const ranks = wantedOrientation === "w" ? [...RANKS].reverse() : RANKS;
  const files = wantedOrientation === "w" ? FILES : [...FILES].reverse();
  for (const rank of ranks) {
    for (const file of files) {
      const square = `${file}${rank}`;
      const cell = document.createElement("div");
      const fileIdx = FILES.indexOf(file);
      const rankIdx = RANKS.indexOf(rank);
      const isLight = (fileIdx + rankIdx) % 2 === 1;
      cell.className = `square ${isLight ? "light" : "dark"}`;
      cell.dataset.square = square;
      boardEl.appendChild(cell);
    }
  }
}

function normalizeSquareId(sq: string | null | undefined): string {
  return String(sq || "").toLowerCase().trim();
}

function boardMapForPendingAnimation(
  state: RenderState | null | undefined,
  boardEl: HTMLElement | null | undefined,
): BoardMap {
  const live = (state?.board && state.board.board) || {};
  const bb = state?.pendingAnimation?.boardBefore?.board;
  if (!state?.animationPending || !bb || typeof bb !== "object") return live;

  const pa = state?.pendingAnimation;
  const from = normalizeSquareId(boardEl?.dataset?.moveAnimFrom);
  const to = normalizeSquareId(boardEl?.dataset?.moveAnimTo);
  // Server ack + visual landing: authoritative live board matches the DOM.
  if (pa?.ownMoveVisual && to) return live;

  if (from && to && bb[from]) {
    const next = { ...bb };
    const piece = next[from];
    delete next[from];
    const captureSq = normalizeSquareId(boardEl?.dataset?.moveAnimCapture);
    if (captureSq === to || (next[to] && String(next[to])[0] !== String(piece)[0])) {
      delete next[to];
    }
    next[to] = piece;
    return next;
  }
  return bb;
}

function renderPieces(boardEl: HTMLElement, boardMap: BoardMap): void {
  const squares = boardEl.querySelectorAll<HTMLElement>(".square");
  /** Source square whose piece is reparented for move/flight tween - do not repaint or a duplicate appears. */
  const moveAnimFrom = normalizeSquareId(boardEl.dataset.moveAnimFrom);
  /** Destination square where the tween landed but boardBefore may still be stale. */
  const moveAnimTo = normalizeSquareId(boardEl.dataset.moveAnimTo);
  for (const cell of squares) {
    const square = normalizeSquareId(cell.dataset.square);
    const existing = cell.querySelector<HTMLImageElement>(".piece-img");
    const piece = (boardMap && boardMap[square]) || null;
    if (piece && moveAnimTo && normalizeSquareId(square) === moveAnimTo) {
      if (existing && existing.getAttribute("alt") === piece) {
        existing.style.opacity = "";
        existing.style.visibility = "";
        continue;
      }
    }
    if (piece && moveAnimFrom && normalizeSquareId(square) === moveAnimFrom) {
      cell.classList.remove("drag-lift-hidden");
      if (existing) existing.remove();
      continue;
    }
    // drag liftoff: skip DOM sync on the source square until the animator runs. `renderAll` can run
    // in the same turn as MOVE_ACCEPTED before async `playPrimitive` sets `moveAnimFrom` / reparents;
    // resetting inline opacity here would override `.drag-lift-hidden` and flash the piece home before the tween.
    if (
      piece
      && existing
      && existing.getAttribute("alt") === piece
      && cell.classList.contains("drag-lift-hidden")
    ) {
      continue;
    }
    if (piece && moveAnimTo && normalizeSquareId(square) === moveAnimFrom) {
      if (existing) existing.remove();
      continue;
    }
    if (!piece) {
      if (existing) {
        if (moveAnimTo && normalizeSquareId(square) === moveAnimTo) continue;
        existing.remove();
      }
      continue;
    }
    if (existing && existing.getAttribute("alt") === piece) {
      existing.style.opacity = "";
      existing.style.visibility = "";
      continue;
    }
    if (existing) existing.remove();
    const img = document.createElement("img");
    img.className = "piece-img";
    img.alt = piece;
    img.draggable = false;
    if (!pieceCodeLooksValid(piece)) {
      continue;
    }
    img.src = `${PIECE_ASSET_BASE}/${piece}.png`;
    cell.appendChild(img);
  }
}

function clearLastMoveHighlightDom(boardEl: HTMLElement | null): void {
  if (!boardEl) return;
  for (const cell of boardEl.querySelectorAll(".last-move-from, .last-move-to, .last-move-payload")) {
    cell.classList.remove("last-move-from", "last-move-to", "last-move-payload");
  }
  delete boardEl.dataset.lastMoveFrom;
  delete boardEl.dataset.lastMoveTo;
  delete boardEl.dataset.lastMovePayload;
}

function setLastMoveHighlightDom(
  boardEl: HTMLElement,
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined,
  payloadRaw: string | null | undefined,
): void {
  const from = normalizeSquareId(fromRaw);
  const to = normalizeSquareId(toRaw);
  const payload = normalizeSquareId(payloadRaw);
  const prevFrom = boardEl.dataset.lastMoveFrom || "";
  const prevTo = boardEl.dataset.lastMoveTo || "";
  const prevPayload = boardEl.dataset.lastMovePayload || "";
  if (prevFrom === (from || "") && prevTo === (to || "") && prevPayload === (payload || "")) {
    return;
  }
  clearLastMoveHighlightDom(boardEl);
  boardEl.dataset.lastMoveFrom = from || "";
  boardEl.dataset.lastMoveTo = to || "";
  boardEl.dataset.lastMovePayload = payload || "";
  if (from) boardEl.querySelector(`[data-square="${from}"]`)?.classList.add("last-move-from");
  if (to) boardEl.querySelector(`[data-square="${to}"]`)?.classList.add("last-move-to");
  if (payload && payload !== from && payload !== to) {
    boardEl.querySelector(`[data-square="${payload}"]`)?.classList.add("last-move-payload");
  }
}

function paintLastMoveHighlights(boardEl: HTMLElement | null, state: RenderState | null | undefined): void {
  if (!boardEl) return;
  const pending = state?.pendingAnimation?.pendingLastMove;
  if (pending && (pending.from || pending.to)) {
    setLastMoveHighlightDom(boardEl, pending.from, pending.to, pending.payload);
    return;
  }
  const hist = Array.isArray(state?.move_history) ? state.move_history : [];
  if (!hist.length) {
    clearLastMoveHighlightDom(boardEl);
    return;
  }
  const row = hist[hist.length - 1];
  const tri = parseFlingSquares(row?.notation);
  if (tri) {
    setLastMoveHighlightDom(boardEl, tri.catapult, tri.target, tri.payload);
    return;
  }
  setLastMoveHighlightDom(boardEl, row?.from_, row?.to, null);
}


export function createRenderer(rootElement: HTMLElement | null = null) {
  void rootElement;
  let lastBoardMap: BoardMap = {};

  function getBoardElement(): HTMLElement | null {
    return byId("board");
  }

  function getBoardMap(): BoardMap {
    return lastBoardMap || {};
  }

  function setLastMoveHighlight(
    fromSq: string | null | undefined,
    toSq: string | null | undefined,
    payloadSq: string | null | undefined = null,
  ): void {
    const boardEl = getBoardElement();
    if (!boardEl) return;
    setLastMoveHighlightDom(boardEl, fromSq, toSq, payloadSq);
  }

  function renderBoard(state: RenderState | null | undefined): void {
    const boardEl = getBoardElement();
    if (!boardEl || !state) return;
    if (!state.animationPending) {
      delete boardEl.dataset.moveAnimFrom;
      delete boardEl.dataset.moveAnimTo;
      delete boardEl.dataset.moveAnimCapture;
      boardEl.classList.remove("board--live-move");
      boardEl.style.removeProperty("--live-move-ms");
    } else if (state?.pendingAnimation?.ownMoveVisual || state?.pendingAnimation?.optimistic) {
      boardEl.classList.add("board--live-move");
    }
    const orientation = youColorFor(state) === "b" ? "b" : "w";
    ensureBoardSquares(boardEl, orientation);
    const boardMap = state.animationPending
      ? boardMapForPendingAnimation(state, boardEl)
      : (state.board && state.board.board) || {};
    lastBoardMap = boardMap;
    renderPieces(boardEl, boardMap);
    paintLastMoveHighlights(boardEl, state);
  }

  function renderHistory(
    state: RenderState | null | undefined,
    activeRowIndex = -2,
    fullRowsOverride: HistoryRow[] | null = null,
    historyOpts: HistoryRenderOptions = {},
  ): void {
    const rows =
      fullRowsOverride != null
        ? fullRowsOverride
        : (Array.isArray(state?.move_history) ? state.move_history : []);
    const outcomeState =
      historyOpts.outcomeState && typeof historyOpts.outcomeState === "object"
        ? historyOpts.outcomeState
        : state;
    const { outcomeState: _drop, ...listOpts } = historyOpts;
    renderMoveHistoryList(byId("history-list"), rows, activeRowIndex, outcomeState || null, listOpts);
  }

  function renderCapturedStrip(el: HTMLElement | null, codes: string[] | undefined): void {
    if (!el) return;
    el.innerHTML = "";
    for (const code of codes || []) {
      if (!pieceCodeLooksValid(code)) {
        continue;
      }
      const img = document.createElement("img");
      img.className = "captured-piece-img";
      img.alt = code;
      img.src = `${PIECE_ASSET_BASE}/${code}.png`;
      el.appendChild(img);
    }
  }

  function renderCaptured(state: RenderState | null | undefined): void {
    const captured = state?.captured || {};
    const you = youColorFor(state);
    // #black-captured is on the top (opponent) row; #white-captured on the bottom (self).
    // strips show material captured BY that color: white captured black pieces -> captured.b;
    // black captured white pieces -> captured.w. Map rows to opponent vs self by seat color.
    if (you === "b") {
      renderCapturedStrip(byId("black-captured"), captured.b || []);
      renderCapturedStrip(byId("white-captured"), captured.w || []);
    } else {
      renderCapturedStrip(byId("black-captured"), captured.w || []);
      renderCapturedStrip(byId("white-captured"), captured.b || []);
    }
  }

  function renderPlayerTurnHighlight(
    state: RenderState | null | undefined,
    opts: PlayerTurnHighlightOptions = {},
  ): void {
    const topCard = document.querySelector(".board-player-row-top .side-card");
    const bottomCard = document.querySelector(".board-player-row-bottom .side-card");
    if (opts.suppress || state?.status !== "active" || isGameTerminalState(state)) {
      topCard?.classList.remove("side-turn-active");
      bottomCard?.classList.remove("side-turn-active");
      return;
    }
    const turn = state?.current_turn;
    const you = youColorFor(state);
    if (!turn || !you || (you !== "w" && you !== "b")) {
      topCard?.classList.remove("side-turn-active");
      bottomCard?.classList.remove("side-turn-active");
      return;
    }
    const opp = you === "w" ? "b" : "w";
    if (topCard) topCard.classList.toggle("side-turn-active", turn === opp);
    if (bottomCard) bottomCard.classList.toggle("side-turn-active", turn === you);
  }

  function renderTurnIndicator(state: RenderState | null | undefined): void {
    const turnEl = byId("turn-pill");
    const movesEl = byId("moves-pill");
    if (turnEl) {
      if (isGameTerminalState(state)) {
        turnEl.textContent = "Turn: —";
      } else {
        const turn = state?.current_turn;
        turnEl.textContent = `Turn: ${turn === "w" ? "White" : turn === "b" ? "Black" : "-"}`;
      }
    }
    if (movesEl) {
      const moveNumber = Number(state?.move_number);
      const n = Number.isFinite(moveNumber) ? moveNumber : 0;
      movesEl.textContent = `Moves: ${n}`;
    }
  }

  function renderStatus(state: RenderState | null | undefined): void {
    const players = state?.players || {};
    const youColor = youColorFor(state);
    const youInfo = players[youColor] || {};
    const oppColor = youColor === "w" ? "b" : "w";
    const oppInfo = players[oppColor] || {};
    const humanNameEl = byId("human-name");
    const humanAvatarEl = imageById("human-avatar");
    const oppNameEl = byId("engine-name");
    const oppAvatarEl = imageById("engine-avatar");
    const humanRoleEl = byId("human-role");
    const oppRoleEl = byId("engine-role");

    if (humanNameEl) humanNameEl.textContent = youInfo.username || "Player";
    if (humanAvatarEl) {
      setImageWithFallback(humanAvatarEl, youInfo.photo_url, DEFAULT_USER_AVATAR);
    }

    const oppIsEngineSeat = seatIsEngine(state, youColor, oppColor);
    const fromBoard = String(state?.board?.engine_name || "").trim();
    if (oppNameEl) {
      if (oppIsEngineSeat) {
        oppNameEl.textContent = fromBoard || "Maximus";
      } else {
        oppNameEl.textContent = oppInfo.username || "Opponent";
      }
    }
    if (oppAvatarEl) {
      setImageWithFallback(oppAvatarEl, oppInfo.photo_url, DEFAULT_USER_AVATAR);
    }

    if (humanRoleEl) {
      humanRoleEl.textContent = youColor === "b" ? "Player • Black" : "Player • White";
    }
    if (oppRoleEl) {
      const kind = oppIsEngineSeat ? "Engine" : "Opponent";
      oppRoleEl.textContent = oppColor === "w" ? `${kind} • White` : `${kind} • Black`;
    }
  }

  function isGameTerminalState(state: RenderState | null | undefined): boolean {
    if (!state) return false;
    if (state.status === "finished") return true;
    const rs = state.result && String(state.result.status || "");
    return rs === "finished" || rs === "draw";
  }

  function renderOverlay(state: RenderState | null | undefined, opts: OverlayOptions = {}): void {
    const overlay = byId("game-over-overlay");
    if (!overlay) return;
    if (opts.suppress) {
      overlay.classList.add("hidden");
      return;
    }
    const src = opts.overlayState && typeof opts.overlayState === "object" ? opts.overlayState : state;
    if (!src || !isGameTerminalState(src)) {
      overlay.removeAttribute("data-user-dismissed");
      overlay.classList.add("hidden");
      return;
    }
    if (overlay.getAttribute("data-user-dismissed") === "true") {
      overlay.classList.add("hidden");
      return;
    }
    overlay.classList.remove("hidden");
    if (typeof opts.onRevealed === "function") {
      try {
        opts.onRevealed();
      } catch {
        /* noop */
      }
    }
    const you = youColorFor(src);
    const outcome = terminalOutcomeFromChezzState(src, { youColor: you });
    const result = src.result || {};
    const winner = result.winner;
    const title = byId("game-over-title");
    const subtitle = byId("game-over-subtitle");
    if (title) {
      title.textContent = outcome.title;
    }
    if (subtitle) subtitle.textContent = outcome.subtitle;

    const opp = you === "w" ? "b" : "w";
    const players = src?.players || {};
    const youInfo = players[you] || {};
    const oppInfo = players[opp] || {};
    const oppIsEngineSeat = seatIsEngine(src, you, opp);
    const fromBoard = String(src?.board?.engine_name || "").trim();

    const oppKind = oppIsEngineSeat ? "Engine" : "Opponent";
    let winnerSide: WinnerSide = null;
    if (winner === "w" || winner === "b") {
      if (you === winner) winnerSide = "self";
      else if (opp === winner) winnerSide = "opponent";
    }

    paintGameOverMatchup({
      self: {
        name: youInfo.username || "Player",
        photoUrl: youInfo.photo_url,
        role: you === "w" ? "Player • White" : "Player • Black",
      },
      opponent: {
        name: oppIsEngineSeat ? (fromBoard || "Maximus") : (oppInfo.username || "Opponent"),
        photoUrl: oppInfo.photo_url,
        role: opp === "w" ? `${oppKind} • White` : `${oppKind} • Black`,
      },
      winnerSide,
    });
  }

  function renderAll(state: RenderState | null | undefined, opts: RenderAllOptions = {}): void {
    if (!state) {
      reset();
      return;
    }
    const historyActiveRow =
      typeof opts.historyActiveRow === "number" ? opts.historyActiveRow : -2;
    const fullMoveHistory = opts.fullMoveHistory != null ? opts.fullMoveHistory : null;
    const historyOpts = {
      showOutcome: opts.showOutcome !== false,
      outcomeState: opts.outcomeState ?? null,
    };
    const chromeOpts = { suppress: opts.suppressTurnHighlight === true };
    renderBoard(state);
    renderHistory(state, historyActiveRow, fullMoveHistory, historyOpts);
    renderCaptured(state);
    renderSharedClocks(state);
    renderTurnIndicator(state);
    renderPlayerTurnHighlight(state, chromeOpts);
    renderStatus(state);
    renderOverlay(state, {
      suppress: opts.suppressGameOver === true,
      overlayState: opts.overlayState,
      onRevealed: opts.onTerminalPopupRevealed,
    });
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent("chezz-arena-layout"));
    });
  }

  function reset(): void {
    const boardEl = getBoardElement();
    if (boardEl) boardEl.innerHTML = "";
    const historyEl = byId("history-list");
    if (historyEl) historyEl.innerHTML = "";
    const whiteCap = byId("white-captured");
    if (whiteCap) whiteCap.innerHTML = "";
    const blackCap = byId("black-captured");
    if (blackCap) blackCap.innerHTML = "";
    const overlay = byId("game-over-overlay");
    if (overlay) {
      overlay.removeAttribute("data-user-dismissed");
      overlay.classList.add("hidden");
    }
    lastBoardMap = {};
  }

  return {
    setLastMoveHighlight,
    renderBoard,
    renderHistory,
    renderCaptured,
    renderClocks,
    renderTurnIndicator,
    renderStatus,
    renderOverlay,
    renderAll,
    reset,
    getBoardElement,
    getBoardMap,
  };
}
