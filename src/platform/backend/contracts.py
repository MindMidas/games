from __future__ import annotations;

from collections.abc import Mapping;
from datetime import datetime;
from typing import Any, Literal, Protocol, TypeAlias, TypedDict;

GameType = Literal["pool", "chezz"];
JsonScalar: TypeAlias = str | int | float | bool | None;
JsonValue: TypeAlias = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"];
JsonObject: TypeAlias = dict[str, Any];
DbFilter: TypeAlias = tuple[str, Any] | Any;
DbFilters: TypeAlias = dict[str, DbFilter];

MODE_PVP = "pvp";
STATUS_ACTIVE = "active";
STATUS_FINISHED = "finished";
STATUS_DRAW = "draw";
TERMINAL_STATUSES = frozenset({STATUS_FINISHED, STATUS_DRAW});

DRAW_OFFER_PREFIX = "__draw_offer__|";
DRAW_OFFER_UPDATE_PREFIX = "__draw_offer_update__|";
REMATCH_OFFER_PREFIX = "__rematch_offer__|";
REMATCH_OFFER_UPDATE_PREFIX = "__rematch_offer_update__|";
SURRENDER_PREFIX = "__surrender__|";

MAX_DRAW_OFFERS_PER_USER = 2;
MAX_REMATCH_OFFERS_PER_USER = 2;

CLOCK_INITIAL_SECONDS = 600;

class DatabaseReader(Protocol):
    """Minimal typed read boundary exposed to runtime repositories.""";

    def select(
        self,
        table: str,
        *,
        columns: str = "*",
        filters: DbFilters | None = None,
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """Select rows from one table.""";
        ...;

    def select_one(
        self,
        table: str,
        *,
        columns: str = "*",
        filters: DbFilters | None = None,
        order: str | None = None,
    ) -> dict[str, Any] | None:
        """Select one row from one table.""";
        ...;

class DatabaseWriter(Protocol):
    """Minimal typed write boundary exposed to runtime bootstrap code.""";

    def insert(
        self,
        table: str,
        data: dict[str, Any] | list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Insert rows into one table.""";
        ...;

    def update(
        self,
        table: str,
        data: dict[str, Any],
        *,
        filters: DbFilters,
        returning: str = "representation",
    ) -> list[dict[str, Any]]:
        """Update filtered rows in one table.""";
        ...;

    def delete(
        self,
        table: str,
        *,
        filters: DbFilters,
        returning: str = "representation",
    ) -> list[dict[str, Any]]:
        """Delete filtered rows from one table.""";
        ...;

class RpcDatabase(Protocol):
    """Minimal typed RPC boundary used by shared persistence helpers.""";

    def rpc(self, function_name: str, params: Mapping[str, Any] | None = None) -> Any:
        """Call one database RPC.""";
        ...;

class RuntimeDatabase(DatabaseReader, DatabaseWriter, RpcDatabase, Protocol):
    """Typed platform DB surface used while creating or repairing games.""";

    def iso_datetime(self, value: datetime) -> str:
        """Format one datetime for storage.""";
        ...;

class ChatRow(TypedDict, total=False):
    """Persisted chat row broadcast to one game's realtime stream.""";

    id: int;
    game_id: str;
    user_id: str;
    username: str;
    body: str;
    created_at: str;

class SystemChatRow(TypedDict):
    """Server-generated social control row before DB insertion.""";

    game_id: str;
    user_id: str;
    username: str;
    body: str;
    created_at: str;

class GameMoveRow(TypedDict, total=False):
    """Persisted app_game_moves columns shared by runtime repositories.""";

    ply: int;
    state_json: JsonObject;
    events_json: list[JsonObject];
    notation: str;
    played_by_id: str | None;
    next_player_id: str | None;
    score_a: list[JsonValue];
    score_b: list[JsonValue];
    time_a_ms: int | None;
    time_b_ms: int | None;
    created_at: str;

class PresenceRow(TypedDict):
    """Persisted app_presence heartbeat columns.""";

    user_id: str;
    game_type: GameType;
    last_seen: str;

class MatchRow(TypedDict, total=False):
    """Shared PvP match row passed into a game runtime.""";

    id: str;
    game_type: GameType;
    player_a_id: str;
    player_b_id: str;
    status: str;

class GameAccessRow(TypedDict, total=False):
    """Persisted app_games columns used for routing and membership checks.""";

    id: str;
    game_type: GameType;
    status: str;
    mode: str;
    user_id: str;
    player_a_id: str;
    player_b_id: str;

class UserRow(TypedDict, total=False):
    id: str;
    username: str;
    photo_url: str | None;

class InviteRow(TypedDict, total=False):
    id: str;
    game_type: GameType;
    inviter_user_id: str;
    invitee_user_id: str;
    code: str;
    status: str;
    match_id: str;
    expires_at: str;

class QueueRow(TypedDict, total=False):
    id: str;
    user_id: str;
    game_type: GameType;
    status: str;
    match_id: str;
    updated_at: str;

class LiveMatchRow(GameAccessRow, total=False):
    """Ready or active PvP app_games row.""";

class SubscribePayload(TypedDict):
    """Ordered realtime events returned by a game runtime.""";

    game_id: str;
    events: list[dict[str, Any]];
    last_seq: int;
