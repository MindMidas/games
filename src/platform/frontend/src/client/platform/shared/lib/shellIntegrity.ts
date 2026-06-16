import { buildPath, parseRoute } from "./routes.js";

export function assertShellMatchesExpectedGame(expectedGameId: string): boolean {
  const expected = String(expectedGameId || "").trim();
  if (expected !== "chezz" && expected !== "pool") {
    return true;
  }

  const domId = String(document.documentElement.getAttribute("data-game") || "").trim();
  const meta = document.querySelector('meta[name="mm-game-id"]');
  const metaId = String(meta?.getAttribute("content") || "").trim();

  if (domId === expected && (!metaId || metaId === expected)) {
    stripShellRecoveryQuery();
    return true;
  }

  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("_shell_fix") === expected) {
      stripShellRecoveryQuery();
      console.warn(
        `[shell] markup recovery already attempted for ${expected}; continuing with current HTML`,
      );
      return true;
    }
    url.searchParams.set("_shell_fix", expected);
    url.searchParams.set("_", String(Date.now()));
    const route = parseRoute(url);
    if (route.screen === "game" && route.gameId) {
      const path = buildPath("game", { gameId: route.gameId, gameType: expected });
      if (path) {
        url.pathname = path;
        url.searchParams.delete("game");
      }
    }
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
  return false;
}

function stripShellRecoveryQuery(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("_shell_fix") && !url.searchParams.has("_")) {
      return;
    }
    url.searchParams.delete("_shell_fix");
    url.searchParams.delete("_");
    const qs = url.searchParams.toString();
    const next = url.pathname + (qs ? `?${qs}` : "") + url.hash;
    window.history.replaceState(window.history.state, "", next);
  } catch {
    // ignore URL cleanup failures.
  }
}
