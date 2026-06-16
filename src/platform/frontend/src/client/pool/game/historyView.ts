import { buildHistoryOutcomeLine } from "../../platform/shared/ui/historyOutcome.js";
import {
  mergePoolOutcomeTable,
  terminalOutcomeFromPoolState,
} from "../../platform/shared/game/victoryReason.js";
import { normalizeGroup, scoresFromSnapshot } from "../shared/lib/poolScores.js";
import { isShotEntry, shotRows } from "./shotHistory.js";
import type { PoolReplayEntry, PoolState, PoolTable } from "./contracts.js";

const BALL_ASSET_BASE = "/static/games/pool/assets/balls";
const CUE_BALL = 0;
const EIGHT_BALL = 8;
const SOLIDS = new Set([1, 2, 3, 4, 5, 6, 7]);
const STRIPES = new Set([9, 10, 11, 12, 13, 14, 15]);

type BallGroup = "solids" | "stripes" | null;
type Seat = "player1" | "player2";
type TerminalPoolState = Parameters<typeof terminalOutcomeFromPoolState>[0];
type MergePoolState = Parameters<typeof mergePoolOutcomeTable>[0];

interface ShotOutcome {
  scratch: boolean;
  legal: number[];
  wrong: number[];
  eightSunk: boolean;
  noBalls: boolean;
  group: BallGroup;
}

interface OutcomeHeadline {
  draw: boolean;
  name: string;
  seat: string;
  showBadge?: boolean;
}

export function ballAssetPath(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n === CUE_BALL) return `${BALL_ASSET_BASE}/cue.svg`;
  if (n === EIGHT_BALL) return `${BALL_ASSET_BASE}/eight.svg`;
  if (n >= 1 && n <= 7) return `${BALL_ASSET_BASE}/solid-${n}.svg`;
  if (n >= 9 && n <= 15) return `${BALL_ASSET_BASE}/stripe-${n}.svg`;
  return null;
}

function ballNumbersOnTable(snapshot: Partial<PoolTable> | null | undefined): Set<number> {
  const balls = snapshot?.balls;
  if (!Array.isArray(balls)) return new Set<number>();
  const out = new Set<number>();
  for (const ball of balls) {
    const n = Number(ball?.n);
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

export function sunkBetweenSnapshots(
  prevSnapshot: Partial<PoolTable> | null | undefined,
  nextSnapshot: Partial<PoolTable> | null | undefined,
): number[] {
  const after = ballNumbersOnTable(nextSnapshot);
  return [...ballNumbersOnTable(prevSnapshot)]
    .filter((n) => !after.has(n))
    .sort((a, b) => a - b);
}

function shooterSeat(snapshot: Partial<PoolTable> | null | undefined): Seat | null {
  if (!snapshot || typeof snapshot !== "object") return null;

  const currentId = String(snapshot.current_player_id || "").trim();
  const p1Id = String(snapshot.player1_id || "").trim();
  const p2Id = String(snapshot.player2_id || "").trim();
  if (currentId && p1Id && currentId === p1Id) return "player1";
  if (currentId && p2Id && currentId === p2Id) return "player2";

  const name = String(snapshot.current_player || "").trim();
  const p1 = String(snapshot.p1_name || "Player 1").trim();
  const p2 = String(snapshot.p2_name || "Player 2").trim();
  if (name && name === p2) return "player2";
  if (name && name === p1) return "player1";
  return "player1";
}

function shooterGroup(prevSnap: Partial<PoolTable>): BallGroup {
  return shooterSeat(prevSnap) === "player2"
    ? normalizeGroup(prevSnap.p2_playing)
    : normalizeGroup(prevSnap.p1_playing);
}

function groupSideLabel(group: BallGroup): string {
  if (group === "solids") return "Solids";
  if (group === "stripes") return "Stripes";
  return "Break";
}

function shooterSideLabel(entry: PoolReplayEntry, prevSnap: Partial<PoolTable>, group: BallGroup): string {
  if (String(entry.label || "").trim() === "Break") return "Break";
  const name = String(prevSnap.current_player || "").trim();
  if (name) return name;
  if (group === "solids") return "Solids";
  if (group === "stripes") return "Stripes";
  return "Shot";
}

function groupSideClass(group: BallGroup): string {
  if (group === "solids") return "solids";
  if (group === "stripes") return "stripes";
  return "open";
}

function analyzeShotOutcome(prevSnap: Partial<PoolTable>, afterSnap: Partial<PoolTable>): ShotOutcome {
  const sunk = sunkBetweenSnapshots(prevSnap, afterSnap);
  const group = shooterGroup(prevSnap);
  const scratchFromPocket = sunk.includes(CUE_BALL);
  const bihAfter = String(afterSnap.ball_in_hand_for_player_id || "").trim();
  const bihBefore = String(prevSnap.ball_in_hand_for_player_id || "").trim();
  const scratch = scratchFromPocket || (Boolean(bihAfter) && bihAfter !== bihBefore);

  const legal: number[] = [];
  const wrong: number[] = [];
  for (const n of sunk) {
    if (n === CUE_BALL || n === EIGHT_BALL) continue;
    if (!group) {
      legal.push(n);
    } else if (group === "solids" && SOLIDS.has(n)) {
      legal.push(n);
    } else if (group === "stripes" && STRIPES.has(n)) {
      legal.push(n);
    } else {
      wrong.push(n);
    }
  }

  const eightSunk = sunk.includes(EIGHT_BALL);
  const noBalls = legal.length === 0 && wrong.length === 0 && !scratch && !eightSunk;
  return { scratch, legal, wrong, eightSunk, noBalls, group };
}

function appendRailText(parent: HTMLElement, text: string): void {
  const el = document.createElement("span");
  el.className = "history-pool-rail-text";
  el.textContent = text;
  parent.appendChild(el);
}

function appendBallImg(parent: HTMLElement, ballNum: number): void {
  const src = ballAssetPath(ballNum);
  if (!src) return;
  const wrap = document.createElement("span");
  wrap.className = "history-ball-ico-wrap";
  const img = document.createElement("img");
  img.className = "history-ball-ico";
  img.alt = ballNum === CUE_BALL ? "Cue" : `Ball ${ballNum}`;
  img.src = src;
  wrap.appendChild(img);
  parent.appendChild(wrap);
}

function appendPocketRail(parent: HTMLElement, balls: number[], wrong: boolean): void {
  if (!balls.length) return;
  const wrap = document.createElement("span");
  wrap.className = wrong
    ? "history-rail-captures history-pool-pocketed--wrong"
    : "history-rail-captures history-pool-pocketed";
  const mark = document.createElement("span");
  mark.className = wrong ? "history-pool-wrong-mark" : "history-capture-x";
  mark.textContent = wrong ? "!" : "×";
  wrap.appendChild(mark);
  for (const ball of balls) appendBallImg(wrap, ball);
  parent.appendChild(wrap);
}

function appendPoolRightRail(tags: HTMLElement, outcome: ShotOutcome): void {
  if (outcome.scratch) appendRailText(tags, "Scratch");

  const legal = [...outcome.legal].sort((a, b) => a - b);
  if (legal.length) appendPocketRail(tags, legal, false);

  const wrong = [...outcome.wrong].sort((a, b) => a - b);
  if (wrong.length) appendPocketRail(tags, wrong, true);

  if (outcome.eightSunk && !legal.includes(EIGHT_BALL) && !wrong.includes(EIGHT_BALL)) {
    appendPocketRail(tags, [EIGHT_BALL], false);
  }
  if (outcome.noBalls) appendRailText(tags, "Miss");
}

function buildHistoryLine(
  entry: PoolReplayEntry,
  rowIndex0: number,
  activeRowIndex: number,
  prevEntry: PoolReplayEntry | undefined,
): HTMLElement {
  const li = document.createElement("li");
  const prevSnap = prevEntry?.snapshot || {};
  const snap = entry.snapshot || {};
  const outcome = analyzeShotOutcome(prevSnap, snap);
  const sideClass = groupSideClass(outcome.group);

  li.className = `history-line history-line--pool history-line--${sideClass}`;
  li.dataset.moveIndex = String(rowIndex0);
  if (Number.isFinite(activeRowIndex) && activeRowIndex >= 0 && activeRowIndex === rowIndex0) {
    li.classList.add("history-line-active");
  }

  const ply = Number(entry.ply);
  const displayNo = Number.isFinite(ply) && ply > 0 ? ply : rowIndex0 + 1;

  const no = document.createElement("span");
  no.className = "history-line-no";
  no.textContent = `${displayNo}.`;

  const side = document.createElement("span");
  side.className = "history-line-side";
  side.textContent = shooterSideLabel(entry, prevSnap, outcome.group);

  const tags = document.createElement("div");
  tags.className = "history-line-tags";
  appendPoolRightRail(tags, outcome);

  const scores = scoresFromSnapshot(snap);
  const score = document.createElement("span");
  score.className = "history-pool-score";
  score.textContent = `${scores.p1}–${scores.p2}`;
  tags.appendChild(score);

  const body = document.createElement("div");
  body.className = "history-line-body";
  if (tags.childNodes.length) body.appendChild(tags);

  li.append(no, side, body);
  return li;
}

export function isGameTerminalForHistory(
  state: Partial<PoolState> | null | undefined,
  terminalSnapshot: Partial<PoolTable> | null = null,
): boolean {
  if (terminalSnapshot?.game_over) return true;
  if (!state) return false;
  if (state.status === "finished" || state.status === "draw") return true;
  return Boolean(state.table?.game_over);
}

function outcomeHeadlineParts(table: Partial<PoolTable>, gameState: Partial<PoolState> | null = null): OutcomeHeadline {
  const outcome = terminalOutcomeFromPoolState({
    table,
    result: gameState?.result,
    status: gameState?.status,
  } as TerminalPoolState);
  if (outcome.reasonCode === "draw_agreed") return { draw: true, name: "", seat: "" };
  if (outcome.reasonCode === "local_end") {
    return { draw: false, name: "Match ended", seat: "", showBadge: false };
  }

  const winner = String(table.winner || "").trim();
  if (!winner) return { draw: false, name: outcome.title, seat: "", showBadge: false };

  const p1 = String(table.p1_name || "Player 1").trim();
  const p2 = String(table.p2_name || "Player 2").trim();
  const group =
    winner === p1 ? normalizeGroup(table.p1_playing)
      : winner === p2 ? normalizeGroup(table.p2_playing)
        : null;
  const label = groupSideLabel(group);
  return {
    draw: false,
    name: winner,
    seat: label && label !== "Break" ? label : "",
  };
}

function outcomeDetailText(table: Partial<PoolTable>, gameState: Partial<PoolState> | null = null): string {
  return terminalOutcomeFromPoolState({
    table,
    result: gameState?.result,
    status: gameState?.status,
  } as TerminalPoolState).subtitle;
}

function buildOutcomeLine(
  gameState: Partial<PoolState> | null,
  terminalSnapshot: Partial<PoolTable> | null,
): HTMLElement {
  const table = mergePoolOutcomeTable(gameState as MergePoolState, terminalSnapshot);
  const head = outcomeHeadlineParts(table, gameState);
  return buildHistoryOutcomeLine({
    draw: head.draw,
    name: head.name,
    seat: head.seat,
    showBadge: head.showBadge,
    reason: outcomeDetailText(table, gameState),
  });
}

export function renderShotHistoryList(
  listEl: HTMLElement | null,
  entries: PoolReplayEntry[],
  activeRowIndex = -2,
  gameState: Partial<PoolState> | null = null,
  terminalSnapshot: Partial<PoolTable> | null = null,
  opts: { showOutcome?: boolean } = {},
): void {
  if (!listEl) return;
  listEl.innerHTML = "";
  const safe = Array.isArray(entries) ? entries : [];
  for (const { entryIndex, rowIndex0 } of shotRows(safe)) {
    const entry = safe[entryIndex];
    const prevEntry = safe[entryIndex - 1];
    if (!entry || !isShotEntry(entry)) continue;
    listEl.appendChild(buildHistoryLine(entry, rowIndex0, activeRowIndex, prevEntry));
  }
  if (opts.showOutcome !== false && isGameTerminalForHistory(gameState, terminalSnapshot)) {
    listEl.appendChild(buildOutcomeLine(gameState, terminalSnapshot));
  }
}

export { mergePoolOutcomeTable };
