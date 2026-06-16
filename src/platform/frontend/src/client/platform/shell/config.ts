import type { GameType } from "../shared/contracts.js";

export interface ShellOfflinePlayConfig {
  setupTitle: string;
  opponentName: string;
  opponentAvatar: string | null;
  statusText: string;
}

export interface GameShellConfig {
  gameId: GameType;
  uiPrefix: GameType;
  lastScreenKey: string;
  offlineMode: "pnp" | "pve";
  offlinePlayButtonId: string;
  arenaLayoutEvent: string;
  offlinePlay: ShellOfflinePlayConfig;
  pvpSetupStatus: string;
  inviteSetupStatus: string;
  matchFoundStatus: string;
  activeGameOfflineMessage: string;
  activeGamePvpMessage: string;
  activeGameEndButtonLabel: string;
  activeGameForfeitButtonLabel: string;
  arenaNewGameTitle: string;
}

export const POOL_SHELL = {
  gameId: "pool",
  uiPrefix: "pool",
  lastScreenKey: "pool:last-screen",
  offlineMode: "pnp",
  offlinePlayButtonId: "lobby-play-local-btn",
  arenaLayoutEvent: "pool-arena-layout",
  offlinePlay: {
    setupTitle: "Pass & Play",
    opponentName: "Player 2",
    opponentAvatar: "/static/shared/avatars/default-user-pool.svg",
    statusText: "Racking the table\u2026",
  },
  pvpSetupStatus: "Racking the table\u2026",
  inviteSetupStatus: "Racking the table\u2026",
  matchFoundStatus: "Racking the table\u2026",
  activeGameOfflineMessage:
    "You have an unfinished Pass & Play game. Rejoin or end it before starting another match.",
  activeGamePvpMessage:
    "You have an unfinished online game. Rejoin or forfeit before starting another match.",
  activeGameEndButtonLabel: "End game",
  activeGameForfeitButtonLabel: "Withdraw (forfeit)",
  arenaNewGameTitle: "Pass & Play",
} satisfies GameShellConfig;

export const CHEZZ_SHELL = {
  gameId: "chezz",
  uiPrefix: "chezz",
  lastScreenKey: "chezz:last-screen",
  offlineMode: "pve",
  offlinePlayButtonId: "lobby-play-engine-btn",
  arenaLayoutEvent: "chezz-arena-layout",
  offlinePlay: {
    setupTitle: "VS Engine",
    opponentName: "Maximus",
    opponentAvatar: null,
    statusText: "Preparing your game\u2026",
  },
  pvpSetupStatus: "Setting up the board\u2026",
  inviteSetupStatus: "Setting up the board\u2026",
  matchFoundStatus: "Preparing your game\u2026",
  activeGameOfflineMessage:
    "You have an unfinished game vs the engine. Rejoin or forfeit before starting another match.",
  activeGamePvpMessage:
    "You have an unfinished online game. Rejoin or forfeit before starting another match.",
  activeGameEndButtonLabel: "End game",
  activeGameForfeitButtonLabel: "Withdraw (forfeit)",
  arenaNewGameTitle: "VS Engine",
} satisfies GameShellConfig;
