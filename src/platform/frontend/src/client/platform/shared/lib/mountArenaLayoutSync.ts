import { MQ_MOBILE } from "./arenaMq.js";

interface ArenaLayoutOptions {
  gameAppEl: HTMLElement | null;
  playfieldEl?: HTMLElement | null;
  arenaLayoutEvent: string;
  scheduleFit(): void;
  onBreakpointClear?: (() => void) | null;
  beforeSync?: (() => void) | null;
  hudPadMin?: number;
  hudPadExtra?: number;
  watchVisibility?: boolean;
}

export function mountArenaLayoutSync(opts: ArenaLayoutOptions): () => void {
  const {
    gameAppEl,
    playfieldEl = null,
    arenaLayoutEvent,
    scheduleFit,
    onBreakpointClear = null,
    beforeSync = null,
    hudPadMin = 48,
    hudPadExtra = 0,
    watchVisibility = false,
  } = opts;

  if (!gameAppEl || typeof scheduleFit !== "function") {
    return () => {};
  }
  const appEl = gameAppEl;

  const mq = window.matchMedia(MQ_MOBILE);

  function syncHudPad(): void {
    if (!mq.matches) {
      appEl.style.removeProperty("--board-mobile-hud-pad");
      return;
    }
    const hud = appEl.querySelector(".game-mobile-board-hud");
    if (!hud) return;
    const hudBar = hud.querySelector(".game-mobile-board-hud-bar");
    const h = Math.ceil((hudBar || hud).getBoundingClientRect().height);
    const pad = Math.max(hudPadMin, h + hudPadExtra);
    appEl.style.setProperty("--board-mobile-hud-pad", `${pad}px`);
  }

  function syncAll(): void {
    if (typeof beforeSync === "function") beforeSync();
    syncHudPad();
    scheduleFit();
  }

  const onLayout = () => syncAll();
  const onBreakpointChange = () => {
    if (typeof onBreakpointClear === "function") onBreakpointClear();
    syncAll();
  };

  syncAll();
  queueMicrotask(syncAll);
  requestAnimationFrame(syncAll);

  let visObs: MutationObserver | null = null;
  if (watchVisibility && typeof MutationObserver !== "undefined") {
    const onVisible = () => {
      if (!appEl.classList.contains("hidden")) syncAll();
    };
    visObs = new MutationObserver(onVisible);
    visObs.observe(appEl, { attributes: true, attributeFilter: ["class"] });
  }

  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onBreakpointChange);
  } else if (typeof mq.addListener === "function") {
    mq.addListener(onBreakpointChange);
  }

  window.addEventListener("resize", onLayout, { passive: true });
  window.addEventListener("orientationchange", onLayout, { passive: true });
  window.addEventListener(arenaLayoutEvent, onLayout, { passive: true });
  const vv = window.visualViewport;
  vv?.addEventListener("resize", onLayout, { passive: true });

  const hud = appEl.querySelector(".game-mobile-board-hud");
  const boardPanel = playfieldEl?.closest(".board-panel");
  const arenaFrame = playfieldEl?.closest(".arena-frame");
  const boardMiddle = playfieldEl?.closest(".board-middle");

  let roHud: ResizeObserver | null = null;
  let roApp: ResizeObserver | null = null;
  let roPanel: ResizeObserver | null = null;
  let roArena: ResizeObserver | null = null;
  let roMiddle: ResizeObserver | null = null;

  if (typeof ResizeObserver !== "undefined") {
    roApp = new ResizeObserver(() => syncAll());
    roApp.observe(appEl);
    if (hud) {
      roHud = new ResizeObserver(() => syncAll());
      roHud.observe(hud);
    }
    if (boardPanel) {
      roPanel = new ResizeObserver(() => syncAll());
      roPanel.observe(boardPanel);
    }
    if (arenaFrame) {
      roArena = new ResizeObserver(() => syncAll());
      roArena.observe(arenaFrame);
    }
    if (boardMiddle) {
      roMiddle = new ResizeObserver(() => syncAll());
      roMiddle.observe(boardMiddle);
    }
  }

  return () => {
    if (typeof mq.removeEventListener === "function") {
      mq.removeEventListener("change", onBreakpointChange);
    } else if (typeof mq.removeListener === "function") {
      mq.removeListener(onBreakpointChange);
    }
    window.removeEventListener("resize", onLayout);
    window.removeEventListener("orientationchange", onLayout);
    window.removeEventListener(arenaLayoutEvent, onLayout);
    vv?.removeEventListener("resize", onLayout);
    visObs?.disconnect();
    roHud?.disconnect();
    roApp?.disconnect();
    roPanel?.disconnect();
    roArena?.disconnect();
    roMiddle?.disconnect();
    appEl.style.removeProperty("--board-mobile-hud-pad");
  };
}
