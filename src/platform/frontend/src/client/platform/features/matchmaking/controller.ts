import {
  joinMatchmaking,
  fetchMatchmakingStatus,
  cancelMatchmaking,
} from "../lobby/lobbyNet.js";
import { applyImage } from "../../shared/lib/images.js";
import { getDefaultAvatar } from "../../shared/lib/security.js";
import { safeText } from "../../shared/lib/utils.js";

/** How often (ms) to poll while waiting in queue. */
const STATUS_POLL_MS = 1800;
/** Faster poll while opponent-found countdown is active. */
const COUNTDOWN_POLL_MS = 400;

interface MatchUser {
  username?: string;
  photo_url?: string | null;
}

interface MatchPayload {
  status?: string;
  starts_in_seconds?: number;
  match_id?: string;
  opponent?: MatchUser | null;
}

interface WaitForMatchHooks {
  isActive?: () => boolean;
  onCountdown?: (seconds: number) => void;
}

interface MatchmakingControllerDeps {
  notify?: (message: string, isError?: boolean) => void;
  getUser?: () => MatchUser | null;
  onCancel?: () => void;
  onMatched?: (payload: MatchPayload) => void | Promise<void>;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function button(id: string): HTMLButtonElement | null {
  return document.getElementById(id) as HTMLButtonElement | null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Wait until the server reports a durable matched queue row. */
export async function waitForMatchStart(
  initialPayload: MatchPayload | null | undefined,
  fetchStatus: () => Promise<MatchPayload>,
  hooks: WaitForMatchHooks = {},
): Promise<MatchPayload | null> {
  const isActive = typeof hooks.isActive === "function" ? hooks.isActive : () => true;
  let payload = initialPayload && typeof initialPayload === "object" ? initialPayload : {};
  async function refresh(): Promise<MatchPayload> {
    payload = await fetchStatus();
    return payload;
  }

  while (isActive()) {
    const status = safeText(payload?.status, "").toLowerCase();
    if (status === "matched") {
      return payload;
    }
    if (status === "opponent_found") {
      const seconds = Math.max(
        0,
        Number(payload?.starts_in_seconds ?? 5),
      );
      if (typeof hooks.onCountdown === "function") {
        hooks.onCountdown(seconds);
      }
      const waitMs = Math.max(250, seconds * 1000);
      const started = Date.now();
      while (isActive() && Date.now() - started < waitMs) {
        await sleep(COUNTDOWN_POLL_MS);
        try {
          payload = await refresh();
        } catch {
          await sleep(COUNTDOWN_POLL_MS);
        }
        if (safeText(payload?.status, "").toLowerCase() === "matched") {
          return payload;
        }
      }
      try {
        payload = await refresh();
      } catch {
        /* keep looping */
      }
      if (safeText(payload?.status, "").toLowerCase() === "matched") {
        return payload;
      }
      continue;
    }
    await sleep(STATUS_POLL_MS);
    try {
      payload = await refresh();
    } catch {
      await sleep(STATUS_POLL_MS);
    }
  }
  return null;
}

export function createMatchmakingController(deps: MatchmakingControllerDeps = {}) {
  const {
    notify = () => {},
    getUser = () => null,
    onCancel = () => {},
    onMatched = () => {},
  } = deps;

  const refs = {
    selfName: byId("matchmaking-self-name"),
    selfAvatar: byId("matchmaking-self-avatar"),
    opponentName: byId("matchmaking-opponent-name"),
    opponentAvatar: byId("matchmaking-opponent-avatar"),
    opponentCard: byId("matchmaking-opponent-card"),
    status: byId("matchmaking-status"),
    cancelButton: button("matchmaking-cancel-btn"),
  };

  let active = false;
  let pollTimer: number | null = null;
  let bound = false;
  let matchedHandled = false;

  function setStatus(message: string, isError = false): void {
    if (!refs.status) {
      return;
    }
    refs.status.textContent = safeText(message, "Queued. Waiting for another player.");
    refs.status.classList.toggle("is-error", Boolean(isError));
  }

  function setSearchingOpponent(): void {
    if (refs.opponentName) {
      refs.opponentName.textContent = "";
    }
    applyImage(refs.opponentAvatar, getDefaultAvatar());
    refs.opponentCard?.classList.add("is-searching");
    refs.opponentCard?.setAttribute("aria-label", "Searching for an opponent");
  }

  function setMatchedOpponent(opponent: MatchUser | null | undefined): void {
    const username = safeText(opponent?.username, "Opponent");
    if (refs.opponentName) {
      refs.opponentName.textContent = username;
    }
    applyImage(refs.opponentAvatar, opponent?.photo_url);
    refs.opponentCard?.classList.remove("is-searching");
    refs.opponentCard?.setAttribute("aria-label", username);
  }

  function renderUser(): void {
    const user = getUser();
    if (refs.selfName) {
      refs.selfName.textContent = safeText(user?.username, "Player");
    }
    applyImage(refs.selfAvatar, user?.photo_url);
  }

  function stopPolling(): void {
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling(): void {
    stopPolling();
    pollTimer = window.setInterval(() => {
      void refreshStatus();
    }, STATUS_POLL_MS);
  }
  async function beginMatchedTransition(initialPayload: MatchPayload): Promise<void> {
    if (!active || matchedHandled) {
      return;
    }
    const status = safeText(initialPayload?.status, "").toLowerCase();
    if (status !== "matched" && status !== "opponent_found") {
      return;
    }
    setMatchedOpponent(initialPayload?.opponent || null);
    stopPolling();
    try {
      const ready = await waitForMatchStart(initialPayload, fetchMatchmakingStatus, {
        isActive: () => active,
        onCountdown: () => {
          setMatchedOpponent(initialPayload?.opponent || null);
          setStatus("Opponent found!");
        },
      });
      if (!active || !ready || matchedHandled) {
        return;
      }
      matchedHandled = true;
      setMatchedOpponent(ready?.opponent || null);
      setStatus("Opponent found!");
      onMatched(ready);
    } catch {
      if (active) {
        setStatus("Could not start matched game.", true);
      }
    }
  }
  async function refreshStatus(): Promise<void> {
    if (!active) {
      return;
    }

    try {
      const payload = await fetchMatchmakingStatus();
      const status = safeText(payload?.status, "waiting").toLowerCase();

      if (status === "matched" || status === "opponent_found") {
        void beginMatchedTransition(payload);
        return;
      }

      if (status === "idle" || status === "cancelled") {
        setSearchingOpponent();
        setStatus("Matchmaking is idle.");
        return;
      }

      setSearchingOpponent();
      setStatus("Queued. Waiting for another player.");
    } catch {
      setStatus("Could not fetch matchmaking status.", true);
    }
  }
  async function joinQueue(): Promise<void> {
    matchedHandled = false;
    setSearchingOpponent();
    setStatus("Joining queue...");

    try {
      const payload = await joinMatchmaking();
      const status = safeText(payload?.status, "waiting").toLowerCase();
      if (status === "matched" || status === "opponent_found") {
        void beginMatchedTransition(payload);
        return;
      }
      setSearchingOpponent();
      setStatus("Queued. Waiting for another player.");
      startPolling();
    } catch (error) {
      const message = errorMessage(error, "Could not join matchmaking.");
      setStatus(message, true);
      notify(message, true);
    }
  }
  async function cancelQueue(notifyUser = false): Promise<void> {
    stopPolling();
    try {
      await cancelMatchmaking();
    } catch {
      // no-op
    }
    setSearchingOpponent();
    setStatus("Matchmaking cancelled.");
    if (notifyUser) {
      notify("Matchmaking cancelled.");
    }
  }
  async function onCancelClick(): Promise<void> {
    refs.cancelButton && (refs.cancelButton.disabled = true);
    try {
      await cancelQueue(true);
      onCancel();
    } finally {
      refs.cancelButton && (refs.cancelButton.disabled = false);
    }
  }

  function bindEvents(): void {
    if (bound) {
      return;
    }
    bound = true;
    refs.cancelButton?.addEventListener("click", () => {
      void onCancelClick();
    });
  }

  function setUser(_user: MatchUser | null): void {
    renderUser();
  }

  function reset(): void {
    stopPolling();
    matchedHandled = false;
    setSearchingOpponent();
    setStatus("Queued. Waiting for another player.");
  }

  function init(): void {
    bindEvents();
    renderUser();
    reset();
  }
  async function onEnter(): Promise<void> {
    const loader = document.getElementById("app-loading-screen");
    loader?.classList.remove("fade-out");
    try {
      active = true;
      renderUser();
      await joinQueue();
    } finally {
      if (active) {
        loader?.classList.add("fade-out");
      }
    }
  }

  function onExit(): void {
    active = false;
    stopPolling();
  }

  return {
    init,
    reset,
    onEnter,
    onExit,
    setUser,
    cancelQueue,
    waitForMatchStart,
  };
}
