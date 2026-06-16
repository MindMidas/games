import { HISTORY_HAZARD_GLYPH } from "./historyView.js";

const PIECES_BASE = "/static/games/chezz/assets/pieces";

type RuleGraphic = "hazard" | "clock" | "move";

interface RuleCardConfig {
  icon?: string | null;
  graphic?: RuleGraphic;
  title: string;
  body: string;
  bodyExtra?: string;
  descExtra?: string;
  note?: string;
}

interface PieceRowConfig {
  codes: string[];
  label: string;
  desc: string;
  descExtra?: string;
}

const RULE_GRAPHIC_HTML: Record<RuleGraphic, string> = {
  hazard: `<span class="history-hazard" aria-hidden="true">${HISTORY_HAZARD_GLYPH}</span>`,
  clock: `<svg class="rule-graphic-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.35"/>
    <path d="M12 7.2V12l3.6 2.4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="12" cy="12" r="1" fill="currentColor"/>
  </svg>`,
  move: `<svg class="rule-graphic-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="2.5" y="11" width="8" height="8" rx="1.2" stroke="currentColor" stroke-width="1.35"/>
    <rect x="13.5" y="5" width="8" height="8" rx="1.2" stroke="currentColor" stroke-width="1.35" fill="currentColor" fill-opacity="0.18"/>
  </svg>`,
};

function makeCard(cfg: RuleCardConfig): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "rule-card";

  const iconWell = document.createElement("div");
  iconWell.className = "rule-icon-well";
  if (cfg.graphic) {
    iconWell.classList.add("rule-icon-well--graphic");
    const wrap = document.createElement("span");
    wrap.className = "rule-graphic-wrap";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML = RULE_GRAPHIC_HTML[cfg.graphic];
    iconWell.appendChild(wrap);
  } else if (cfg.icon) {
    const img = document.createElement("img");
    img.className = "rule-icon";
    img.src = `${PIECES_BASE}/${cfg.icon}.png`;
    img.alt = cfg.title;
    iconWell.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "rule-icon rule-icon--placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    iconWell.appendChild(placeholder);
  }
  card.appendChild(iconWell);

  const body = document.createElement("div");
  body.className = "rule-body";

  const h = document.createElement("h4");
  h.textContent = cfg.title;
  body.appendChild(h);

  const p = document.createElement("p");
  p.textContent = cfg.body;
  body.appendChild(p);

  if (cfg.bodyExtra) {
    const p2 = document.createElement("p");
    p2.textContent = cfg.bodyExtra;
    body.appendChild(p2);
  }

  if (cfg.note) {
    const note = document.createElement("p");
    note.className = "rule-capture-note";
    note.textContent = cfg.note;
    body.appendChild(note);
  }

  card.appendChild(body);
  return card;
}

function makeSection(label: string): HTMLParagraphElement {
  const el = document.createElement("p");
  el.className = "rulebook-section-label";
  el.textContent = label;
  return el;
}

function makePieceRow(cfg: PieceRowConfig): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "rule-card rule-card--pair-row";

  const icons = document.createElement("div");
  icons.className = "rule-icon-well rule-icon-well--pieces";
  if (cfg.codes.length === 1) {
    icons.classList.add("rule-icon-well--solo");
  }
  for (const code of cfg.codes) {
    const img = document.createElement("img");
    img.className = "rule-icon";
    img.src = `${PIECES_BASE}/${code}.png`;
    img.alt = code;
    icons.appendChild(img);
  }
  card.appendChild(icons);

  const body = document.createElement("div");
  body.className = "rule-body";
  const h = document.createElement("h4");
  h.textContent = cfg.label;
  body.appendChild(h);
  const p = document.createElement("p");
  p.textContent = cfg.desc;
  body.appendChild(p);
  if (cfg.descExtra) {
    const p2 = document.createElement("p");
    p2.textContent = cfg.descExtra;
    body.appendChild(p2);
  }
  card.appendChild(body);
  return card;
}

export function mountRulebook(root: HTMLElement | null): void {
  if (!root) {
    return;
  }
  root.textContent = "";

  root.appendChild(makeSection("Controls"));
  root.appendChild(makeCard({
    graphic: "move",
    title: "Move",
    body: "Tap your piece, then tap a highlighted square to move or capture.",
    note: "Cannon and catapult use special actions — see below.",
  }));

  root.appendChild(makeSection("Goal"));
  root.appendChild(makeCard({
    icon: "wK",
    title: "Capture the King",
    body: "Eliminate the opponent's king to win. There is no check or checkmate — you may expose your own king freely. The game ends when only one king remains.",
    note: "If a single action removes both kings simultaneously, the result is a draw.",
  }));

  root.appendChild(makeSection("Classic Pieces"));
  root.appendChild(makePieceRow({
    codes: ["wK"],
    label: "King — K",
    desc: "Moves one square in any direction.",
    descExtra: "Capture: move onto an enemy piece.",
  }));
  root.appendChild(makePieceRow({
    codes: ["wQ"],
    label: "Queen — Q",
    desc: "Slides any distance in a straight line: rank, file, or diagonal.",
    descExtra: "Capture: move onto the first enemy piece that blocks you in that line.",
  }));
  root.appendChild(makePieceRow({
    codes: ["wR"],
    label: "Rook — R",
    desc: "Slides any distance along a rank or file.",
    descExtra: "Capture: move onto the first enemy piece that blocks you in that rank or file.",
  }));
  root.appendChild(makePieceRow({
    codes: ["wB"],
    label: "Bishop — B",
    desc: "Slides any distance diagonally.",
    descExtra: "Capture: move onto the first enemy piece that blocks you in that diagonal line.",
  }));
  root.appendChild(makePieceRow({
    codes: ["wN"],
    label: "Knight — N",
    desc: "Jumps in an L-shape and may hop over pieces.",
    descExtra: "Capture: land on a square with an enemy piece.",
  }));
  root.appendChild(makePieceRow({
    codes: ["wP"],
    label: "Peon — P",
    desc: "Moves one square straight forward to an empty square. No double-step, no en passant.",
    descExtra: "Capture: one square diagonally forward onto an enemy piece.",
  }));

  root.appendChild(makeSection("Special Pieces"));
  root.appendChild(makeCard({
    icon: "wZ",
    title: "Zombie — Z",
    body: "Moves one square orthogonally (not diagonal). Moves onto an empty square or captures an enemy piece.",
    descExtra: "Capture: move on a square with an enemy piece.",
  }));
  root.appendChild(makeCard({
    icon: "wC",
    title: "Cannon — C",
    body: "Moves one square orthogonally to an empty square only (no capture).",
    bodyExtra: "Shoot: tap your cannon, then tap any square on the highlighted diagonal to fire in that direction. The ball removes every piece on that line, including yours.",
  }));

  root.appendChild(makeCard({
    icon: "wF",
    title: "Catapult — F",
    body: "Moves one square in any direction to an empty square only (no capture).",
    bodyExtra:
      "Fling: click the catapult, select an adjacent friendly piece (payload), then select a target from the highlighted target squares. The payload moves there; landing on an enemy captures it and destroys the payload.",
    note: "You cannot fling a piece onto the enemy king's square.",
  }));

  root.appendChild(makeSection("Other rules"));
  root.appendChild(makeCard({
    icon: "wP",
    title: "Peon promotion",
    body: "When your peon reaches the far rank (the last rank from your side), it promotes into a zombie of your color.",
    note: "Same as reaching the back row: white promotes on rank 8, black on rank 1.",
  }));
  root.appendChild(makeCard({
    graphic: "hazard",
    title: "Zombie Contagion",
    body: "At the end of each turn, contagion spreads from your zombies: every orthogonally adjacent enemy piece becomes a zombie of your color.",
    note: "Kings and enemy zombies never catch contagion.",
  }));
  root.appendChild(makeCard({
    graphic: "clock",
    title: "Clock",
    body: "Each player has a shared time bank. Your clock runs on your turn; it stops when you move. Running out of time forfeits the game.",
    note: "If you are inactive for 2 minutes (no mouse or keyboard activity), you automatically surrender.",
  }));
}
