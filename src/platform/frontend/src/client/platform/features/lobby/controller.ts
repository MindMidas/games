import {
  pingPresence,
  fetchOnlinePlayers,
  fetchProfileStats,
  fetchLeaderboard,
  fetchActivePvpGame,
  surrenderGame,
  createInvite,
  fetchInviteStatus,
  joinInvite,
} from "./lobbyNet.js";
import { extractInviteCode, isInviteMatchPayload, syncRoute } from "../../shared/lib/routes.js";
import { resolvePhotoUrl, getDefaultAvatar } from "../../shared/lib/security.js";
import { setImageWithFallback } from "../../shared/lib/images.js";
import { safeText } from "../../shared/lib/utils.js";
/** How often (ms) to re-fetch the online players list while on this screen. */
const ONLINE_POLL_MS = 4500;

interface LobbyUser {
  id?: string;
  username?: string;
  photo_url?: string | null;
}

interface LobbyDeps {
  notify?: (message: string, isError?: boolean) => void;
  getUser?: () => LobbyUser | null;
  onPlayOffline?: () => void | Promise<void>;
  onPlayOnline?: () => void;
  onRejoinGame?: (payload: { gameId: string; mode: string }) => void | Promise<void>;
  onInviteMatched?: (payload: InviteMatchPayload) => void | Promise<void>;
  offlinePlayButtonId?: string;
  offlineMode?: string;
  activeGameOfflineMessage?: string;
  activeGamePvpMessage?: string;
  activeGameEndButtonLabel?: string;
  activeGameForfeitButtonLabel?: string;
  uiPrefix?: string;
}

interface ProfileStats {
  wins?: number;
  draws?: number;
  losses?: number;
}

interface LeaderboardEntry extends ProfileStats {
  user_id?: string;
  username?: string;
  photo_url?: string | null;
}

interface OnlinePlayersPayload {
  online_count?: number;
  players?: unknown[];
}

interface ActiveGamePayload {
  has_active?: boolean;
  game_id?: string;
  mode?: string;
}

interface InviteMatchPayload {
  status?: string;
  match_id?: string;
  opponent?: Record<string, unknown>;
}

interface InviteStatusPayload extends InviteMatchPayload {}

interface CreateInvitePayload {
  ok?: boolean;
  code?: string;
  link?: string;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function button(id: string): HTMLButtonElement | null {
  return document.getElementById(id) as HTMLButtonElement | null;
}

function input(id: string): HTMLInputElement | null {
  return document.getElementById(id) as HTMLInputElement | null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function asCount(value: unknown): number {
  return Math.max(0, Number(value || 0));
}


/** Inline SVG for leaderboard medal - same palette as row, premium metallic look. */
const MEDAL_SVGS: Record<number, string> = {
  1: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="medal-g" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#6bff9e"/><stop offset="50%" style="stop-color:#2da85e"/><stop offset="100%" style="stop-color:#1a6b3a"/></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#medal-g)" stroke="#3eb86b" stroke-width="1.2"/><circle cx="12" cy="10" r="3" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.8"/><text x="12" y="15.5" text-anchor="middle" font-size="11" font-weight="bold" fill="#0d2818">1</text></svg>',
  2: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="medal-b" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#8bb8ff"/><stop offset="50%" style="stop-color:#4f8dff"/><stop offset="100%" style="stop-color:#2a5ab8"/></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#medal-b)" stroke="#4f8dff" stroke-width="1.2"/><circle cx="12" cy="10" r="3" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.8"/><text x="12" y="15.5" text-anchor="middle" font-size="11" font-weight="bold" fill="#0f1a2e">2</text></svg>',
  3: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="medal-br" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#e5b896"/><stop offset="50%" style="stop-color:#b8864a"/><stop offset="100%" style="stop-color:#8a5c2a"/></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#medal-br)" stroke="#a67c52" stroke-width="1.2"/><circle cx="12" cy="10" r="3" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="0.8"/><text x="12" y="15.5" text-anchor="middle" font-size="11" font-weight="bold" fill="#2a1a0a">3</text></svg>',
};

export function createLobbyController(deps: LobbyDeps = {}) {
  const {
    notify = () => {},
    getUser = () => null,
    onPlayOffline = () => {},
    onPlayOnline = () => {},
    onRejoinGame = () => {},
    onInviteMatched = () => {},
    offlinePlayButtonId = "lobby-play-local-btn",
    offlineMode = "pnp",
    activeGameOfflineMessage = "",
    activeGamePvpMessage = "",
    activeGameEndButtonLabel = "End game",
    activeGameForfeitButtonLabel = "Withdraw (forfeit)",
  } = deps;

  const refs = {
    playOfflineButton: button(offlinePlayButtonId),
    playOnlineButton: button("lobby-play-online-btn"),
    activeGamePanel: byId("lobby-active-game-panel"),
    rejoinGameButton: button("lobby-rejoin-game-btn"),
    withdrawGameButton: button("lobby-withdraw-game-btn"),
    inviteFriendButton: button("lobby-invite-friend-btn"),
    inviteModal: byId("lobby-invite-modal"),
    inviteModalClose: button("lobby-invite-modal-close"),
    inviteLinkInput: input("lobby-invite-link-input"),
    inviteCopyButton: button("lobby-invite-copy-btn"),
    inviteCodeEl: byId("lobby-invite-code"),
    joinCodeInput: input("lobby-join-code-input"),
    joinCodeButton: button("lobby-join-code-btn"),
    activeGameMessage: byId("lobby-active-game-message"),
    onlineCountPill: byId("online-count-pill"),
    onlineCountValue: byId("online-count-value"),
    leaderboardList: byId("lobby-leaderboard-list"),
    recordWins: byId("lobby-record-wins"),
    recordDraws: byId("lobby-record-draws"),
    recordLosses: byId("lobby-record-losses"),
    matchmakingSelfName: byId("matchmaking-self-name"),
    matchmakingSelfAvatar: byId("matchmaking-self-avatar"),
  };

  let pollTimer: number | null = null;
  /** Poll for invite status when user is waiting for someone to join their invite. */
  let invitePollTimer: number | null = null;
  /** Guard so event listeners are only bound once even if init() is called again. */
  let bound = false;
  /** When set, user has an active unfinished game (rejoin / forfeit panel, block new starts). */
  let activeIncompleteGameId: string | null = null;
  let activeIncompleteGameMode: string | null = null;

  function renderUser(user: LobbyUser | null | undefined): void {
    const username = safeText(user?.username, "Player");
    const photoUrl = resolvePhotoUrl(user?.photo_url, getDefaultAvatar());
    if (refs.matchmakingSelfName) {
      refs.matchmakingSelfName.textContent = username;
    }
    setImageWithFallback(refs.matchmakingSelfAvatar, photoUrl);
  }

  function renderProfileStats(stats: ProfileStats | null | undefined): void {
    if (refs.recordWins) {
      refs.recordWins.textContent = String(asCount(stats?.wins));
    }
    if (refs.recordDraws) {
      refs.recordDraws.textContent = String(asCount(stats?.draws));
    }
    if (refs.recordLosses) {
      refs.recordLosses.textContent = String(asCount(stats?.losses));
    }
  }

  function clearProfileStats(): void {
    renderProfileStats({ wins: 0, draws: 0, losses: 0 });
  }

  function renderLeaderboard(entries: LeaderboardEntry[], currentUserId: string): void {
    const listEl = refs.leaderboardList;
    if (!listEl) {
      return;
    }
    listEl.innerHTML = "";
    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "leaderboard-empty";
      empty.textContent = "No results yet.";
      listEl.appendChild(empty);
      return;
    }
    list.forEach((entry, index) => {
      const rank = index + 1;
      const row = document.createElement("div");
      row.setAttribute("role", "listitem");
      row.className = "leaderboard-row";
      if (rank <= 3) {
        row.classList.add(`rank-${rank}`);
      }
      if (entry.user_id && entry.user_id === currentUserId) {
        row.classList.add("is-you");
      }
      const avatarWrap = document.createElement("span");
      avatarWrap.className = "game-profile-avatar-wrap game-profile-avatar-wrap--xs";
      const clip = document.createElement("span");
      clip.className = "game-profile-avatar-clip";
      const avatar = document.createElement("img");
      avatar.className = "leaderboard-avatar game-profile-avatar";
      avatar.alt = "";
      setImageWithFallback(avatar, entry.photo_url);
      clip.appendChild(avatar);
      avatarWrap.appendChild(clip);
      const nameEl = document.createElement("span");
      nameEl.className = "leaderboard-name";
      nameEl.textContent = safeText(entry.username, "—");
      const statsEl = document.createElement("span");
      statsEl.className = "leaderboard-stats";
      statsEl.textContent = `${asCount(entry.wins)}–${asCount(entry.draws)}–${asCount(entry.losses)}`;
      const rankEl = document.createElement("span");
      rankEl.className = "leaderboard-rank";
      if (rank <= 3 && MEDAL_SVGS[rank]) {
        rankEl.classList.add("leaderboard-medal");
        rankEl.innerHTML = MEDAL_SVGS[rank];
        rankEl.setAttribute("aria-label", `Rank ${rank}`);
      } else {
        rankEl.textContent = String(rank);
      }
      row.appendChild(rankEl);
      row.appendChild(avatarWrap);
      row.appendChild(nameEl);
      row.appendChild(statsEl);
      listEl.appendChild(row);
    });
  }

  function renderOnlinePlayers(payload: OnlinePlayersPayload | null | undefined): void {
    const onlineCount = asCount(payload?.online_count);
    if (refs.onlineCountValue) {
      refs.onlineCountValue.textContent = String(onlineCount);
    } else if (refs.onlineCountPill) {
      refs.onlineCountPill.textContent = `Online: ${onlineCount}`;
    }
  }

  async function refreshOnline(): Promise<void> {
    const user = getUser();
    if (!user) {
      renderOnlinePlayers({ online_count: 0, players: [] });
      return;
    }
    try {
      await pingPresence();
      const payload = await fetchOnlinePlayers();
      renderOnlinePlayers(payload);
    } catch (error) {
      renderOnlinePlayers({ online_count: 0, players: [] });
      notify(errorMessage(error, "Unable to load online players."), true);
    }
  }

  async function refreshStats(): Promise<void> {
    const user = getUser();
    if (!user) {
      clearProfileStats();
      return;
    }
    try {
      const payload = await fetchProfileStats();
      renderProfileStats(payload);
    } catch {
      clearProfileStats();
    }
  }

  const BLOCK_NEW_GAME_ARIA = "Finish or forfeit your current game first";
  const NOTIFY_FINISH_OR_FORFEIT =
    "You have a game in progress. Rejoin it or forfeit before starting a new one.";

  function setLobbyNewGameBlocked(blocked: boolean): void {
    const buttons = [refs.playOnlineButton, refs.playOfflineButton, refs.inviteFriendButton, refs.joinCodeButton];
    for (const el of buttons) {
      if (!el) continue;
      el.classList.toggle("lobby-start-blocked", blocked);
      if (blocked) {
        el.setAttribute("aria-disabled", "true");
        el.setAttribute("aria-label", BLOCK_NEW_GAME_ARIA);
      } else {
        el.removeAttribute("aria-disabled");
        el.removeAttribute("aria-label");
      }
    }
  }

  async function refreshActiveGame(): Promise<void> {
    try {
      const payload = await fetchActivePvpGame() as ActiveGamePayload;
      const hasActive = Boolean(payload?.has_active && payload?.game_id);
      activeIncompleteGameId = hasActive ? String(payload.game_id) : null;
      const rawMode = String(payload?.mode || "").toLowerCase();
      activeIncompleteGameMode = hasActive && rawMode === offlineMode ? offlineMode : hasActive ? "pvp" : null;
      refs.activeGamePanel?.classList.toggle("hidden", !hasActive);
      if (hasActive) {
        const isOffline = activeIncompleteGameMode === offlineMode;
        const line = isOffline
          ? (activeGameOfflineMessage || activeGamePvpMessage)
          : (activeGamePvpMessage || activeGameOfflineMessage);
        if (refs.activeGameMessage) refs.activeGameMessage.textContent = line;
        if (refs.withdrawGameButton) {
          refs.withdrawGameButton.textContent = isOffline
            ? activeGameEndButtonLabel
            : activeGameForfeitButtonLabel;
        }
        setLobbyNewGameBlocked(true);
      } else {
        if (refs.activeGameMessage) {
          refs.activeGameMessage.textContent =
            "You have an unfinished game. Rejoin or forfeit before starting another.";
        }
        setLobbyNewGameBlocked(false);
      }
    } catch {
      activeIncompleteGameId = null;
      activeIncompleteGameMode = null;
      refs.activeGamePanel?.classList.add("hidden");
      setLobbyNewGameBlocked(false);
    }
  }
  async function refreshLeaderboard(): Promise<void> {
    const user = getUser();
    if (!user) {
      renderLeaderboard([], "");
      return;
    }
    try {
      const payload = await fetchLeaderboard();
      const entries = Array.isArray(payload?.leaderboard) ? payload.leaderboard : [];
      renderLeaderboard(entries, user.id || "");
    } catch {
      renderLeaderboard([], user.id || "");
    }
  }
  async function refreshLobby(): Promise<void> {
    await Promise.all([refreshStats(), refreshOnline(), refreshActiveGame(), refreshLeaderboard()]);
  }

  function stopPolling(): void {
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function stopInvitePolling(): void {
    if (invitePollTimer) {
      window.clearInterval(invitePollTimer);
      invitePollTimer = null;
    }
  }

  /** Poll invite status until accepted or user leaves; on accepted, call onInviteMatched. */
  async function pollInviteStatus(): Promise<void> {
    try {
      const payload = await fetchInviteStatus() as InviteStatusPayload;
      const st = String(payload?.status || "").toLowerCase();
      if ((st === "accepted" || st === "matched" || st === "opponent_found") && payload?.match_id) {
        stopInvitePolling();
        refs.inviteModal?.classList.add("hidden");
        onInviteMatched({
          status: "matched",
          match_id: payload.match_id,
          opponent: payload.opponent || {},
        });
      }
    } catch {
      // keep polling on transient errors
    }
  }

  /** Start the periodic online-players poll. Safe to call multiple times. */
  function startPolling(): void {
    stopPolling();
    const user = getUser();
    if (!user) {
      return;
    }
    pollTimer = window.setInterval(() => {
      void refreshOnline();
    }, ONLINE_POLL_MS);
  }

  function bindEnter(
    inputEl: HTMLInputElement | null,
    handler: () => void | Promise<void>,
  ): void {
    inputEl?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void handler();
      }
    });
  }

  function bindEvents(): void {
    if (bound) {
      return;
    }
    bound = true;
    refs.playOfflineButton?.addEventListener("click", () => {
      if (activeIncompleteGameId) {
        notify(NOTIFY_FINISH_OR_FORFEIT);
        return;
      }
      onPlayOffline();
    });
    refs.playOnlineButton?.addEventListener("click", () => {
      if (activeIncompleteGameId) {
        notify(NOTIFY_FINISH_OR_FORFEIT);
        return;
      }
      onPlayOnline();
    });
    refs.rejoinGameButton?.addEventListener("click", () => {
      if (activeIncompleteGameId) {
        onRejoinGame({
          gameId: activeIncompleteGameId,
          mode: activeIncompleteGameMode || "pvp",
        });
      }
    });
    refs.withdrawGameButton?.addEventListener("click", async () => {
      if (!activeIncompleteGameId) return;
      refs.withdrawGameButton?.setAttribute("disabled", "true");
      try {
        const wasOffline = activeIncompleteGameMode === offlineMode;
        await surrenderGame(activeIncompleteGameId);
        notify(wasOffline ? "Game ended." : "Game forfeited.");
        activeIncompleteGameId = null;
        activeIncompleteGameMode = null;
        await refreshActiveGame();
      } catch (e) {
        notify(errorMessage(e, "Forfeit failed."), true);
      } finally {
        refs.withdrawGameButton?.removeAttribute("disabled");
      }
    });
    refs.inviteFriendButton?.addEventListener("click", async () => {
      if (activeIncompleteGameId) {
        notify(NOTIFY_FINISH_OR_FORFEIT);
        return;
      }
      if (refs.inviteFriendButton) refs.inviteFriendButton.disabled = true;
      try {
        const result = await createInvite() as CreateInvitePayload;
        if (result?.ok && result?.code && result?.link) {
          const fullLink = typeof window !== "undefined" && window.location?.origin
            ? window.location.origin + result.link
            : result.link;
          if (refs.inviteLinkInput) refs.inviteLinkInput.value = fullLink;
          if (refs.inviteCodeEl) refs.inviteCodeEl.textContent = result.code;
          refs.inviteModal?.classList.remove("hidden");
          stopInvitePolling();
          invitePollTimer = window.setInterval(() => void pollInviteStatus(), 2000);
        } else {
          notify("Could not create invite.", true);
        }
      } catch (e) {
        notify(errorMessage(e, "Invite failed."), true);
      } finally {
        if (refs.inviteFriendButton) refs.inviteFriendButton.disabled = false;
      }
    });
    refs.inviteCopyButton?.addEventListener("click", () => {
      const input = refs.inviteLinkInput;
      if (!input?.value) return;
      input.select();
      input.setSelectionRange(0, 99999);
      try {
        navigator.clipboard.writeText(input.value);
        notify("Link copied.");
      } catch {
        notify("Copy failed.", true);
      }
    });
    function closeInviteModal(): void {
      stopInvitePolling();
      refs.inviteModal?.classList.add("hidden");
    }
    refs.inviteModalClose?.addEventListener("click", closeInviteModal);
    refs.inviteModal?.addEventListener("click", (e) => {
      if (e.target === refs.inviteModal) {
        closeInviteModal();
      }
    });
    refs.joinCodeButton?.addEventListener("click", () => void handleJoinByCode());
    bindEnter(refs.joinCodeInput, () => void handleJoinByCode());
  }

  async function handleJoinByCode(): Promise<void> {
    const code = extractInviteCode(refs.joinCodeInput?.value ?? "");
    if (!code) {
      notify("Enter a code.", true);
      return;
    }
    if (activeIncompleteGameId) {
      notify(NOTIFY_FINISH_OR_FORFEIT);
      return;
    }
    if (refs.joinCodeButton) refs.joinCodeButton.disabled = true;
    try {
      const payload = await joinInvite(code);
      if (isInviteMatchPayload(payload)) {
        stopInvitePolling();
        refs.inviteModal?.classList.add("hidden");
        syncRoute("lobby");
        onInviteMatched(payload);
      } else {
        notify("Invalid or expired code.", true);
      }
    } catch (e) {
      notify(errorMessage(e, "Join failed."), true);
    } finally {
      if (refs.joinCodeButton) refs.joinCodeButton.disabled = false;
    }
  }

  async function onEnter(): Promise<void> {
    const loader = document.getElementById("app-loading-screen");
    loader?.classList.remove("fade-out");

    let dismissed = false;
    function dismissLoader(): void {
      if (dismissed) return;
      dismissed = true;
      document.getElementById("app-loading-screen")?.classList.add("fade-out");
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const inviteCode = extractInviteCode(params.get("invite") || "");
      await refreshLobby();
      startPolling();

      if (inviteCode) {
        if (activeIncompleteGameId) {
          notify("You have a game in progress. Rejoin or forfeit before accepting an invite.");
          syncRoute("lobby");
        } else {
          try {
            const payload = await joinInvite(inviteCode);
            if (isInviteMatchPayload(payload)) {
              syncRoute("lobby");
              onInviteMatched(payload);
              dismissLoader();
              return;
            }
            notify("Invalid or expired invite link.", true);
          } catch (err) {
            notify(errorMessage(err, "Invalid or expired invite link."), true);
          }
        }
      }
    } finally {
      dismissLoader();
    }
  }

  function onExit(): void {
    stopPolling();
    stopInvitePolling();
    refs.inviteModal?.classList.add("hidden");
  }

  function setUser(user: LobbyUser | null): void {
    renderUser(user);
  }

  function reset(): void {
    setUser(null);
    activeIncompleteGameId = null;
    activeIncompleteGameMode = null;
    stopInvitePolling();
    clearProfileStats();
    renderOnlinePlayers({ online_count: 0, players: [] });
    refs.activeGamePanel?.classList.add("hidden");
    refs.inviteModal?.classList.add("hidden");
    setLobbyNewGameBlocked(false);
  }

  function init(): void {
    bindEvents();
    reset();
  }

  return {
    init,
    onEnter,
    onExit,
    setUser,
    reset,
    refreshLobby,
  };
}
