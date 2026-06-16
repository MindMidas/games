/** Landscape display aspect: (TABLE_LENGTH + rails) / (TABLE_WIDTH + rails). */
export const TABLE_VIEW_ASPECT = 2956 / 1606;

/** Portrait display aspect (table rotated 90 degrees on narrow phones). */
export const TABLE_VIEW_ASPECT_PORTRAIT = 1606 / 2956;

import { MQ_MOBILE } from "../../../platform/shared/lib/arenaMq.js";
import { mountArenaLayoutSync } from "../../../platform/shared/lib/mountArenaLayoutSync.js";

/** Portrait flip only on narrow phones (not tablet portrait). */
const PORTRAIT_FLIP_MAX_WIDTH_PX = 640;

/** Desktop board column cap (matches pool-game-parity.css). */
const DESKTOP_BOARD_MAX_PX = 980;

/** Design shell width (pool-shell.css --game-app-max-width). */
const GAME_APP_MAX_PX = 1360;

/** Reference viewport height for UI scale on tall displays. */
const GAME_SHELL_REF_HEIGHT_PX = 820;

interface TableLayoutDependencies {
  tableEl?: HTMLElement | null;
  gameAppEl?: HTMLElement | null;
}

interface TableSizeOptions {
  portrait?: boolean;
}

interface Size {
  w: number;
  h: number;
}

export function createTableLayoutHelpers(deps: TableLayoutDependencies = {}) {
  const { tableEl, gameAppEl } = deps;
  let tableFitRafId: number | null = null;
  let layoutPass = 0;

  function pxNumber(value: unknown): number {
    const parsed = Number.parseFloat(String(value || "0"));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function tableBboxEl(): HTMLElement | null {
    return tableEl?.parentElement?.classList?.contains("pool-table-bbox")
      ? tableEl.parentElement
      : null;
  }

  function clearExactTableSizeLock(): void {
    if (!tableEl) {
      return;
    }
    tableEl.style.removeProperty("width");
    tableEl.style.removeProperty("height");
    tableEl.style.removeProperty("max-width");
    tableEl.style.removeProperty("max-height");
    const bbox = tableBboxEl();
    if (bbox) {
      bbox.style.removeProperty("width");
      bbox.style.removeProperty("height");
    }
  }

  function clearSizingState(): void {
    clearExactTableSizeLock();
    tableEl?.classList.remove("pool-table-sized", "pool-table-portrait");
    document.documentElement.style.removeProperty("--table-size-w");
    document.documentElement.style.removeProperty("--table-size-h");
    document.documentElement.style.removeProperty("--board-size");
    document.documentElement.style.removeProperty("--table-portrait-visual-w");
    document.documentElement.style.removeProperty("--table-portrait-visual-h");
  }

  function applyExactTableSizeLock(
    widthPx: number,
    heightPx: number,
    opts: TableSizeOptions = {},
  ): void {
    if (!tableEl) {
      return;
    }
    const w = Math.max(0, Number(widthPx) || 0);
    const h = Math.max(0, Number(heightPx) || 0);
    if (!w || !h) {
      return;
    }
    tableEl.style.width = `${w}px`;
    tableEl.style.height = `${h}px`;
    if (opts.portrait) {
      /* Pre-rotation W > H; max-width:100% was shrinking visual height after rotate. */
      tableEl.style.maxWidth = "none";
      tableEl.style.maxHeight = "none";
    } else {
      tableEl.style.maxWidth = "100%";
      tableEl.style.maxHeight = "100%";
    }
  }

  function isMobileLayout(): boolean {
    return window.matchMedia(MQ_MOBILE).matches;
  }

  function viewportSize(): Size {
    const vv = window.visualViewport;
    return {
      w: Math.round(vv?.width ?? window.innerWidth),
      h: Math.round(vv?.height ?? window.innerHeight),
    };
  }

  function mobileHudPadPx(): number {
    if (!gameAppEl) {
      return 0;
    }
    return pxNumber(getComputedStyle(gameAppEl).getPropertyValue("--board-mobile-hud-pad"));
  }

  /** Match pool-shell.css breakpoint scale factors. */
  function mediaScaleFactor(): number {
    const w = window.innerWidth;
    if (w <= 760) {
      return 0.82;
    }
    if (w <= 980) {
      return 0.86;
    }
    if (w <= 1180) {
      return 0.9;
    }
    if (w <= 1320) {
      return 0.94;
    }
    if (w <= 1480) {
      return 0.97;
    }
    return 1;
  }

  function clearGameShellScale(): void {
    const root = document.documentElement;
    root.style.removeProperty("--game-ui-scale");
    root.style.removeProperty("--game-side-effective");
    root.style.removeProperty("--board-profile-row-height");
    root.style.removeProperty("--game-scale-font");
    root.style.removeProperty("--game-scale-control");
    root.style.removeProperty("--game-scale-avatar");
  }

  /** Scale profile rows, side menu type, and side column width without overflow. */
  function syncGameShellScale(): void {
    if (isMobileLayout()) {
      clearGameShellScale();
      return;
    }

    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const rem = pxNumber(styles.fontSize) || 16;
    const sideMax = pxNumber(styles.getPropertyValue("--game-side-width")) || 492;
    const appW = gameAppEl?.clientWidth || 0;
    const appH = gameAppEl?.clientHeight || window.innerHeight;
    if (!appW || !appH) {
      return;
    }

    const padX = 2.1 * rem + 0.75 * rem;
    const sideCol = Math.min(sideMax, Math.max(280, Math.floor(appW * 0.36)));
    const scaleW = Math.min(1, appW / GAME_APP_MAX_PX);
    const scaleH = Math.min(1, appH / GAME_SHELL_REF_HEIGHT_PX);
    const uiScale = Math.max(0.78, Math.min(mediaScaleFactor(), scaleW, scaleH));

    root.style.setProperty("--game-ui-scale", String(uiScale));
    root.style.setProperty("--game-scale-font", String(uiScale));
    root.style.setProperty("--game-scale-control", String(uiScale));
    root.style.setProperty("--game-scale-avatar", String(uiScale));
    root.style.setProperty("--game-side-effective", `${sideCol}px`);
    root.style.setProperty("--board-profile-row-height", `${Math.round(72 * uiScale)}px`);
    root.style.setProperty(
      "--board-profile-chrome-height",
      `${Math.round(144 * uiScale)}px`,
    );
  }

  /** Largest aspect-preserving table that fits inside the playfield. */
  function fitContainBox(boxW: number, boxH: number, aspect: number): Size {
    const wIfFullH = boxH * aspect;
    if (wIfFullH <= boxW) {
      return { w: wIfFullH, h: boxH };
    }
    return { w: boxW, h: boxW / aspect };
  }

  /** Rotate the table only on narrow portrait phones. */
  function shouldUsePortraitTable(): boolean {
    if (!isMobileLayout()) {
      return false;
    }
    const { w, h } = viewportSize();
    return w < h && w <= PORTRAIT_FLIP_MAX_WIDTH_PX;
  }

  /** Fill portrait playfield height so the table reaches both profile rows. */
  function fitPortraitFillHeight(boxH: number, aspect: number): Size {
    const h = Math.max(0, boxH);
    const w = h * aspect;
    return { w, h };
  }

  /** Largest aspect-preserving table that covers the playfield. */
  function fitCoverBox(boxW: number, boxH: number, aspect: number): Size {
    const wIfFullH = boxH * aspect;
    if (wIfFullH >= boxW) {
      return { w: wIfFullH, h: boxH };
    }
    return { w: boxW, h: boxW / aspect };
  }

  /** Mobile playfield from board-panel content box (avoids double-counting menu HUD pad). */


  function computeMobilePlayfield(
    boardPanelEl: HTMLElement,
    arenaFrameEl: HTMLElement,
    boardMiddleEl: HTMLElement,
    topRowEl: HTMLElement | null,
    bottomRowEl: HTMLElement | null,
    framePaddingX: number,
    framePaddingY: number,
    topRowGapY: number,
    bottomRowGapY: number,
    betweenRowsGap: number,
  ): { playW: number; playH: number } {
    const panelStyles = getComputedStyle(boardPanelEl);
    const padX =
      pxNumber(panelStyles.paddingLeft) + pxNumber(panelStyles.paddingRight);
    const padY =
      pxNumber(panelStyles.paddingTop) + pxNumber(panelStyles.paddingBottom);
    const contentW = Math.max(0, boardPanelEl.clientWidth - padX);
    const contentH = Math.max(0, boardPanelEl.clientHeight - padY);

    const profileChrome =
      (topRowEl?.offsetHeight || 0)
      + (bottomRowEl?.offsetHeight || 0)
      + topRowGapY
      + bottomRowGapY
      + betweenRowsGap
      + framePaddingY;

    const playH = Math.max(0, contentH - profileChrome);
    const playW = Math.max(
      boardMiddleEl.clientWidth,
      arenaFrameEl.clientWidth - framePaddingX,
      contentW - framePaddingX,
    );

    return { playW, playH };
  }

  /** Fit table to the current responsive playfield. */
  function applyTableViewportFit(): void {
    if (!tableEl || !gameAppEl || gameAppEl.classList.contains("hidden")) {
      return;
    }

    const arenaFrameEl = tableEl.closest<HTMLElement>(".arena-frame");
    const boardMiddleEl = tableEl.closest<HTMLElement>(".board-middle");
    const boardPanelEl = arenaFrameEl?.closest<HTMLElement>(".board-panel");
    if (!arenaFrameEl || !boardMiddleEl) {
      return;
    }

    const pass = ++layoutPass;

    const topRowEl = arenaFrameEl.querySelector<HTMLElement>(".board-player-row-top");
    const bottomRowEl = arenaFrameEl.querySelector<HTMLElement>(".board-player-row-bottom");
    const topRowStyles = topRowEl ? window.getComputedStyle(topRowEl) : null;
    const bottomRowStyles = bottomRowEl ? window.getComputedStyle(bottomRowEl) : null;

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

    const { w: vpW } = viewportSize();
    let innerW: number;
    let playH: number;

    const portraitEarly = shouldUsePortraitTable();

    if (isMobileLayout() && boardPanelEl) {
      const mobileField = computeMobilePlayfield(
        boardPanelEl,
        arenaFrameEl,
        boardMiddleEl,
        topRowEl,
        bottomRowEl,
        framePaddingX,
        framePaddingY,
        topRowGapY,
        bottomRowGapY,
        betweenRowsGap,
      );
      innerW = mobileField.playW;
      playH = mobileField.playH;
      if (portraitEarly) {
        innerW = boardMiddleEl.clientWidth || mobileField.playW;
        const midH = boardMiddleEl.clientHeight;
        playH = midH >= 80 ? midH : mobileField.playH;
      } else if (boardMiddleEl.clientHeight >= 80) {
        playH = boardMiddleEl.clientHeight;
      }
    } else {
      innerW = Math.max(
        boardMiddleEl.clientWidth,
        arenaFrameEl.clientWidth - framePaddingX,
        vpW - framePaddingX,
      );

      playH = boardMiddleEl.clientHeight;
      if (!isMobileLayout()) {
        const innerH = arenaFrameEl.clientHeight - framePaddingY;
        playH = Math.max(
          playH,
          innerH
            - (topRowEl?.offsetHeight || 0)
            - (bottomRowEl?.offsetHeight || 0)
            - topRowGapY
            - bottomRowGapY
            - betweenRowsGap,
        );
      }
    }

    if (playH < 80 || innerW < 120) {
      scheduleTableViewportFit();
      return;
    }

    const portrait = shouldUsePortraitTable();

    let spanW: number;
    let spanH: number;
    if (isMobileLayout()) {
      if (portrait) {
        const fit = fitPortraitFillHeight(playH, TABLE_VIEW_ASPECT_PORTRAIT);
        spanW = fit.w;
        spanH = fit.h;
      } else {
        const fit = fitCoverBox(innerW, playH, TABLE_VIEW_ASPECT);
        spanW = fit.w;
        spanH = fit.h;
      }
    } else {
      const innerH = Math.max(0, arenaFrameEl.clientHeight - framePaddingY);
      const innerW = Math.max(0, arenaFrameEl.clientWidth - framePaddingX);
      const playW = Math.max(boardMiddleEl.clientWidth, innerW);
      const fit = fitContainBox(playW, playH, TABLE_VIEW_ASPECT);
      spanW = Math.min(fit.w, DESKTOP_BOARD_MAX_PX);
      spanH = spanW / TABLE_VIEW_ASPECT;
      if (spanH > playH) {
        spanH = playH;
        spanW = Math.min(spanH * TABLE_VIEW_ASPECT, DESKTOP_BOARD_MAX_PX);
        spanH = spanW / TABLE_VIEW_ASPECT;
      }
    }

    spanW = Math.floor(spanW / 4) * 4;
    spanH = Math.floor(spanH / 4) * 4;

    if (!Number.isFinite(spanW) || !Number.isFinite(spanH) || spanW < 160 || spanH < 90) {
      clearSizingState();
      return;
    }

    if (pass !== layoutPass) {
      return;
    }

    let lockW = spanW;
    let lockH = spanH;
    if (portrait) {
      /* Pre-rotation element: wide side = visual height, narrow = visual width. */
      lockW = spanH;
      lockH = spanW;
    }

    document.documentElement.style.setProperty("--table-size-w", `${spanW}px`);
    document.documentElement.style.setProperty("--table-size-h", `${spanH}px`);
    document.documentElement.style.setProperty("--board-size", `${spanW}px`);
    if (portrait) {
      document.documentElement.style.setProperty("--table-portrait-visual-w", `${spanW}px`);
      document.documentElement.style.setProperty("--table-portrait-visual-h", `${spanH}px`);
    } else {
      document.documentElement.style.removeProperty("--table-portrait-visual-w");
      document.documentElement.style.removeProperty("--table-portrait-visual-h");
    }
    applyExactTableSizeLock(lockW, lockH, { portrait });
    const bbox = tableBboxEl();
    if (portrait && bbox) {
      bbox.style.width = "100%";
      bbox.style.height = "100%";
      bbox.style.maxWidth = "100%";
      bbox.style.flex = "1 1 0";
    } else if (bbox) {
      bbox.style.removeProperty("width");
      bbox.style.removeProperty("height");
      bbox.style.removeProperty("max-width");
      bbox.style.removeProperty("flex");
    }
    tableEl.classList.toggle("pool-table-portrait", portrait);
    tableEl.classList.add("pool-table-sized");
  }

  function scheduleTableViewportFit(): void {
    if (tableFitRafId != null) {
      window.cancelAnimationFrame(tableFitRafId);
    }
    tableFitRafId = window.requestAnimationFrame(() => {
      tableFitRafId = window.requestAnimationFrame(() => {
        tableFitRafId = null;
        applyTableViewportFit();
      });
    });
  }

  return {
    applyTableViewportFit,
    scheduleTableViewportFit,
    clearSizingState,
    syncGameShellScale,
    clearGameShellScale,
  };
}


export function mountPoolArenaLayoutSync(
  tableEl: HTMLElement | null,
  gameAppEl: HTMLElement | null,
): () => void {
  const layout = createTableLayoutHelpers({ tableEl, gameAppEl });
  const unmount = mountArenaLayoutSync({
    gameAppEl,
    playfieldEl: tableEl,
    arenaLayoutEvent: "pool-arena-layout",
    scheduleFit: () => layout.scheduleTableViewportFit(),
    onBreakpointClear: () => {
      layout.clearSizingState();
      layout.clearGameShellScale();
    },
    beforeSync: () => layout.syncGameShellScale(),
    hudPadMin: 48,
  });
  return () => {
    unmount();
    layout.clearGameShellScale();
    tableEl?.classList.remove("pool-table-portrait");
    tableEl?.style.removeProperty("width");
    tableEl?.style.removeProperty("height");
    document.documentElement.style.removeProperty("--table-size-w");
    document.documentElement.style.removeProperty("--table-size-h");
    document.documentElement.style.removeProperty("--board-size");
    document.documentElement.style.removeProperty("--table-portrait-visual-w");
    document.documentElement.style.removeProperty("--table-portrait-visual-h");
  };
}
