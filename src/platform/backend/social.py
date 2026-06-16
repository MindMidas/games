"""Game-scoped chat, draw, rematch, and surrender orchestration.""";

from __future__ import annotations;

import sys;
import uuid;
from datetime import UTC, datetime;
from typing import Any, Callable;

from .chat_queue import ChatOutboundQueue;
from .contracts import (
    DRAW_OFFER_PREFIX,
    DRAW_OFFER_UPDATE_PREFIX,
    MAX_DRAW_OFFERS_PER_USER,
    MAX_REMATCH_OFFERS_PER_USER,
    MODE_PVP,
    REMATCH_OFFER_PREFIX,
    REMATCH_OFFER_UPDATE_PREFIX,
    SURRENDER_PREFIX,
    STATUS_ACTIVE,
    STATUS_FINISHED,
    TERMINAL_STATUSES,
    ChatRow,
    SystemChatRow,
);
from .db import Database;
from .errors import ServiceError;
from .models import AuthUser;
from .runtimes import GameRuntime;

_RESERVED_CHAT_PREFIXES = (
    DRAW_OFFER_PREFIX,
    DRAW_OFFER_UPDATE_PREFIX,
    REMATCH_OFFER_PREFIX,
    REMATCH_OFFER_UPDATE_PREFIX,
    SURRENDER_PREFIX,
);

def _parse_offer_body(body: str, prefix: str) -> dict[str, Any] | None:
    """Parse a pending draw or rematch offer.""";
    text = str(body or "").strip();
    if not text.startswith(prefix):
        return None;
    parts = text.split("|");
    if len(parts) < 4:
        return None;
    try:
        offer_id = int(parts[1]);
    except (TypeError, ValueError):
        return None;
    return {
        "offer_id": offer_id,
        "status": str(parts[2] or "pending").lower(),
        "offered_by_user_id": str(parts[3] or "") if len(parts) >= 5 else "",
        "offered_by": "|".join(parts[4:] if len(parts) >= 5 else parts[3:]) or "Player",
    };

def _parse_offer_update_body(body: str, prefix: str, *, include_game_id: bool = False) -> dict[str, Any] | None:
    """Parse a draw or rematch response body.""";
    text = str(body or "").strip();
    if not text.startswith(prefix):
        return None;
    parts = text.split("|");
    if len(parts) < 4:
        return None;
    try:
        offer_id = int(parts[1]);
    except (TypeError, ValueError):
        return None;
    has_actor_id = len(parts) >= 5;
    payload = {
        "offer_id": offer_id,
        "decision": str(parts[2] or "").lower(),
        "actor_user_id": str(parts[3] or "") if has_actor_id else "",
        "actor": "|".join(parts[4:] if has_actor_id else parts[3:]) or "Player",
    };
    if include_game_id:
        if len(parts) >= 6:
            payload["actor"] = str(parts[4] or "") or "Player";
            payload["game_id"] = str(parts[5] or "");
        else:
            payload["game_id"] = "";
    return payload;

def _build_offer_state(
    rows: list[dict[str, Any]],
    *,
    offer_prefix: str,
    update_prefix: str,
    include_game_id: bool = False,
) -> dict[int, dict[str, Any]]:
    """Fold chronological system-message rows into current offer state.""";
    state: dict[int, dict[str, Any]] = {};
    for row in rows:
        body = str(row.get("body") or "");
        offer = _parse_offer_body(body, offer_prefix);
        if offer is not None:
            state[int(offer["offer_id"])] = offer;
            continue;
        update = _parse_offer_update_body(body, update_prefix, include_game_id=include_game_id);
        if update is None:
            continue;
        offer_id = int(update["offer_id"]);
        decision = str(update.get("decision") or "").lower();
        entry = state.get(offer_id) or {"offer_id": offer_id, "status": "pending"};
        entry.update(update);
        entry["status"] = "accepted" if decision == "accept" else "rejected";
        state[offer_id] = entry;
    return state;

def _parse_draw_offer_body(body: str) -> dict[str, Any] | None:
    """Parse draw offer body.""";
    return _parse_offer_body(body, DRAW_OFFER_PREFIX);

def _parse_draw_offer_update_body(body: str) -> dict[str, Any] | None:
    """Parse draw offer update body.""";
    return _parse_offer_update_body(body, DRAW_OFFER_UPDATE_PREFIX);

def _build_draw_offer_state(rows: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Build draw offer state.""";
    return _build_offer_state(rows, offer_prefix=DRAW_OFFER_PREFIX, update_prefix=DRAW_OFFER_UPDATE_PREFIX);

def _parse_rematch_offer_body(body: str) -> dict[str, Any] | None:
    """Parse rematch offer body.""";
    return _parse_offer_body(body, REMATCH_OFFER_PREFIX);

def _parse_rematch_offer_update_body(body: str) -> dict[str, Any] | None:
    """Parse rematch offer update body.""";
    return _parse_offer_update_body(body, REMATCH_OFFER_UPDATE_PREFIX, include_game_id=True);

def _build_rematch_offer_state(rows: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Build rematch offer state.""";
    return _build_offer_state(
        rows,
        offer_prefix=REMATCH_OFFER_PREFIX,
        update_prefix=REMATCH_OFFER_UPDATE_PREFIX,
        include_game_id=True,
    );

class SocialService:
    """Own social DB operations and delegate game outcomes to registered runtimes.""";

    def __init__(self, database: Database, runtime: Callable[[str], GameRuntime]) -> None:

        self.database = database;
        self.runtime = runtime;
        self.chat_queue = ChatOutboundQueue(
            persist_batch=self._persist_chat_batch,
            broadcast_batch=self._broadcast_chat_batch,
            log_tag="games.chat",
        );
        self.chat_queue.start();

    def close(self) -> None:
        """Stop the write-behind chat worker.""";
        self.chat_queue.stop(graceful_timeout=1.0);

    def verify_game_member(self, user_id: str, game_id: str) -> str:
        """Return a normalized game id after DB-backed membership validation.""";
        return str(self._member_row(user_id, game_id)["id"]);

    def queue_status(self) -> dict[str, int | bool]:
        """Return bounded chat queue health for clients.""";
        return dict(self.chat_queue.status());

    def queue_status_for_client(self, user_id: str, game_id: str | None) -> dict[str, Any]:
        """Return queue health after optional game membership validation.""";
        requested_game_id = str(game_id or "").strip();
        if requested_game_id:
            self.verify_game_member(user_id, requested_game_id);
        return {"ok": True, "chat_queue": self.queue_status()};

    def chat_messages(
        self,
        user_id: str,
        since_id: int | None = None,
        *,
        game_id: str,
    ) -> dict[str, Any]:
        """Return one game's chat history after membership validation.""";
        authorized_game_id = self.verify_game_member(user_id, game_id);
        filters: dict[str, Any] = {"game_id": authorized_game_id};
        if since_id is not None:
            filters["id"] = ("gt", since_id);
        rows = self.database.select(
            "app_game_messages",
            columns="id,body,created_at,user_id,game_id",
            filters=filters,
            order="id.asc",
            limit=200,
        );
        usernames = self._chat_usernames([row.get("user_id") for row in rows]);
        return {
            "game_id": authorized_game_id,
            "messages": [
                self._format_chat_row({**row, "username": usernames.get(str(row.get("user_id") or ""))})
                for row in rows
            ],
        };

    def post_chat_message(self, user: AuthUser, message: str, *, game_id: str) -> dict[str, Any]:
        """Queue a validated game-scoped chat message for persistence and SSE.""";
        row = self._member_row(user.id, game_id);
        authorized_game_id = str(row["id"]);
        body = self._normalize_chat_message(message);
        payload: dict[str, Any] = {
            "id": f"tmp_{uuid.uuid4().hex}",
            "game_id": authorized_game_id,
            "user_id": user.id,
            "username": user.username,
            "body": body,
            "created_at": datetime.now(UTC).isoformat(),
        };
        if not self.chat_queue.enqueue(authorized_game_id, payload, game_type=str(row.get("game_type") or "")):
            raise ServiceError(
                503,
                "Chat queue is full; try again shortly.",
                extra={"chat_queue": self.queue_status()},
            );
        payload["chat_queue"] = self.queue_status();
        return payload;

    def offer_draw(self, user: AuthUser, *, game_id: str) -> dict[str, Any]:
        """Create a pending draw offer encoded as a chat system message.""";
        authorized_game_id, _row = self._require_pvp_game(user.id, game_id, active=True);
        rows = self._offer_rows(authorized_game_id);
        if self._offer_count(rows, user.id, DRAW_OFFER_PREFIX) >= MAX_DRAW_OFFERS_PER_USER:
            raise ServiceError(409, "You can only offer a draw twice per game.");
        if any(
            str(entry.get("offered_by_user_id") or "") == user.id
            and str(entry.get("status") or "pending") == "pending"
            for entry in _build_draw_offer_state(rows).values()
        ):
            raise ServiceError(409, "You already have a pending draw offer.");
        offer_id = self._next_offer_id(rows, _parse_draw_offer_body);
        return self._post_system_message(
            user,
            f"{DRAW_OFFER_PREFIX}{offer_id}|pending|{user.id}|{user.username}",
            game_id=authorized_game_id,
        );

    def respond_draw(self, user: AuthUser, *, game_id: str, offer_id: int, accept: bool) -> dict[str, Any]:
        """Accept or reject a pending draw offer.""";
        authorized_game_id, row = self._require_pvp_game(user.id, game_id, active=True);
        positive_offer_id = self._positive_offer_id(offer_id);
        entry = _build_draw_offer_state(self._offer_rows(authorized_game_id)).get(positive_offer_id);
        self._require_pending_offer(entry, user.id, "Draw");
        decision = "accept" if accept else "reject";
        message = self._post_system_message(
            user,
            f"{DRAW_OFFER_UPDATE_PREFIX}{positive_offer_id}|{decision}|{user.id}|{user.username}",
            game_id=authorized_game_id,
        );
        payload: dict[str, Any] = {"ok": True, "message": message};
        if accept:
            payload["game_over"] = self.runtime(str(row["game_type"])).agree_draw(user.id, authorized_game_id);
        return payload;

    def offer_rematch(self, user: AuthUser, *, game_id: str) -> dict[str, Any]:
        """Create a pending rematch offer encoded as a chat system message.""";
        authorized_game_id, _row = self._require_pvp_game(user.id, game_id, active=False);
        rows = self._offer_rows(authorized_game_id);
        if self._offer_count(rows, user.id, REMATCH_OFFER_PREFIX) >= MAX_REMATCH_OFFERS_PER_USER:
            raise ServiceError(409, "You can only offer a rematch twice per game.");
        if any(
            str(entry.get("offered_by_user_id") or "") == user.id
            and str(entry.get("status") or "pending") == "pending"
            for entry in _build_rematch_offer_state(rows).values()
        ):
            raise ServiceError(409, "You already have a pending rematch offer.");
        offer_id = self._next_offer_id(rows, _parse_rematch_offer_body);
        return self._post_system_message(
            user,
            f"{REMATCH_OFFER_PREFIX}{offer_id}|pending|{user.id}|{user.username}",
            game_id=authorized_game_id,
        );

    def respond_rematch(self, user: AuthUser, *, game_id: str, offer_id: int, accept: bool) -> dict[str, Any]:
        """Accept or reject a pending rematch offer.""";
        authorized_game_id, row = self._require_pvp_game(user.id, game_id, active=False);
        positive_offer_id = self._positive_offer_id(offer_id);
        entry = _build_rematch_offer_state(self._offer_rows(authorized_game_id)).get(positive_offer_id);
        self._require_pending_offer(entry, user.id, "Rematch");
        decision = "accept" if accept else "reject";
        new_game_id = "";
        if accept:
            new_game_id = self.runtime(str(row["game_type"])).create_rematch(
                str(entry.get("offered_by_user_id") or ""),
                user.id,
            );
        message = self._post_system_message(
            user,
            f"{REMATCH_OFFER_UPDATE_PREFIX}{positive_offer_id}|{decision}|{user.id}|{user.username}|{new_game_id}",
            game_id=authorized_game_id,
        );
        payload: dict[str, Any] = {"ok": True, "message": message};
        if new_game_id:
            payload["rematch"] = {"game_id": new_game_id, "mode": MODE_PVP};
        return payload;

    def surrender(self, user_id: str, *, game_id: str, cause: str | None = None) -> dict[str, Any]:
        """End one game by surrender after membership validation.""";
        row = self._member_row(user_id, game_id);
        return self.runtime(str(row["game_type"])).surrender(user_id, str(row["id"]), cause);

    def _require_pvp_game(self, user_id: str, game_id: str, *, active: bool) -> tuple[str, dict[str, Any]]:
        """Require a PvP game.""";
        row = self._member_row(user_id, game_id);
        status = str(row.get("status") or "");
        if active and status != STATUS_ACTIVE:
            raise ServiceError(409, "Game is not active.");
        if not active and status not in TERMINAL_STATUSES and status != STATUS_FINISHED:
            raise ServiceError(409, "Rematch is only available after the game ends.");
        if str(row.get("mode") or "") != MODE_PVP:
            action = "Draw offers" if active else "Rematch";
            raise ServiceError(400, f"{action} {'are' if active else 'is'} only available in PvP games.");
        return str(row["id"]), row;

    def _member_row(self, user_id: str, game_id: str) -> dict[str, Any]:
        """Return a verified game member row.""";
        return dict(self.database.require_game_member(user_id, game_id));

    def _offer_rows(self, game_id: str) -> list[dict[str, Any]]:
        """Return social offer rows.""";
        return self.database.select(
            "app_game_messages",
            columns="id,user_id,body,created_at,game_id",
            filters={"game_id": game_id},
            order="id.asc",
            limit=500,
        );

    def _chat_usernames(self, user_ids: list[Any]) -> dict[str, str]:
        """Return usernames for chat rows.""";
        ids = sorted({str(user_id) for user_id in user_ids if user_id});
        if not ids:
            return {};
        rows = self.database.select("app_users", columns="id,username", filters={"id": ("in", ids)});
        return {str(row["id"]): str(row.get("username") or "User") for row in rows if row.get("id")};

    def _persist_chat_batch(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Persist a chat batch.""";
        inserted = self.database.insert(
            "app_game_messages",
            [{key: value for key, value in row.items() if key != "username"} for row in rows],
        );
        return [
            self._format_chat_row({**row, "username": rows[index].get("username")})
            for index, row in enumerate(inserted)
            if isinstance(row, dict)
        ];

    def _post_system_message(self, user: AuthUser, message: str, *, game_id: str) -> dict[str, Any]:
        """Persist and broadcast one server-generated social control message.""";
        row = self._member_row(user.id, game_id);
        authorized_game_id = str(row["id"]);
        body = self._normalize_chat_message(message, allow_system=True);
        system_row: SystemChatRow = {
            "game_id": authorized_game_id,
            "user_id": user.id,
            "username": user.username,
            "body": body,
            "created_at": datetime.now(UTC).isoformat(),
        };
        saved = self._persist_chat_batch([system_row]);
        if not saved:
            raise ServiceError(502, "System message could not be persisted.");
        self._broadcast_chat_batch(authorized_game_id, str(row.get("game_type") or ""), saved);
        return saved[0];

    def _broadcast_chat_batch(self, game_id: str, game_type: str, rows: list[dict[str, Any]]) -> None:
        """Broadcast a chat batch.""";
        if not rows:
            return;
        sender_id = str(rows[0].get("user_id") or "");
        try:
            self.runtime(game_type).broadcast_chat(sender_id, game_id, [ChatRow(**row) for row in rows]);
        except ServiceError as exc:
            sys.stderr.write(f"[games.chat] broadcast failed game_id={game_id!r} game_type={game_type!r}: {exc!r}\n");

    @staticmethod
    def _normalize_chat_message(value: str, *, allow_system: bool = False) -> str:
        """Normalize a chat message.""";
        message = str(value or "").strip();
        if not message:
            raise ServiceError(400, "Message cannot be empty");
        if len(message) > 500:
            raise ServiceError(400, "Message is too long");
        if not allow_system and message.startswith(_RESERVED_CHAT_PREFIXES):
            raise ServiceError(400, "Reserved system message prefix.");
        return message;

    @staticmethod
    def _format_chat_row(row: dict[str, Any]) -> dict[str, Any]:
        """Format a chat row.""";
        return {
            "id": int(row["id"]),
            "game_id": row.get("game_id"),
            "user_id": row.get("user_id"),
            "username": row.get("username", "User"),
            "body": row.get("body", ""),
            "created_at": row.get("created_at"),
        };

    @staticmethod
    def _offer_count(rows: list[dict[str, Any]], user_id: str, prefix: str) -> int:
        """Return the number of offers by a user.""";
        return sum(
            1 for row in rows
            if str(row.get("user_id") or "") == user_id and str(row.get("body") or "").startswith(prefix)
        );

    @staticmethod
    def _next_offer_id(rows: list[dict[str, Any]], parse: Callable[[str], dict[str, Any] | None]) -> int:
        """Return the next social offer id.""";
        ids = [int(parsed["offer_id"]) for row in rows if (parsed := parse(str(row.get("body") or ""))) is not None];
        return max(ids, default=0) + 1;

    @staticmethod
    def _positive_offer_id(offer_id: int) -> int:
        """Validate a positive offer id.""";
        try:
            value = int(offer_id);
        except (TypeError, ValueError) as exc:
            raise ServiceError(400, "offer_id must be an integer") from exc;
        if value <= 0:
            raise ServiceError(400, "offer_id must be positive");
        return value;

    @staticmethod
    def _require_pending_offer(entry: dict[str, Any] | None, user_id: str, label: str) -> None:
        """Require a pending offer.""";
        if entry is None:
            raise ServiceError(404, f"{label} offer not found.");
        if str(entry.get("status") or "pending") != "pending":
            raise ServiceError(409, f"This {label.lower()} offer is no longer pending.");
        if str(entry.get("offered_by_user_id") or "") == user_id:
            raise ServiceError(403, f"You cannot respond to your own {label.lower()} offer.");
