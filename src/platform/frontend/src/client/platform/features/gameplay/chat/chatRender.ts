import type { ChatMessage } from "../../../shared/contracts.js";
import { formatChatMessageTime, parseChatSystemMessage } from "../../../shared/lib/appData.js";
import { safeText } from "../../../shared/lib/utils.js";
import type { ChatDecision, ChatOfferState } from "./chatState.js";

type OfferDecisionHandler = (offerId: number, decision: ChatDecision) => void | Promise<void>;

interface MessageRenderOptions {
  currentUserId: string;
  drawOfferState: ReadonlyMap<number, ChatOfferState>;
  pendingDrawActions: ReadonlySet<string>;
  onDrawDecision?: OfferDecisionHandler | null;
  rematchOfferState: ReadonlyMap<number, ChatOfferState>;
  pendingRematchActions: ReadonlySet<string>;
  onRematchDecision?: OfferDecisionHandler | null;
}

/** Build the empty-list placeholder. */
export function makeEmptyChatNode(): HTMLParagraphElement {
  const empty = document.createElement("p");
  empty.className = "chat-empty";
  empty.textContent = "No messages yet.";
  return empty;
}

/** Build the notice shown when chat is unavailable in an engine game. */
export function makePveOfflineChatNode(): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "chat-pve-notice";
  wrap.setAttribute("role", "note");
  const text = document.createElement("p");
  text.textContent =
    "Chat is only available in PvP games. Play online or invite a friend to use messages feature.";
  wrap.appendChild(text);
  return wrap;
}

function makeMessageShell(
  message: ChatMessage,
  currentUserId: string,
  extraClass = "",
): { row: HTMLElement; name: HTMLElement } {
  const row = document.createElement("article");
  row.className = "chat-message";
  if (extraClass) row.classList.add(extraClass);
  if (currentUserId && message.user_id === currentUserId) row.classList.add("mine");

  const meta = document.createElement("div");
  meta.className = "chat-message-meta";
  const name = document.createElement("span");
  name.className = "chat-message-name";
  name.textContent = safeText(message.username, "Player");
  const separator = document.createElement("span");
  separator.className = "chat-message-sep";
  separator.textContent = "•";
  const time = document.createElement("span");
  time.className = "chat-message-time";
  time.textContent = formatChatMessageTime(message.created_at);
  meta.append(name, separator, time);
  row.appendChild(meta);
  return { row, name };
}

function makeMessageBody(text: unknown): HTMLParagraphElement {
  const body = document.createElement("p");
  body.className = "chat-message-body";
  body.textContent = safeText(text, "");
  return body;
}

function appendDecisionButtons(
  row: HTMLElement,
  offerId: number,
  pendingActions: ReadonlySet<string>,
  onDecision: OfferDecisionHandler,
): void {
  const actions = document.createElement("div");
  actions.className = "chat-system-actions";
  const acceptButton = document.createElement("button");
  acceptButton.className = "game-btn-primary game-btn-sm";
  acceptButton.type = "button";
  acceptButton.textContent = "Accept";
  const rejectButton = document.createElement("button");
  rejectButton.className = "game-btn-danger-outline game-btn-sm";
  rejectButton.type = "button";
  rejectButton.textContent = "Reject";
  const disabled = pendingActions.has(`${offerId}:accept`) || pendingActions.has(`${offerId}:reject`);
  acceptButton.disabled = disabled;
  rejectButton.disabled = disabled;
  acceptButton.addEventListener("click", () => void onDecision(offerId, "accept"));
  rejectButton.addEventListener("click", () => void onDecision(offerId, "reject"));
  actions.append(acceptButton, rejectButton);
  row.appendChild(actions);
}

function makeOfferNode(
  message: ChatMessage,
  label: "Draw" | "Rematch",
  state: ChatOfferState,
  currentUserId: string,
  pendingActions: ReadonlySet<string>,
  onDecision?: OfferDecisionHandler | null,
): HTMLElement {
  const offeredBy = safeText(state.offeredBy, "Player");
  const isMine = Boolean(currentUserId && state.offeredByUserId === currentUserId);
  const { row, name } = makeMessageShell(message, "", "system");
  name.textContent = label;
  if (state.status === "accepted") {
    const suffix = label === "Rematch" && state.gameId ? " Starting rematch…" : "";
    row.appendChild(makeMessageBody(`${label} accepted by ${safeText(state.actor, "Player")}.${suffix}`));
  } else if (state.status === "rejected") {
    row.appendChild(makeMessageBody(`${label} rejected by ${safeText(state.actor, "Player")}.`));
  } else {
    const action = label.toLowerCase();
    row.appendChild(makeMessageBody(isMine ? `You offered a ${action}.` : `${offeredBy} offered a ${action}.`));
    if (!isMine && onDecision) appendDecisionButtons(row, state.offerId, pendingActions, onDecision);
  }
  return row;
}

/** Route one chat row to its plain or server-system renderer. */
export function makeChatMessageNode(
  message: ChatMessage,
  options: MessageRenderOptions,
): HTMLElement | null {
  const parsed = parseChatSystemMessage(message.body);
  if (!parsed) {
    const { row } = makeMessageShell(message, options.currentUserId);
    row.appendChild(makeMessageBody(message.body));
    return row;
  }
  if (parsed.kind === "draw_offer") {
    const state = options.drawOfferState.get(parsed.offerId) ?? {
      offerId: parsed.offerId,
      status: "pending",
      offeredBy: safeText(parsed.offeredBy, safeText(message.username, "Player")),
      offeredByUserId: safeText(parsed.offeredByUserId, message.user_id),
    };
    return makeOfferNode(message, "Draw", state, options.currentUserId, options.pendingDrawActions, options.onDrawDecision);
  }
  if (parsed.kind === "rematch_offer") {
    const state = options.rematchOfferState.get(parsed.offerId) ?? {
      offerId: parsed.offerId,
      status: "pending",
      offeredBy: safeText(parsed.offeredBy, safeText(message.username, "Player")),
      offeredByUserId: safeText(parsed.offeredByUserId, message.user_id),
    };
    return makeOfferNode(message, "Rematch", state, options.currentUserId, options.pendingRematchActions, options.onRematchDecision);
  }
  if (parsed.kind === "surrender") {
    const { row, name } = makeMessageShell(message, "", "system");
    name.textContent = "Surrender";
    row.appendChild(makeMessageBody(`${safeText(parsed.actor, "Player")} surrendered.`));
    return row;
  }
  return null;
}

