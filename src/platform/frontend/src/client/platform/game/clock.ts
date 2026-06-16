const ENGINE_USER_ID = "engine";

interface ClockState {
  status?: string;
  you_color?: string | null;
  you_seat?: string | null;
  self_user_id?: string | null;
  players?: {
    w?: { user_id?: string | null };
    b?: { user_id?: string | null };
  };
  clock_a_ms?: number;
  clock_b_ms?: number;
  clock_active_color?: string | null;
  clock_anchor_iso?: string | null;
  [key: string]: unknown;
}

function formatPoolGroupLabel(raw: unknown): string | null {
  const group = String(raw || "").trim().toLowerCase();
  if (group === "solid" || group === "solids") return "Solids";
  if (group === "stripe" || group === "stripes") return "Stripes";
  return null;
}

function asClockLabel(raw: unknown, fallback: string): string {
  const value = String(raw || "").trim();
  return value || fallback;
}

function poolClockLabels(state: ClockState): { a: string; b: string } | null {
  const table = state["table"];
  if (!table || typeof table !== "object") return null;
  const record = table as Record<string, unknown>;

  const hasPoolSeats = Boolean(
    record["p1_name"]
    || record["p2_name"]
    || record["player1_id"]
    || record["player2_id"],
  );
  if (!hasPoolSeats) return null;

  const aGroup = formatPoolGroupLabel(record["p1_playing"]);
  const bGroup = formatPoolGroupLabel(record["p2_playing"]);
  return {
    a: aGroup || asClockLabel(record["p1_name"], "Player 1"),
    b: bGroup || asClockLabel(record["p2_name"], "Player 2"),
  };
}

interface ClockStore {
  getState(): ClockState | null | undefined;
}

interface ClockRenderer {
  renderClocks(state: ClockState): void;
}

function formatClock(ms: unknown): string {
  const safe = Math.max(0, Math.floor(Number(ms) || 0));
  const totalSec = safe / 1000;
  const mins = Math.floor(totalSec / 60);
  if (safe < 10000) {
    const secs = totalSec - mins * 60;
    return `${mins}:${secs.toFixed(1).padStart(4, "0")}`;
  }
  const secs = Math.floor(totalSec - mins * 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function effectiveYouColor(state: ClockState | null | undefined): "w" | "b" {
  const y = state?.you_color;
  if (y === "w" || y === "b") return y;

  if (state?.you_seat === "player2") return "b";
  if (state?.you_seat === "player1") return "w";

  const selfId = String(state?.self_user_id || "").toLowerCase().trim();
  if (selfId) {
    const wId = String(state?.players?.w?.user_id || "").toLowerCase();
    const bId = String(state?.players?.b?.user_id || "").toLowerCase();
    if (wId === selfId) return "w";
    if (bId === selfId) return "b";
  }

  const wId = String(state?.players?.w?.user_id || "").toLowerCase();
  const bId = String(state?.players?.b?.user_id || "").toLowerCase();
  if (wId === ENGINE_USER_ID && bId && bId !== ENGINE_USER_ID) return "b";
  if (bId === ENGINE_USER_ID && wId && wId !== ENGINE_USER_ID) return "w";
  return "w";
}

export function renderClocks(state: ClockState | null | undefined): void {
  if (!state || typeof state !== "object") return;

  const whiteMs = Number(state.clock_a_ms) || 0;
  const blackMs = Number(state.clock_b_ms) || 0;
  const activeColor = state.clock_active_color;
  const you = effectiveYouColor(state);
  const oppMs = you === "b" ? whiteMs : blackMs;
  const yourMs = you === "b" ? blackMs : whiteMs;

  const poolLabels = poolClockLabels(state);
  const sideALabel = poolLabels?.a || "White";
  const sideBLabel = poolLabels?.b || "Black";
  const whiteText = `${sideALabel}: ${formatClock(whiteMs)}`;
  const blackText = `${sideBLabel}: ${formatClock(blackMs)}`;
  const whiteEl = document.getElementById("clock-white");
  const blackEl = document.getElementById("clock-black");
  if (whiteEl) {
    whiteEl.textContent = whiteText;
    whiteEl.classList.toggle("active", activeColor === "w");
    whiteEl.classList.remove("is-active");
  }
  if (blackEl) {
    blackEl.textContent = blackText;
    blackEl.classList.toggle("active", activeColor === "b");
    blackEl.classList.remove("is-active");
  }

  const rowEl = document.getElementById("game-clock-row");
  if (rowEl) rowEl.classList.remove("hidden");

  const profileTop = document.getElementById("clock-profile-top");
  const profileBottom = document.getElementById("clock-profile-bottom");
  const profileTopWrap = document.getElementById("clock-profile-top-wrap");
  const profileBottomWrap = document.getElementById("clock-profile-bottom-wrap");
  if (profileTop) profileTop.textContent = formatClock(oppMs);
  if (profileBottom) profileBottom.textContent = formatClock(yourMs);
  if (profileTopWrap) profileTopWrap.classList.remove("hidden");
  if (profileBottomWrap) profileBottomWrap.classList.remove("hidden");
}

export function createClockTicker({
  store,
  render,
}: {
  store: ClockStore;
  render: ClockRenderer;
}): { start: () => void; stop: () => void } {
  let rafHandle = 0;
  let running = false;

  function tick(): void {
    if (!running) return;
    const state = store.getState();
    if (!state) {
      rafHandle = window.requestAnimationFrame(tick);
      return;
    }
    if (state.status === "finished" || state.status === "draw") {
      render.renderClocks(state);
      rafHandle = window.requestAnimationFrame(tick);
      return;
    }

    const anchorIso = state.clock_anchor_iso;
    const anchorMs = anchorIso ? Date.parse(anchorIso) : NaN;
    const elapsed = Number.isFinite(anchorMs) ? Math.max(0, Date.now() - anchorMs) : 0;

    const whiteBase = Number(state.clock_a_ms) || 0;
    const blackBase = Number(state.clock_b_ms) || 0;
    const active = state.clock_active_color;

    const whiteDisplay = active === "w" ? Math.max(0, whiteBase - elapsed) : whiteBase;
    const blackDisplay = active === "b" ? Math.max(0, blackBase - elapsed) : blackBase;

    render.renderClocks({
      ...state,
      clock_a_ms: whiteDisplay,
      clock_b_ms: blackDisplay,
      clock_active_color: active,
    });
    rafHandle = window.requestAnimationFrame(tick);
  }

  function start(): void {
    if (running) return;
    running = true;
    rafHandle = window.requestAnimationFrame(tick);
  }

  function stop(): void {
    running = false;
    if (rafHandle) {
      window.cancelAnimationFrame(rafHandle);
      rafHandle = 0;
    }
  }

  return { start, stop };
}
