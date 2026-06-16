const TROPHY_PATH =
  "M8 2h8v2h5v3a5 5 0 0 1-5 5h-.21A6 6 0 0 1 13 15.92V18h3v2H8v-2h3v-2.08A6 6 0 0 1 8.21 12H8a5 5 0 0 1-5-5V4h5V2Zm0 8V6H5v1a3 3 0 0 0 3 3Zm11-3V6h-3v4a3 3 0 0 0 3-3Z";

interface OutcomeHeadline {
  draw?: boolean;
  name?: string;
  seat?: string;
  showBadge?: boolean;
}

interface OutcomeLineOptions extends OutcomeHeadline {
  reason?: string;
}

function appendOutcomeTrophy(parent: HTMLElement): void {
  const badge = document.createElement("span");
  badge.className = "history-outcome-trophy";
  badge.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", TROPHY_PATH);
  svg.appendChild(path);
  badge.appendChild(svg);
  parent.appendChild(badge);
}

export function appendOutcomeHeadline(parent: HTMLElement, headline: OutcomeHeadline): void {
  const row = document.createElement("div");
  row.className = "history-outcome-title";
  if (headline.draw) {
    const draw = document.createElement("span");
    draw.className = "history-outcome-draw";
    draw.textContent = "Draw";
    row.appendChild(draw);
    parent.appendChild(row);
    return;
  }

  const name = String(headline.name || "").trim();
  if (name) {
    const nameElement = document.createElement("span");
    nameElement.className = "history-outcome-name";
    nameElement.textContent = name;
    row.appendChild(nameElement);
  }
  const seat = String(headline.seat || "").trim();
  if (seat) {
    const seatElement = document.createElement("span");
    seatElement.className = "history-outcome-seat";
    seatElement.textContent = seat;
    row.appendChild(seatElement);
  }
  if (headline.showBadge !== false) {
    const badge = document.createElement("span");
    badge.className = "history-outcome-badge";
    badge.textContent = "Winner";
    row.appendChild(badge);
  }
  parent.appendChild(row);
}

export function buildHistoryOutcomeLine(options: OutcomeLineOptions): HTMLLIElement {
  const line = document.createElement("li");
  line.className = "history-outcome-line";
  line.setAttribute("aria-label", "Game result");

  const inner = document.createElement("div");
  inner.className = "history-outcome-inner";
  const copy = document.createElement("div");
  copy.className = "history-outcome-copy";
  appendOutcomeHeadline(copy, options);

  const reason = String(options.reason || "").trim();
  if (reason) {
    const detail = document.createElement("div");
    detail.className = "history-outcome-reason";
    detail.textContent = reason;
    copy.appendChild(detail);
  }
  inner.appendChild(copy);
  if (!options.draw) appendOutcomeTrophy(inner);
  line.appendChild(inner);
  return line;
}
