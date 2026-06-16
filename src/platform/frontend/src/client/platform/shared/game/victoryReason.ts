interface TerminalContext {
  reasonRaw?: unknown;
  winnerName?: unknown;
  loserName?: unknown;
  winnerColor?: unknown;
  youWon?: boolean;
  youLost?: boolean;
  shotBased?: boolean;
  isDraw?: boolean;
  p1Name?: unknown;
  p2Name?: unknown;
}

interface PoolTable extends Record<string, unknown> {
  p1_name?: unknown;
  p2_name?: unknown;
  status?: unknown;
  winner?: unknown;
  winner_message?: unknown;
}

interface TerminalResult extends Record<string, unknown> {
  reason?: unknown;
  status?: unknown;
  winner?: unknown;
}

interface PoolState {
  table?: PoolTable | null;
  result?: TerminalResult | null;
}

interface ChezzPlayer {
  username?: unknown;
}

interface ChezzState {
  board?: PoolTable | null;
  players?: { w?: ChezzPlayer; b?: ChezzPlayer } | null;
  result?: TerminalResult | null;
}

interface TerminalOutcome {
  title: string;
  subtitle: string;
  reasonCode: string;
}

export function normalizeReasonCode(raw: unknown): string {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function classifyTerminalReason(raw: unknown): string {
  const code = normalizeReasonCode(raw);
  const low = String(raw || "").trim().toLowerCase();

  if (code === "surrender" || code === "opponent_surrendered" || code === "game_ended") return "surrender";
  if (code === "inactivity_forfeit" || code === "inactivity") return "inactivity_forfeit";
  if (code === "time_forfeit") return "time_forfeit";
  if (code === "draw_agreed" || code === "draw") return "draw_agreed";
  if (code === "local_end" || code === "match_abandoned" || code === "abandon") return "local_end";
  if (code === "disconnect_forfeit") return "disconnect_forfeit";
  if (code === "checkmate") return "checkmate";
  if (code === "stalemate") return "stalemate";
  if (code === "eight_ball_win") return "eight_ball_win";
  if (code === "eight_ball_early") return "eight_ball_early";
  if (code === "eight_ball_scratch") return "eight_ball_scratch";

  if (low.includes("pocketed the 8-ball too early")) return "eight_ball_early";
  if (low.includes("scratched while pocketing the 8-ball")) return "eight_ball_scratch";
  if (low.includes("pocketed the 8-ball")) return "eight_ball_win";
  if (low.includes("time forfeit") || low.includes("ran out of time")) return "time_forfeit";
  if (low.includes("inactive") || low.includes("inactivity")) return "inactivity_forfeit";
  if (low.includes("resign") || low.includes("surrender")) return "surrender";
  if (low.includes("enemy king eliminated")) return "king_eliminated";
  if (low.includes("both kings eliminated")) return "draw_kings";
  if (low.includes("stalemate")) return "stalemate";
  if (low.startsWith("draw")) return "draw_agreed";

  return code || "unknown";
}

export function victoryReasonRaw(ctx: { result?: TerminalResult | null; table?: PoolTable | null }): string {
  const result = ctx?.result;
  const table = ctx?.table;
  return String(result?.reason || table?.winner_message || "").trim();
}

export function formatStandardTerminalReason(raw: unknown, perspective: TerminalContext = {}): string {
  return formatTerminalOutcome({
    reasonRaw: raw,
    youWon: perspective.youWon === true,
    youLost: perspective.youLost === true,
    shotBased: perspective.shotBased === true,
  }).subtitle;
}

function looksLikeInternalReasonCode(value: unknown): boolean {
  const text = String(value || "").trim();
  return /^[a-z][a-z0-9_]*$/.test(text) && text.includes("_");
}

function subtitleForReasonCode(code: string, ctx: TerminalContext): string {
  const win = String(ctx.winnerName || "").trim();
  const lose = String(ctx.loserName || "").trim();
  const youWon = ctx.youWon === true;
  const youLost = ctx.youLost === true;
  const shotBased = ctx.shotBased === true;

  switch (code) {
    case "surrender":
      if (youLost) return "You resigned.";
      if (youWon && lose) return `${lose} resigned.`;
      if (lose) return `${lose} resigned.`;
      if (win) return `${win} wins by resignation.`;
      return "Resignation.";
    case "inactivity_forfeit":
      if (youLost) return "You were inactive for 2 minutes — loss by forfeit.";
      if (youWon && lose) return `${lose} was inactive for 2 minutes.`;
      if (lose) return `${lose} was inactive for 2 minutes.`;
      return "Inactive for 2 minutes — game ended by forfeit.";
    case "time_forfeit":
      if (youLost) return "Your clock ran out.";
      if (youWon && lose) return `${lose} ran out of time.`;
      if (lose) return `${lose} ran out of time.`;
      return shotBased
        ? "Time ran out before the next shot was played."
        : "Time ran out before the next move was played.";
    case "eight_ball_win":
      return win ? `${win} pocketed the 8-ball legally.` : "The 8-ball was pocketed legally.";
    case "eight_ball_early":
      if (lose && win) return `${lose} pocketed the 8-ball too early — ${win} wins.`;
      if (lose) return `${lose} pocketed the 8-ball too early.`;
      if (win) return `${win} wins — opponent pocketed the 8-ball too early.`;
      return "The 8-ball was pocketed too early.";
    case "eight_ball_scratch":
      if (lose && win) return `${lose} scratched on the 8-ball — ${win} wins.`;
      if (lose) return `${lose} scratched on the 8-ball.`;
      if (win) return `${win} wins — foul on the 8-ball.`;
      return "Foul on the 8-ball.";
    case "local_end":
      return "Match ended on this device.";
    case "disconnect_forfeit":
      if (youLost) return "You were disconnected — loss awarded.";
      if (youWon && lose) return `${lose} disconnected — win awarded.`;
      return "Game ended due to disconnect.";
    case "checkmate":
      return win ? `${win} wins by checkmate.` : "Checkmate.";
    case "king_eliminated":
      return win ? `${win} wins — opponent's king was eliminated.` : "King eliminated.";
    case "draw_kings":
      return "Draw — both kings were eliminated.";
    case "stalemate":
      return "Stalemate — no legal moves remain.";
    case "draw_agreed":
      return "Draw agreed by both players.";
    default:
      return "";
  }
}

export function formatTerminalOutcome(ctx: TerminalContext = {}): TerminalOutcome {
  const reasonRaw = String(ctx.reasonRaw || "").trim();
  const code = classifyTerminalReason(reasonRaw);
  const win = String(ctx.winnerName || "").trim();
  const lose = String(ctx.loserName || "").trim();
  const isDraw = ctx.isDraw === true || code === "draw_agreed" || code === "stalemate";

  if (isDraw) {
    let subtitle = subtitleForReasonCode("draw_agreed", ctx);
    if (code === "stalemate") subtitle = subtitleForReasonCode("stalemate", ctx);
    else if (code === "draw_kings") subtitle = subtitleForReasonCode("draw_kings", ctx);
    else if (reasonRaw && !looksLikeInternalReasonCode(reasonRaw)) {
      subtitle = reasonRaw.endsWith(".") ? reasonRaw : `${reasonRaw}.`;
    }
    return { title: "Draw", subtitle, reasonCode: code };
  }

  const winnerColor = String(ctx.winnerColor || "").trim().toLowerCase();
  let title = "Game over";
  if (win) title = `${win} wins`;
  else if (winnerColor === "w") title = "White wins";
  else if (winnerColor === "b") title = "Black wins";

  const copyCtx = {
    reasonRaw,
    winnerName: win,
    loserName: lose,
    winnerColor,
    youWon: ctx.youWon === true,
    youLost: ctx.youLost === true,
    shotBased: ctx.shotBased === true,
    p1Name: ctx.p1Name,
    p2Name: ctx.p2Name,
  };

  let subtitle = subtitleForReasonCode(code, copyCtx);
  if (!subtitle && reasonRaw && !looksLikeInternalReasonCode(reasonRaw)) {
    subtitle = reasonRaw.replace(/^game over!\s*/i, "").trim();
    if (subtitle && !subtitle.endsWith(".")) subtitle = `${subtitle}.`;
  }

  if (!subtitle || subtitle === reasonRaw || looksLikeInternalReasonCode(subtitle)) {
    subtitle = subtitleForReasonCode(code, copyCtx)
      || subtitleForReasonCode(classifyTerminalReason(code), copyCtx)
      || "The game has ended.";
  }

  return { title, subtitle, reasonCode: code };
}

export function poolOpponentName(winnerName: unknown, table?: PoolTable | null): string {
  const win = String(winnerName || table?.winner || "").trim();
  const p1 = String(table?.p1_name || "Player 1").trim();
  const p2 = String(table?.p2_name || "Player 2").trim();
  if (!win) return "";
  if (win === p1) return p2;
  if (win === p2) return p1;
  return "";
}

export function terminalOutcomeFromPoolState(
  state?: PoolState | null,
  opts: { selfName?: unknown } = {},
): TerminalOutcome {
  const table = state?.table || {};
  const result = state?.result || {};
  const winnerName = String(table.winner || result.winner || "").trim();
  const selfName = String(opts.selfName || "").trim();
  const loserName = poolOpponentName(winnerName, table);
  const youWon = Boolean(winnerName && selfName && winnerName === selfName);
  const youLost = Boolean(winnerName && selfName && winnerName !== selfName);
  const isDraw = String(result.status || table.status || "").toLowerCase() === "draw"
    || normalizeReasonCode(victoryReasonRaw({ table, result })) === "draw_agreed";

  return formatTerminalOutcome({
    reasonRaw: victoryReasonRaw({ table, result }),
    winnerName,
    loserName,
    youWon,
    youLost,
    shotBased: true,
    isDraw,
    p1Name: table.p1_name,
    p2Name: table.p2_name,
  });
}

export function terminalOutcomeFromChezzState(
  state?: ChezzState | null,
  opts: { youColor?: unknown } = {},
): TerminalOutcome {
  const result = state?.result || {};
  const winner = result.winner;
  const players = state?.players || {};
  const you = String(opts.youColor || "").trim().toLowerCase();
  const opp = you === "w" ? "b" : you === "b" ? "w" : "";
  const winInfo = winner === "w" ? players.w : winner === "b" ? players.b : null;
  const loseInfo = opp === "w" ? players.w : opp === "b" ? players.b : null;
  const winnerName = String(winInfo?.username || "").trim();
  const loserName = String(loseInfo?.username || "").trim();
  const youWon = Boolean(winner && winner !== "draw" && you && winner === you);
  const youLost = Boolean(winner && winner !== "draw" && you && winner !== you);
  const isDraw = !winner || winner === "draw"
    || String(result.status || "").toLowerCase() === "draw";

  return formatTerminalOutcome({
    reasonRaw: victoryReasonRaw({ result, table: state?.board }),
    winnerName,
    loserName,
    winnerColor: winner === "w" || winner === "b" ? winner : "",
    youWon,
    youLost,
    shotBased: false,
    isDraw,
  });
}

export function mergePoolOutcomeTable(
  gameState?: PoolState | null,
  terminalSnapshot?: Record<string, unknown> | null,
): Record<string, unknown> {
  const snap = terminalSnapshot && typeof terminalSnapshot === "object" ? terminalSnapshot : {};
  const live = gameState?.table && typeof gameState.table === "object" ? gameState.table : {};
  const table = { ...snap, ...live };
  const reason = gameState?.result?.reason;
  if (reason) table.winner_message = String(reason);
  return table;
}
