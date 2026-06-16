import { safeText } from "../../shared/lib/utils.js";

export type AppScreen = "home" | "lobby" | "matchmaking" | "game" | "notFound";
export type RestorableScreen = Exclude<AppScreen, "home" | "notFound">;

export function appScreen(value: unknown, fallback: AppScreen): AppScreen {
  return value === "home"
    || value === "lobby"
    || value === "matchmaking"
    || value === "game"
    || value === "notFound"
    ? value
    : fallback;
}

export function isRestorableScreen(value: unknown): value is RestorableScreen {
  return value === "game" || value === "matchmaking" || value === "lobby";
}

export function readLastScreen(lastScreenKey: string): RestorableScreen {
  try {
    const value = safeText(window.localStorage.getItem(lastScreenKey), "");
    if (isRestorableScreen(value)) {
      return value;
    }
  } catch {
    // ignore storage access issues.
  }
  return "lobby";
}

export function writeLastScreen(screen: AppScreen, lastScreenKey: string): void {
  const value = safeText(screen, "");
  if (!isRestorableScreen(value)) {
    return;
  }
  try {
    window.localStorage.setItem(lastScreenKey, value);
  } catch {
    // ignore storage access issues.
  }
}

export function clearLastScreen(lastScreenKey: string): void {
  try {
    window.localStorage.removeItem(lastScreenKey);
  } catch {
    // ignore storage access issues.
  }
}

export function readSavedGameMode(shellGameId: string, gameId: string): string | null {
  try {
    const value = window.sessionStorage.getItem(`${shellGameId}.gameSession`);
    if (!value) {
      return null;
    }
    const parsed = JSON.parse(value);
    if (parsed?.gameId === gameId && parsed?.mode) {
      return String(parsed.mode);
    }
  } catch {
    // ignore stale or unavailable session storage.
  }
  return null;
}
