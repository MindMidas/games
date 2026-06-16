import { normalizeSquare } from "../features/gameplay/gameLogic.js";
import { buildHistoryOutcomeLine } from "../../platform/shared/ui/historyOutcome.js";
import {
  terminalOutcomeFromChezzState,
} from "../../platform/shared/game/victoryReason.js";
import { pieceCodeLooksValid } from "../shared/lib/security.js";
import { historyRowMeta, parseFlingSquares } from "./historyMeta.js";
import type { HistoryRow, HistoryRowMeta } from "./historyMeta.js";

const PIECE_ASSET_BASE = "/static/games/chezz/assets/pieces";

/** Radioactive glyph + text presentation (same as rulebook contagion icon). */
export const HISTORY_HAZARD_GLYPH = "\u2622\uFE0E";

const SHOOT_DIR_ARROW: Record<string, string> = { tl: "↖", tr: "↗", bl: "↙", br: "↘" };

interface ChezzHistoryState {
  status?: string;
  result?: {
    status?: unknown;
    winner?: unknown;
    reason?: unknown;
  } | null;
  players?: {
    w?: { username?: unknown };
    b?: { username?: unknown };
  } | null;
}

function appendPieceImg(parent: HTMLElement, code: string): void {
  if (!pieceCodeLooksValid(code)) {
    return;
  }
  const img = document.createElement("img");
  img.className = "history-piece-ico";
  img.alt = code;
  img.src = `${PIECE_ASSET_BASE}/${code}.png`;
  parent.appendChild(img);
}

function appendSqSpan(parent: HTMLElement, sq: string): void {
  const s = document.createElement("span");
  s.className = "history-sq";
  s.textContent = sq;
  parent.appendChild(s);
}

function appendHistoryDirArrow(parent: HTMLElement, glyph: string, title = ""): void {
  const ar = document.createElement("span");
  ar.className = "history-arrow";
  ar.textContent = glyph;
  if (title) {
    ar.title = title;
  }
  parent.appendChild(ar);
}

function appendPathFromTo(pathEl: HTMLElement, fromSq: string, toSq: string): void {
  appendSqSpan(pathEl, fromSq);
  appendHistoryDirArrow(pathEl, "→");
  appendSqSpan(pathEl, toSq);
}

function flingTrajectoryArrow(fromSq: string, toSq: string): string {
  const f = normalizeSquare(fromSq);
  const t = normalizeSquare(toSq);
  if (!f || !t || f.length < 2 || t.length < 2) {
    return "↗";
  }
  const df = t.charCodeAt(0) - f.charCodeAt(0);
  const dr = Number(t[1]) - Number(f[1]);
  if (df > 0 && dr > 0) return "↗";
  if (df > 0 && dr < 0) return "↘";
  if (df < 0 && dr > 0) return "↖";
  if (df < 0 && dr < 0) return "↙";
  if (df === 0 && dr > 0) return "↑";
  if (df === 0 && dr < 0) return "↓";
  if (df > 0 && dr === 0) return "→";
  if (df < 0 && dr === 0) return "←";
  return "↗";
}

function catapultPieceCode(row: HistoryRow): string {
  const c = row.color === "b" ? "b" : "w";
  return `${c}F`;
}

function appendHistoryHazard(parent: HTMLElement, title: string): void {
  const el = document.createElement("span");
  el.className = "history-hazard";
  el.setAttribute("aria-hidden", "true");
  el.textContent = HISTORY_HAZARD_GLYPH;
  el.title = title;
  parent.appendChild(el);
}

function appendRightRail(tags: HTMLElement, meta: Pick<HistoryRowMeta, "hasCapture" | "caps">): void {
  const { hasCapture, caps } = meta;

  if (hasCapture && caps.length) {
    const capWrap = document.createElement("span");
    capWrap.className = "history-rail-captures";
    const x = document.createElement("span");
    x.className = "history-capture-x";
    x.textContent = "x";
    capWrap.appendChild(x);
    for (const c of caps) {
      if (pieceCodeLooksValid(c)) {
        appendPieceImg(capWrap, c);
      }
    }
    tags.appendChild(capWrap);
  }
}

function buildHistoryLine(row: HistoryRow, index0: number, activeRowIndex = -2): HTMLLIElement {
  const li = document.createElement("li");
  const mover = row.color === "b" ? "b" : "w";
  li.className = `history-line history-line--${mover}`;
  li.dataset.moveIndex = String(index0);
  if (Number.isFinite(activeRowIndex) && activeRowIndex >= 0 && activeRowIndex === index0) {
    li.classList.add("history-line-active");
  }
  li.dataset.seq = String(row.seq ?? "");

  const half = Number(row.step);
  const displayNo = Number.isFinite(half) && half > 0 ? half : index0 + 1;
  const meta = historyRowMeta(row);
  const { hasCapture, caps, parsed } = meta;

  const no = document.createElement("span");
  no.className = "history-line-no";
  no.textContent = `${displayNo}.`;

  const side = document.createElement("span");
  side.className = "history-line-side";
  side.textContent = mover === "w" ? "W" : "B";

  const main = document.createElement("div");
  main.className = "history-line-main";

  if (parsed?.kind === "fling") {
    appendPieceImg(main, catapultPieceCode(row));
    appendHistoryDirArrow(main, flingTrajectoryArrow(parsed.payload, parsed.target));
    const payloadCode = String(row.piece || "").trim();
    if (pieceCodeLooksValid(payloadCode)) {
      appendPieceImg(main, payloadCode);
    }
    const path = document.createElement("div");
    path.className = "history-line-path";
    appendPathFromTo(path, parsed.payload, parsed.target);
    main.appendChild(path);
  } else if (parsed?.kind === "shoot") {
    const cannon = String(row.piece || "").trim();
    if (pieceCodeLooksValid(cannon)) {
      appendPieceImg(main, cannon);
    }
    appendHistoryDirArrow(main, SHOOT_DIR_ARROW[parsed.direction] || parsed.direction);
  } else if (parsed?.kind === "move") {
    const moving = String(row.piece || "").trim();
    if (pieceCodeLooksValid(moving)) {
      appendPieceImg(main, moving);
    }
    const path = document.createElement("div");
    path.className = "history-line-path";
    appendPathFromTo(path, parsed.from, parsed.to);
    main.appendChild(path);
  } else {
    const f = normalizeSquare(row.from_);
    const t = normalizeSquare(row.to);
    const moving = String(row.piece || "").trim();
    if (pieceCodeLooksValid(moving)) {
      appendPieceImg(main, moving);
    }
    if (f && t) {
      const path = document.createElement("div");
      path.className = "history-line-path";
      appendPathFromTo(path, f, t);
      main.appendChild(path);
    } else {
      const raw = document.createElement("span");
      raw.className = "history-line-path--raw";
      raw.textContent = String(row.notation || "—").trim() || "—";
      main.appendChild(raw);
    }
  }

  const tags = document.createElement("div");
  tags.className = "history-line-tags";
  appendRightRail(tags, {
    hasCapture,
    caps,
  });

  const body = document.createElement("div");
  body.className = "history-line-body";
  body.appendChild(main);
  if (tags.childNodes.length) {
    body.appendChild(tags);
  }

  li.append(no, side, body);

  return li;
}

export function isGameTerminalForHistory(state: ChezzHistoryState | null | undefined): boolean {
  if (!state) {
    return false;
  }
  if (state.status === "finished") {
    return true;
  }
  const rs = state.result && String(state.result.status || "");
  return rs === "finished" || rs === "draw";
}

function outcomeHeadlineParts(state: ChezzHistoryState): { draw: boolean; name: string; seat: string } {
  const outcome = terminalOutcomeFromChezzState(state);
  if (outcome.reasonCode === "draw_agreed" || outcome.reasonCode === "stalemate") {
    return { draw: true, name: "", seat: "" };
  }

  const result = state?.result || {};
  const w = result.winner;
  const players = state?.players || {};
  const info = w === "w" ? players.w : w === "b" ? players.b : null;
  const name = String(info?.username || "").trim() || outcome.title.replace(/\s+wins$/i, "").trim();

  return {
    draw: false,
    name,
    seat: w === "w" ? "White" : w === "b" ? "Black" : "",
  };
}

function outcomeDetailText(state: ChezzHistoryState): string {
  return terminalOutcomeFromChezzState(state).subtitle;
}

function buildOutcomeLine(state: ChezzHistoryState): HTMLLIElement {
  const head = outcomeHeadlineParts(state);
  return buildHistoryOutcomeLine({
    draw: head.draw,
    name: head.name,
    seat: head.seat,
    reason: outcomeDetailText(state),
  });
}

export function renderMoveHistoryList(
  listEl: HTMLElement | null,
  rows: HistoryRow[] | null | undefined,
  activeRowIndex = -2,
  gameState: ChezzHistoryState | null = null,
  opts: { showOutcome?: boolean } = {},
): void {
  if (!listEl) {
    return;
  }
  listEl.innerHTML = "";
  const safe = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < safe.length; i++) {
    listEl.appendChild(buildHistoryLine(safe[i], i, activeRowIndex));
  }
  const showOutcome = opts.showOutcome !== false;
  if (showOutcome && gameState && isGameTerminalForHistory(gameState)) {
    listEl.appendChild(buildOutcomeLine(gameState));
  }
}
