/** Cache-busted dynamic import for shared platform chat (ESM imports are not busted via main.js ?v=). */
const CHAT_PANEL_BUILD = "20260528a";

let loadPromise: Promise<typeof import("./chatPanel.js")> | null = null;

export function loadPlatformChatPanel(): Promise<typeof import("./chatPanel.js")> {
  if (!loadPromise) {
    loadPromise = import(
      `/static/games/platform/js/features/gameplay/chat/chatPanel.js?v=${CHAT_PANEL_BUILD}`
    );
  }
  return loadPromise;
}
