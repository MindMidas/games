/**
 * Early shell integrity check (must be external - CSP blocks inline scripts).
 * Expects <script src=".../shellEarlyGame.js" data-mm-game="chezz|pool">.
 */
(function () {
  const script = document.currentScript;
  const expected = String(script?.dataset?.mmGame || "").trim();
  if (expected !== "chezz" && expected !== "pool") {
    return;
  }
  const root = document.documentElement;
  if (root.getAttribute("data-game") === expected) {
    return;
  }
  try {
    const href = location.href.split("#")[0];
    if (href.indexOf("_shell_fix=") >= 0) {
      return;
    }
    const sep = href.indexOf("?") >= 0 ? "&" : "?";
    location.replace(`${href}${sep}_shell_fix=${expected}&_=${Date.now()}`);
  } catch {
    location.reload();
  }
})();
