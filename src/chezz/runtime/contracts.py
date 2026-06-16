from __future__ import annotations;

from typing import Any, Literal, TypedDict;

GAME_TYPE_CHEZZ = "chezz";
ENGINE_USER_ID = "engine";
ENGINE_USERNAME = "Maximus";
MODE_PVE = "pve";
MODE_PVP = "pvp";
VALID_MODES = {MODE_PVE, MODE_PVP};
STATUS_ACTIVE = "active";
STATUS_FINISHED = "finished";
STATUS_DRAW = "draw";
TERMINAL_STATUSES = {STATUS_FINISHED, STATUS_DRAW};
COLOR_WHITE = "w";
COLOR_BLACK = "b";
VALID_COLORS = {COLOR_WHITE, COLOR_BLACK};
WINNER_DRAW = "draw";
DRAW_OFFER_PREFIX = "__draw_offer__|";
DRAW_OFFER_UPDATE_PREFIX = "__draw_offer_update__|";
REMATCH_OFFER_PREFIX = "__rematch_offer__|";
REMATCH_OFFER_UPDATE_PREFIX = "__rematch_offer_update__|";
SURRENDER_PREFIX = "__surrender__|";
MAX_DRAW_OFFERS_PER_USER = 2;
MAX_REMATCH_OFFERS_PER_USER = 2;
MAX_ACTION_KEY_LENGTH = 128;
MAX_CLIENT_MOVE_ID_LENGTH = 128;
CLOCK_INITIAL_SECONDS = 600;
Color = Literal["w", "b"];
Status = Literal["active", "finished", "draw"];
Mode = Literal["pve", "pvp"];
ActionKind = Literal["move", "shoot", "fling"];

class BoardHeader(TypedDict, total=False):
    """Engine board header (turn and counters).""";

    turn: Color;
    time_taken: int;
    max_time: int;
    num_moves: int;

class GameResult(TypedDict, total=False):
    """Terminal block embedded in engine snapshots.""";

    status: Status;
    winner: Color | None;
    reason: str | None;

class EngineBoard(TypedDict, total=False):
    """Native engine snapshot: header.turn, sparse board map, optional result.""";

    game_type: str;
    mode: Mode;
    engine_name: str;
    header: BoardHeader;
    board: dict[str, str];
    result: GameResult;
    winner: Color | None;

class PlayerInfo(TypedDict, total=False):
    """One seat's profile fields.""";

    user_id: str | None;
    username: str;
    photo_url: str | None;

class Players(TypedDict):
    """Both seats' PlayerInfo.""";

    w: PlayerInfo;
    b: PlayerInfo;

class Captured(TypedDict):
    """Captured pieces panel lists.""";

    w: list[str];
    b: list[str];

class MoveRow(TypedDict, total=False):
    """Single confirmed history row (server-authored only).""";

    seq: int;
    step: int;
    color: Color;
    from_: str;
    to: str;
    piece: str;
    captured: list[str];
    spawned: list[str];
    transformed: list[str];
    destroyed: list[str];
    notation: str;
    clock_a_ms_after: int;
    clock_b_ms_after: int;
    created_at: str;

class GameState(TypedDict, total=False):
    """Authoritative game snapshot: HTTP load + SSE next_state payloads.""";

    game_id: str;
    mode: Mode;
    status: Status;
    result: GameResult | None;
    players: Players;
    you_color: Color | None;
    self_user_id: str;
    board: EngineBoard;
    current_turn: Color;
    move_number: int;
    move_history: list[MoveRow];
    captured: Captured;
    clock_a_ms: int;
    clock_b_ms: int;
    clock_active_color: Color;
    clock_anchor_iso: str;
    stream_seq: int;
    legal: LegalAfterPayload;

class MoveRequest(TypedDict, total=False):
    """POST /api/move body; `client_move_id` idempotent retries; `expected_seq` stale guard.""";

    game_id: str;
    from_: str;
    to: str;
    kind: ActionKind;
    meta: MoveMeta;
    client_move_id: str;
    expected_seq: int;

class AnimationEvent(TypedDict, total=False):
    """One animator step; order matches UserActionsAdapter payloads.""";

    type: int;
    action: str;
    piece: str;
    from_piece: str;
    to_piece: str;
    direction: str;
    square: str;
    from_square: str;
    to_square: str;
    payload_square: str;
    target_square: str;

class MoveMeta(TypedDict, total=False):
    """Optional action-specific fields decoded from the frontend `action_key`.""";

    square: str;
    direction: str;
    catapult: str;
    payload: str;
    target: str;

# Functional syntax preserves the JSON wire key "from", which is a Python keyword.
LegalAction = TypedDict(
    "LegalAction",
    {
        "action_key": str,
        "kind": ActionKind,
        "from": str,
        "from_sq": str,
        "to": str,
        "square": str,
        "direction": str,
        "catapult": str,
        "payload": str,
        "target": str,
        "preview_events": list[AnimationEvent],
        "preview_snapshot": EngineBoard,
    },
    total=False,
);

class MoveSummary(TypedDict, total=False):
    """Structured summary for MoveAccepted.move.""";

    kind: str;
    from_: str;
    to: str;
    piece: str;
    captured: list[str];
    spawned: list[str];
    transformed: list[str];
    destroyed: list[str];
    notation: str;

class LegalAfterPayload(TypedDict, total=False):
    """Optional legal_moves bundle keyed by stream_seq for client refresh.""";

    cursor: str;
    actions: list[LegalAction];
    premove_by_color: dict[Color, list[LegalAction]];

class MoveAccepted(TypedDict, total=False):
    """SSE move_accepted: full next_state, move summary, ordered animation_events.""";

    type: Literal["move_accepted"];
    game_id: str;
    next_state: GameState;
    move: MoveSummary;
    animation_events: list[AnimationEvent];
    last_move_seq: int;
    legal: LegalAfterPayload | None;

class GameOver(TypedDict, total=False):
    """SSE `game_over`; reasons include checkmate, stalemate, time_forfeit, surrender, draw_agreed, disconnect_forfeit.""";

    type: Literal["game_over"];
    game_id: str;
    next_state: GameState;
    result: GameResult;

SseEvent = MoveAccepted | GameOver;

class SubscribePayload(TypedDict):
    """Long-poll/SSE batch returned by the Chezz session coordinator.""";

    game_id: str;
    events: list[dict[str, Any]];
    last_seq: int;

class ReplayEntry(TypedDict, total=False):
    """One persisted Chezz replay position.""";

    index: int;
    step: int;
    label: str;
    snapshot: EngineBoard;
    events: list[dict[str, Any]];

class ReplayTimeline(TypedDict):
    """Chezz replay response assembled from persisted moves.""";

    game_id: str;
    entries: list[ReplayEntry];
    live_index: int;

__all__ = [
    "Color",
    "Status",
    "Mode",
    "ActionKind",
    "BoardHeader",
    "GameResult",
    "EngineBoard",
    "PlayerInfo",
    "Players",
    "Captured",
    "MoveRow",
    "GameState",
    "MoveRequest",
    "MoveMeta",
    "AnimationEvent",
    "LegalAction",
    "MoveSummary",
    "LegalAfterPayload",
    "MoveAccepted",
    "GameOver",
    "SseEvent",
    "SubscribePayload",
    "ReplayEntry",
    "ReplayTimeline",
];
