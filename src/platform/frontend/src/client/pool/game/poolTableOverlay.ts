export function tableOverlaySvg(): SVGSVGElement | null {
  const el = document.querySelector("#pool-svg-container .pool-svg-overlay");
  return el instanceof SVGSVGElement ? el : null;
}

/** Return the board-panel overlay used for live cue interaction. */
export function ensurePoolGlobalOverlay(): SVGSVGElement {
  const host = document.querySelector("#game-app .board-panel")
    || document.getElementById("game-app");
  const existing = document.getElementById("pool-global-overlay");
  let svg: SVGSVGElement | null = existing instanceof SVGSVGElement ? existing : null;
  const namespace = "http://www.w3.org/2000/svg";

  if (!(svg instanceof SVGSVGElement)) {
    svg = document.createElementNS(namespace, "svg");
    svg.id = "pool-global-overlay";
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("pool-global-overlay");
  }

  if (host && svg.parentElement !== host) {
    host.appendChild(svg);
  } else if (!host && !svg.parentElement) {
    document.body.appendChild(svg);
  }
  return svg;
}


export function tableSvgRoot(): SVGSVGElement | null {
  const root = document.getElementById("table-svg");
  return root instanceof SVGSVGElement ? root : null;
}


export function tableRotor(): SVGGraphicsElement | null {
  const root = tableSvgRoot();
  const rotor = root?.querySelector("#table-rotor");
  return rotor instanceof SVGGraphicsElement ? rotor : null;
}


/** Map a table-space point to overlay SVG user units. */
export function tablePointToOverlay(
  svgOverlayEl: SVGSVGElement,
  tx: number,
  ty: number,
): { x: number; y: number } | null {
  const root = tableSvgRoot();
  const rotor = tableRotor();
  if (!root || !rotor || !svgOverlayEl) {
    return null;
  }
  const pt = root.createSVGPoint();
  pt.x = tx;
  pt.y = ty;
  const rotorMatrix = rotor.getScreenCTM();
  if (!rotorMatrix) return null;
  const screen = pt.matrixTransform(rotorMatrix);
  const overlayInv = svgOverlayEl.getScreenCTM()?.inverse();
  if (!screen || !overlayInv) {
    return null;
  }
  const oPt = svgOverlayEl.createSVGPoint();
  oPt.x = screen.x;
  oPt.y = screen.y;
  const local = oPt.matrixTransform(overlayInv);
  return { x: local.x, y: local.y };
}

export function clearCueSticksInOverlays(
  roots: Iterable<ParentNode | null | undefined>,
): void {
  for (const root of roots) {
    if (!root) {
      continue;
    }
    for (const node of root.querySelectorAll('[data-ui="cue-stick"]')) {
      try {
        node.remove();
      } catch {
        /* noop */
      }
    }
  }
}
