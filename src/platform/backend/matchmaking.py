"""Presence, matchmaking, invites, and game-creation orchestration.""";

from __future__ import annotations;

import dataclasses;
import secrets;
import threading;
import uuid;
from datetime import UTC, datetime, timedelta;
from typing import Any, Callable;

from .db import Database;
from .errors import ServiceError;
from .game_registry import GameDef, get_game_def;
from .models import AuthUser;
from .runtimes import GameRuntime;
from .contracts import PresenceRow;

MATCH_START_DELAY_SECONDS = 5;
INVITE_TTL_MINUTES = 5;
_MATCH_TTL_SECONDS = 300;

def _utc_now() -> datetime:
    """Return the current UTC time.""";
    return datetime.now(UTC);

@dataclasses.dataclass
class _WaitingEntry:
    user_id: str;
    username: str;
    photo_url: str | None;
    joined_at: datetime;

@dataclasses.dataclass
class _MatchedEntry:
    match_id: str;
    opponent_id: str;
    opponent_name: str;
    opponent_photo: str | None;
    matched_at: datetime;
    ready_at: datetime;

class _MatchmakingQueue:
    """Keep low-latency queue state partitioned by game type.""";

    def __init__(self, now: Callable[[], datetime] = _utc_now) -> None:

        self._lock = threading.Lock();
        self._waiting: dict[str, _WaitingEntry] = {};
        self._matched: dict[str, _MatchedEntry] = {};
        self._now = now;

    def join(self, entry: _WaitingEntry) -> tuple[str, _WaitingEntry] | None:
        """Queue one user and return a new pair when an opponent is waiting.""";
        with self._lock:
            self._prune();
            self._matched.pop(entry.user_id, None);
            opponent = next((waiting for user_id, waiting in self._waiting.items() if user_id != entry.user_id), None);
            if opponent is None:
                self._waiting[entry.user_id] = entry;
                return None;
            del self._waiting[opponent.user_id];
            match_id = str(uuid.uuid4());
            now = self._now();
            ready_at = now + timedelta(seconds=MATCH_START_DELAY_SECONDS);
            self._matched[entry.user_id] = _MatchedEntry(match_id, opponent.user_id, opponent.username, opponent.photo_url, now, ready_at);
            self._matched[opponent.user_id] = _MatchedEntry(match_id, entry.user_id, entry.username, entry.photo_url, now, ready_at);
            return match_id, opponent;

    def status(self, user_id: str) -> _MatchedEntry | _WaitingEntry | None:
        """Return one user's in-memory queue state.""";
        with self._lock:
            self._prune();
            return self._matched.get(user_id) or self._waiting.get(user_id);

    def cancel(self, user_id: str) -> None:
        """Remove a user from local waiting and matched state.""";
        with self._lock:
            self._waiting.pop(user_id, None);
            self._matched.pop(user_id, None);

    def waiting_user_ids(self) -> set[str]:
        """Return a snapshot used to decorate online-player payloads.""";
        with self._lock:
            return set(self._waiting);

    def restore_waiting(self, entry: _WaitingEntry) -> None:
        """Restore durable waiting state after process restart.""";
        with self._lock:
            if entry.user_id not in self._matched:
                self._waiting.setdefault(entry.user_id, entry);

    def restore_matched(self, user_id: str, entry: _MatchedEntry) -> None:
        """Restore durable matched state after process restart.""";
        with self._lock:
            self._matched.setdefault(user_id, entry);

    def _prune(self) -> None:
        """Prune stale matchmaking entries.""";
        cutoff = self._now() - timedelta(seconds=_MATCH_TTL_SECONDS);
        for user_id in [user_id for user_id, match in self._matched.items() if match.matched_at < cutoff]:
            del self._matched[user_id];

class MatchmakingService:
    """Own lobby DB flows and delegate game materialization to runtimes.""";

    def __init__(
        self,
        database: Database,
        runtime: Callable[[str], GameRuntime],
        *,
        online_presence_seconds: int,
        now: Callable[[], datetime] = _utc_now,
    ) -> None:

        self.database = database;
        self.runtime = runtime;
        self.online_presence_seconds = online_presence_seconds;
        self.now = now;
        self.queues: dict[str, _MatchmakingQueue] = {};
        self.queues_lock = threading.Lock();

    def ping_presence(self, user: AuthUser, game_type: str) -> dict[str, Any]:
        """Upsert the user's currently selected game heartbeat.""";
        game_type = self._normalize_game_type(game_type);
        now_iso = self.database.iso_datetime(self.now());
        row = self.database.select_one("app_presence", filters={"user_id": user.id});
        data: PresenceRow = {"user_id": user.id, "game_type": game_type, "last_seen": now_iso};
        if row is None:
            self.database.insert("app_presence", data);
        else:
            self.database.update("app_presence", data, filters={"user_id": user.id}, returning="minimal");
        return {"ok": True, "last_seen": now_iso};

    def players_online(self, user: AuthUser, game_type: str, *, touch_presence: bool = True) -> dict[str, Any]:
        """Return recently active users with one batched profile read.""";
        game_type = self._normalize_game_type(game_type);
        if touch_presence:
            self.ping_presence(user, game_type);
        rows = self.database.select(
            "app_presence",
            columns="user_id,last_seen",
            filters={
                "game_type": game_type,
                "last_seen": ("gte", self.database.iso_datetime(self.now() - timedelta(seconds=self.online_presence_seconds))),
            },
            order="last_seen.desc",
            limit=100,
        );
        visible_rows = [row for row in rows if str(row.get("user_id") or "") and str(row.get("user_id")) != user.id];
        profiles = self._profiles([str(row["user_id"]) for row in visible_rows]);
        waiting = self._queue(game_type).waiting_user_ids();
        return {
            "online_count": len(rows),
            "players": [
                {
                    "user_id": user_id,
                    "username": profiles.get(user_id, {}).get("username") or "Player",
                    "photo_url": profiles.get(user_id, {}).get("photo_url"),
                    "last_seen": row.get("last_seen"),
                    "waiting": user_id in waiting,
                }
                for row in visible_rows
                if (user_id := str(row.get("user_id") or ""))
            ],
        };

    def matchmaking_join(self, user: AuthUser, game_type: str) -> dict[str, Any]:
        """Enter matchmaking unless the player already has an unfinished game.""";
        game_type = self._normalize_game_type(game_type);
        self._require_no_unfinished_game(user.id, game_type);
        self.ping_presence(user, game_type);
        now_iso = self.database.iso_datetime(self.now());
        existing = self.database.select_one("app_match_queue", filters={"user_id": user.id, "game_type": game_type});
        payload = {"status": "waiting", "match_id": None, "updated_at": now_iso};
        if existing is None:
            self.database.insert("app_match_queue", {"user_id": user.id, "game_type": game_type, "created_at": now_iso, **payload});
        else:
            self.database.update("app_match_queue", payload, filters={"id": existing["id"]}, returning="minimal");
        entry = _WaitingEntry(user.id, user.username, user.photo_url, self.now());
        pair = self._queue(game_type).join(entry);
        if pair is None:
            return {"status": "waiting"};
        match_id, opponent = pair;
        self._provision_live_match(game_type, match_id, entry.user_id, opponent.user_id);
        match = self._queue(game_type).status(user.id);
        return self._status_payload(match) if isinstance(match, _MatchedEntry) else {"status": "waiting"};

    def matchmaking_status(self, user_id: str, game_type: str) -> dict[str, Any]:
        """Return local queue state or hydrate it from Supabase.""";
        game_type = self._normalize_game_type(game_type);
        entry = self._queue(game_type).status(user_id);
        if isinstance(entry, _MatchedEntry):
            return self._status_payload(entry);
        if isinstance(entry, _WaitingEntry):
            return {"status": "waiting"};
        return self._status_from_db(user_id, game_type);

    def matchmaking_cancel(self, user_id: str, game_type: str) -> dict[str, Any]:
        """Remove one player from durable and in-memory queue state.""";
        game_type = self._normalize_game_type(game_type);
        self._queue(game_type).cancel(user_id);
        self.database.delete("app_match_queue", filters={"user_id": user_id, "game_type": game_type}, returning="minimal");
        return {"status": "cancelled"};

    def invite_create(self, user_id: str, game_type: str) -> dict[str, Any]:
        """Create an expiring invite with insert-first collision handling.""";
        game_type = self._normalize_game_type(game_type);
        self._require_no_unfinished_game(user_id, game_type);
        now = self.now();
        code = _short_code();
        for attempt in range(2):
            try:
                self.database.insert(
                    "app_game_invites",
                    {
                        "id": str(uuid.uuid4()),
                        "game_type": game_type,
                        "inviter_user_id": user_id,
                        "code": code,
                        "status": "pending",
                        "created_at": self.database.iso_datetime(now),
                        "expires_at": self.database.iso_datetime(now + timedelta(minutes=INVITE_TTL_MINUTES)),
                    },
                );
                break;
            except ServiceError as exc:
                if exc.status != 409 or attempt:
                    raise;
                code = _short_code();
        return {"ok": True, "code": code, "link": f"/lobby?game={game_type}&invite={code}", "expires_in_seconds": INVITE_TTL_MINUTES * 60};

    def invite_join(self, user_id: str, game_type: str, code: str) -> dict[str, Any]:
        """Accept an invite and provision one ready PvP match.""";
        game_type = self._normalize_game_type(game_type);
        self._require_no_unfinished_game(user_id, game_type);
        raw = str(code or "").strip().lower();
        if not raw:
            raise ServiceError(400, "Invite code is required");
        match_id = str(uuid.uuid4());
        accepted = self._rpc_result(
            self.database.rpc(
                "app_accept_game_invite",
                {
                    "p_game_type": game_type,
                    "p_code": raw,
                    "p_invitee_user_id": user_id,
                    "p_match_id": match_id,
                },
            ),
        );
        self._raise_rpc_error(accepted);
        inviter_id = str(accepted.get("inviter_user_id") or "");
        if not inviter_id:
            raise ServiceError(502, "Invite acceptance returned no inviter");
        profiles = self._profiles([inviter_id, user_id]);
        if inviter_id not in profiles or user_id not in profiles:
            raise ServiceError(404, "Player not found");
        ready_at = str(accepted.get("ready_at") or "") or self.database.iso_datetime(self.now());
        return {
            "status": "opponent_found",
            "match_id": match_id,
            "opponent": self._opponent_payload(inviter_id, profiles[inviter_id]),
            "starts_at": self.database.iso_datetime(self.database.parse_iso_datetime(ready_at) + timedelta(seconds=MATCH_START_DELAY_SECONDS)),
            "starts_in_seconds": MATCH_START_DELAY_SECONDS,
        };

    def invite_status(self, user_id: str, game_type: str) -> dict[str, Any]:
        """Return the inviter's newest pending or accepted invite.""";
        game_type = self._normalize_game_type(game_type);
        invite = self.database.select_one(
            "app_game_invites",
            columns="id,status,match_id,invitee_user_id,expires_at",
            filters={"game_type": game_type, "inviter_user_id": user_id},
            order="created_at.desc",
        );
        if not isinstance(invite, dict) or invite.get("status") not in {"pending", "accepted"}:
            return {"status": "none"};
        if invite["status"] == "pending":
            return {"status": "none"} if self._expired(invite.get("expires_at")) else {"status": "pending"};
        invitee_id = str(invite.get("invitee_user_id") or "");
        profile = self._profiles([invitee_id]).get(invitee_id, {}) if invitee_id else {};
        opponent = self._opponent_payload(invitee_id, profile) if invitee_id else None;
        queue_row = self.database.select_one("app_match_queue", filters={"user_id": user_id, "game_type": game_type});
        ready_at = self._match_ready_at(queue_row);
        now = self.now();
        if ready_at is not None and now < ready_at:
            return {
                "status": "opponent_found",
                "match_id": invite.get("match_id"),
                "opponent": opponent,
                "starts_at": self.database.iso_datetime(ready_at),
                "starts_in_seconds": max(0, int((ready_at - now).total_seconds())),
            };
        return {"status": "matched", "match_id": invite.get("match_id"), "opponent": opponent};

    def active_pvp_game(self, user_id: str, game_type: str) -> dict[str, Any]:
        """Return the newest unfinished game shape used by lobby clients.""";
        game_id, mode = self.active_incomplete_game(user_id, game_type);
        return {"has_active": bool(game_id), "game_id": game_id, "mode": mode};

    def active_incomplete_game(self, user_id: str, game_type: str) -> tuple[str | None, str | None]:
        """Prefer active PvP, then the registered offline mode.""";
        game_type = self._normalize_game_type(game_type);
        game = get_game_def(game_type);
        game_id = self.existing_unfinished_pvp_game_id(user_id, game_type);
        if game_id:
            return game_id, game.pvp_mode;
        game_id = self.existing_unfinished_game_by_mode(user_id, game_type, game.offline_mode);
        return (game_id, game.offline_mode) if game_id else (None, None);

    def new_game(self, user_id: str, game_type: str, mode: str | None, body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Create or reuse one offline or matched PvP game.""";
        game_type = self._normalize_game_type(game_type);
        game = get_game_def(game_type);
        resolved = _resolve_mode(mode, game);
        payload = body if isinstance(body, dict) else {};
        if resolved == game.pvp_mode:
            match_id = self._resolve_match_id(user_id, game_type, str(payload.get("match_id") or "").strip() or None);
            if match_id:
                reused = self._active_match_exists(match_id, game_type);
                return self._new_game_payload(self._create_or_load_pvp(user_id, game_type, match_id), game, game.pvp_mode, reused=reused);
            existing = self.existing_unfinished_pvp_game_id(user_id, game_type);
            if existing:
                return self._new_game_payload(existing, game, game.pvp_mode, reused=True);
            return self._new_game_payload(self._create_or_load_pvp(user_id, game_type, None), game, game.pvp_mode);
        if self.existing_unfinished_pvp_game_id(user_id, game_type):
            raise ServiceError(409, game.err_pvp_blocks_offline);
        existing = self.existing_unfinished_game_by_mode(user_id, game_type, game.offline_mode);
        if existing:
            self.runtime(game_type).reuse_offline(existing);
            return self._new_game_payload(existing, game, game.offline_mode, reused=True);
        return self._new_game_payload(self.runtime(game_type).create_offline(user_id, payload), game, game.offline_mode);

    def existing_unfinished_pvp_game_id(self, user_id: str, game_type: str) -> str | None:
        """Return newest active PvP row across the persisted seat columns.""";
        game_type = self._normalize_game_type(game_type);
        seen: dict[str, dict[str, Any]] = {};
        for seat in ("player_a_id", "player_b_id", "user_id"):
            for row in self.database.select(
                "app_games",
                columns="id,updated_at",
                filters={"game_type": game_type, "status": "active", "mode": "pvp", seat: user_id},
                order="updated_at.desc",
                limit=40,
            ):
                game_id = str(row.get("id") or "");
                if game_id and str(row.get("updated_at") or "") >= str(seen.get(game_id, {}).get("updated_at") or ""):
                    seen[game_id] = row;
        if not seen:
            return None;
        game_id = str(max(seen.values(), key=lambda row: str(row.get("updated_at") or "")).get("id") or "") or None;
        if game_id and self._reconcile_expired(user_id, game_type, game_id):
            return None;
        return game_id;

    def existing_unfinished_game_by_mode(self, user_id: str, game_type: str, mode: str) -> str | None:
        """Return newest active owned game for an offline mode.""";
        rows = self.database.select(
            "app_games",
            columns="id,updated_at",
            filters={"game_type": self._normalize_game_type(game_type), "status": "active", "mode": mode, "user_id": user_id},
            order="updated_at.desc",
            limit=1,
        );
        return str(rows[0].get("id") or "") or None if rows else None;

    def _create_or_load_pvp(self, user_id: str, game_type: str, match_id: str | None) -> str:
        """Create or load pvp.""";
        match_id = str(match_id or "").strip() or self._matched_match_id(user_id, game_type);
        if not match_id:
            raise ServiceError(409, "No active matchmaking match. Join matchmaking first.");
        match = self._live_match(match_id, game_type);
        player_a_id, player_b_id = self._assert_player(user_id, match);
        if self._active_match_exists(match_id, game_type):
            return match_id;
        try:
            self.runtime(game_type).activate_pvp(user_id, match_id, player_a_id, player_b_id, match);
        except ServiceError as exc:
            if exc.status != 409 or not self._active_match_exists(match_id, game_type):
                raise;
        return match_id;

    def _resolve_match_id(self, user_id: str, game_type: str, hint: str | None) -> str | None:
        """Resolve a match id.""";
        match_id = self._matched_match_id(user_id, game_type);
        if match_id:
            return match_id;
        if not hint:
            return None;
        try:
            self._assert_player(user_id, self._live_match(hint, game_type));
        except ServiceError:
            return None;
        return hint;

    def _matched_match_id(self, user_id: str, game_type: str) -> str | None:
        """Return the matched game id.""";
        row = self.database.select_one("app_match_queue", filters={"user_id": user_id, "game_type": game_type});
        return str(row.get("match_id") or "") or None if isinstance(row, dict) and row.get("status") == "matched" else None;

    def _live_match(self, match_id: str, game_type: str) -> dict[str, Any]:
        """Return the live match row.""";
        row = self.database.select_one(
            "app_games",
            columns="id,game_type,status,mode,player_a_id,player_b_id,user_id",
            filters={"id": match_id, "game_type": game_type},
        );
        if not isinstance(row, dict) or str(row.get("status") or "") not in {"ready", "active"}:
            raise ServiceError(409, "Match no longer exists");
        return row;

    def _active_match_exists(self, match_id: str, game_type: str) -> bool:
        """Return whether an active match exists.""";
        row = self.database.select_one("app_games", columns="id,status", filters={"id": match_id, "game_type": game_type});
        return isinstance(row, dict) and row.get("status") == "active";

    def _provision_live_match(self, game_type: str, match_id: str, player_a_id: str, player_b_id: str) -> None:
        """Provision one live match.""";
        result = self._rpc_result(
            self.database.rpc(
                "app_provision_live_match",
                {
                    "p_game_type": game_type,
                    "p_match_id": match_id,
                    "p_player_a_id": player_a_id,
                    "p_player_b_id": player_b_id,
                },
            ),
        );
        self._raise_rpc_error(result);

    def _status_from_db(self, user_id: str, game_type: str) -> dict[str, Any]:
        """Return status from db.""";
        row = self.database.select_one("app_match_queue", filters={"user_id": user_id, "game_type": game_type});
        if row is None:
            return {"status": "idle"};
        if row.get("status") == "matched" and row.get("match_id"):
            match = self.database.select_one(
                "app_games",
                columns="id,status,player_a_id,player_b_id",
                filters={"id": row["match_id"], "game_type": game_type},
            );
            if isinstance(match, dict) and str(match.get("status") or "") in {"ready", "active"}:
                opponent_id = str(match["player_b_id"] if match["player_a_id"] == user_id else match["player_a_id"]);
                profile = self._profiles([opponent_id]).get(opponent_id, {});
                now = self.now();
                ready_at = self._match_ready_at(row) or now;
                entry = _MatchedEntry(str(row["match_id"]), opponent_id, str(profile.get("username") or "Opponent"), profile.get("photo_url"), now, ready_at);
                self._queue(game_type).restore_matched(user_id, entry);
                return self._status_payload(entry);
        profile = self._profiles([user_id]).get(user_id, {});
        self._queue(game_type).restore_waiting(_WaitingEntry(user_id, str(profile.get("username") or "Player"), profile.get("photo_url"), self.now()));
        return {"status": "waiting"};

    def _queue(self, game_type: str) -> _MatchmakingQueue:
        """Return queue rows.""";
        with self.queues_lock:
            return self.queues.setdefault(game_type, _MatchmakingQueue(self.now));

    def _profiles(self, user_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Return player profiles.""";
        ids = sorted({user_id for user_id in user_ids if user_id});
        if not ids:
            return {};
        return {
            str(row["id"]): row
            for row in self.database.select("app_users", columns="id,username,photo_url", filters={"id": ("in", ids)})
            if row.get("id")
        };

    @staticmethod
    def _rpc_result(value: Any) -> dict[str, Any]:
        """Normalize one JSON-returning Supabase RPC response.""";
        row = value[0] if isinstance(value, list) and value else value;
        if not isinstance(row, dict):
            raise ServiceError(502, "Supabase RPC returned an invalid response");
        return row;

    @staticmethod
    def _raise_rpc_error(row: dict[str, Any]) -> None:
        """Raise a service error returned by a JSON RPC.""";
        if row.get("ok") is False:
            raise ServiceError(int(row.get("status") or 409), str(row.get("error") or "Request failed"));

    def _require_no_unfinished_game(self, user_id: str, game_type: str) -> None:
        """Require no unfinished game.""";
        if self.active_incomplete_game(user_id, game_type)[0]:
            raise ServiceError(409, "Finish or surrender your current game before starting another match.");

    def _reconcile_expired(self, user_id: str, game_type: str, game_id: str) -> bool:
        """Reconcile expired clocks.""";
        try:
            return self.runtime(game_type).reconcile_expired(user_id, game_id);
        except Exception:
            return False;

    @staticmethod
    def _assert_player(user_id: str, match: dict[str, Any]) -> tuple[str, str]:
        """Assert that a user is one of the players.""";
        player_a_id = str(match.get("player_a_id") or "");
        player_b_id = str(match.get("player_b_id") or "");
        if user_id not in {player_a_id, player_b_id}:
            raise ServiceError(403, "You are not part of this match");
        return player_a_id, player_b_id;

    @staticmethod
    def _match_ready_at(row: dict[str, Any] | None) -> datetime | None:
        """Return the match ready timestamp.""";
        if not isinstance(row, dict) or not row.get("updated_at"):
            return None;
        try:
            value = datetime.fromisoformat(str(row["updated_at"]).replace("Z", "+00:00"));
        except ValueError:
            return None;
        return (value if value.tzinfo else value.replace(tzinfo=UTC)) + timedelta(seconds=MATCH_START_DELAY_SECONDS);

    def _status_payload(self, entry: _MatchedEntry) -> dict[str, Any]:
        """Return status payload.""";
        opponent = {"user_id": entry.opponent_id, "username": entry.opponent_name, "photo_url": entry.opponent_photo};
        now = self.now();
        if now >= entry.ready_at:
            return {"status": "matched", "match_id": entry.match_id, "opponent": opponent};
        return {
            "status": "opponent_found",
            "match_id": entry.match_id,
            "opponent": opponent,
            "starts_at": entry.ready_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
            "starts_in_seconds": max(0, int((entry.ready_at - now).total_seconds())),
        };

    @staticmethod
    def _new_game_payload(game_id: str, game: GameDef, mode: str, *, reused: bool = False) -> dict[str, Any]:
        """Build a new-game response payload.""";
        payload: dict[str, Any] = {"ok": True, "game_id": game_id, "mode": mode};
        if reused:
            payload["reused_existing_game"] = True;
        if game.workflow_step:
            payload["workflow_step"] = game.workflow_step;
        return payload;

    @staticmethod
    def _opponent_payload(user_id: str, profile: dict[str, Any]) -> dict[str, Any]:
        """Build an opponent response payload.""";
        return {"user_id": user_id, "username": profile.get("username") or "Opponent", "photo_url": profile.get("photo_url")};

    def _expired(self, raw: Any) -> bool:
        """Return whether a row is expired.""";
        if not raw:
            return False;
        try:
            value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"));
        except (TypeError, ValueError):
            return True;
        return self.now() > (value if value.tzinfo else value.replace(tzinfo=UTC));

    @staticmethod
    def _normalize_game_type(game_type: str) -> str:
        """Normalize a game type.""";
        return get_game_def(game_type).game_type;

def _resolve_mode(value: str | None, game: GameDef) -> str:
    """Resolve mode.""";
    mode = str(value or "").strip().lower();
    if not mode:
        return game.default_mode;
    if mode not in game.valid_modes:
        raise ServiceError(400, game.mode_error);
    return mode;

def _short_code() -> str:
    """Generate a short invite code.""";
    raw = secrets.token_urlsafe(9).replace("-", "").replace("_", "")[:12].lower();
    return raw or secrets.token_hex(6);
