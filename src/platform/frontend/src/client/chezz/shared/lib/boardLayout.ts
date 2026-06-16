import { MQ_MOBILE } from "../../../platform/shared/lib/arenaMq.js";
import { mountArenaLayoutSync } from "../../../platform/shared/lib/mountArenaLayoutSync.js";

type BoardLayoutDeps = {
  boardEl?: HTMLElement | null;
  gameAppEl?: HTMLElement | null;
};

function pxNumber(value: unknown): number {
  const parsed = Number.parseFloat(String(value || "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMobileLayout(): boolean {
  return window.matchMedia(MQ_MOBILE).matches;
}

export function createBoardLayoutHelpers({
  boardEl = null,
  gameAppEl = null,
}: BoardLayoutDeps = {}) {
  let boardFitRafId: number | null = null;
  let layoutPass = 0;

  function clearExactBoardSizeLock(): void {
    if (!boardEl) {
      return;
    }
    boardEl.style.removeProperty("width");
    boardEl.style.removeProperty("height");
    boardEl.style.removeProperty("max-width");
    boardEl.style.removeProperty("max-height");
    boardEl.classList.remove("chezz-board-sized");
  }

  function applyExactBoardSizeLock(sizePx: number): void {
    if (!boardEl) {
      return;
    }
    const side = Math.max(0, Number(sizePx) || 0);
    if (!side) {
      return;
    }
    boardEl.style.width = `${side}px`;
    boardEl.style.height = `${side}px`;
    boardEl.style.maxWidth = "100%";
    boardEl.style.maxHeight = "100%";
    boardEl.classList.add("chezz-board-sized");
  }

  function applyBoardViewportFit(): void {
    if (!boardEl || !gameAppEl) {
      return;
    }
    if (gameAppEl.classList.contains("hidden")) {
      scheduleBoardViewportFit();
      return;
    }

    const arenaFrameEl = boardEl.closest<HTMLElement>(".arena-frame");
    const boardMiddleEl = boardEl.closest<HTMLElement>(".board-middle");
    const boardPanelEl = arenaFrameEl?.closest<HTMLElement>(".board-panel") || null;
    if (!arenaFrameEl || !boardMiddleEl) {
      return;
    }

    const pass = ++layoutPass;

    const topRowEl = arenaFrameEl.querySelector<HTMLElement>(".board-player-row-top");
    const bottomRowEl = arenaFrameEl.querySelector<HTMLElement>(".board-player-row-bottom");
    const legendEl = arenaFrameEl.querySelector<HTMLElement>(".board-legend");
    const topRowStyles = topRowEl ? window.getComputedStyle(topRowEl) : null;
    const bottomRowStyles = bottomRowEl ? window.getComputedStyle(bottomRowEl) : null;
    const legendStyles = legendEl ? window.getComputedStyle(legendEl) : null;

    const frameStyles = window.getComputedStyle(arenaFrameEl);
    const framePaddingY =
      pxNumber(frameStyles.paddingTop) + pxNumber(frameStyles.paddingBottom);
    const framePaddingX =
      pxNumber(frameStyles.paddingLeft) + pxNumber(frameStyles.paddingRight);
    const rowGap =
      pxNumber(frameStyles.rowGap)
      || pxNumber(frameStyles.columnGap)
      || pxNumber(frameStyles.gap)
      || 0;
    const betweenRowsGap = 2 * rowGap;

    const topRowGapY = topRowStyles
      ? pxNumber(topRowStyles.marginTop) + pxNumber(topRowStyles.marginBottom)
      : 0;
    const bottomRowGapY = bottomRowStyles
      ? pxNumber(bottomRowStyles.marginTop) + pxNumber(bottomRowStyles.marginBottom)
      : 0;
    const legendGapY = legendStyles
      ? pxNumber(legendStyles.marginTop) + pxNumber(legendStyles.marginBottom)
      : 0;

    let playW = Math.max(
      boardMiddleEl.clientWidth,
      arenaFrameEl.clientWidth - framePaddingX,
    );

    if (isMobileLayout() && boardPanelEl) {
      const panelStyles = getComputedStyle(boardPanelEl);
      const padX =
        pxNumber(panelStyles.paddingLeft) + pxNumber(panelStyles.paddingRight);
      playW = Math.max(playW, boardPanelEl.clientWidth - padX - framePaddingX);
    }

    let playH = boardMiddleEl.clientHeight;
    if (playH < 80) {
      const innerH = Math.max(0, arenaFrameEl.clientHeight - framePaddingY);
      playH =
        innerH
        - (topRowEl?.offsetHeight || 0)
        - (bottomRowEl?.offsetHeight || 0)
        - (legendEl?.offsetHeight || 0)
        - topRowGapY
        - bottomRowGapY
        - legendGapY
        - betweenRowsGap;
    }

    if (playH < 80 || playW < 120) {
      scheduleBoardViewportFit();
      return;
    }

    const size = Math.floor(Math.min(playW, playH) / 8) * 8;
    if (!Number.isFinite(size) || size < 120) {
      clearExactBoardSizeLock();
      document.documentElement.style.removeProperty("--board-size");
      return;
    }

    if (pass !== layoutPass) {
      return;
    }

    document.documentElement.style.setProperty("--board-size", `${size}px`);
    applyExactBoardSizeLock(size);
  }

  function scheduleBoardViewportFit(): void {
    if (boardFitRafId != null) {
      window.cancelAnimationFrame(boardFitRafId);
    }
    boardFitRafId = window.requestAnimationFrame(() => {
      boardFitRafId = window.requestAnimationFrame(() => {
        boardFitRafId = null;
        applyBoardViewportFit();
      });
    });
  }

  return {
    applyBoardViewportFit,
    scheduleBoardViewportFit,
    clearExactBoardSizeLock,
  };
}

export function mountChezzArenaLayoutSync(boardEl: HTMLElement, gameAppEl: HTMLElement): () => void {
  const layout = createBoardLayoutHelpers({ boardEl, gameAppEl });
  const unmount = mountArenaLayoutSync({
    gameAppEl,
    playfieldEl: boardEl,
    arenaLayoutEvent: "chezz-arena-layout",
    scheduleFit: () => layout.scheduleBoardViewportFit(),
    onBreakpointClear: () => layout.clearExactBoardSizeLock(),
    hudPadMin: 48,
    hudPadExtra: 0,
    watchVisibility: true,
  });
  return () => {
    unmount();
    layout.clearExactBoardSizeLock();
    document.documentElement.style.removeProperty("--board-size");
  };
}
