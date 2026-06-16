from __future__ import annotations;

from typing import Any, Literal, TypedDict;

GAME_TYPE_POOL = "pool";
MODE_PVP = "pvp";
MODE_PASS_AND_PLAY = "pnp";
VALID_MODES = frozenset({MODE_PVP, MODE_PASS_AND_PLAY});
STATUS_ACTIVE = "active";
STATUS_FINISHED = "finished";
POOL_CLOCK_INITIAL_SECONDS = 900;
INITIAL_CLOCK_MS = POOL_CLOCK_INITIAL_SECONDS * 1000;
MAX_SHOT_VELOCITY = 4000;
SHOT_VEL_EPSILON = 1.0;

Mode = Literal["pvp", "pnp"];
Status = Literal["active", "finished", "draw"];
Color = Literal["w", "b"];
Seat = Literal["player1", "player2"];

class BallPosition(TypedDict):
    """Persisted position for one numbered Pool ball.""";

    n: int;
    x: float;
    y: float;

class AimMetadata(TypedDict, total=False):
    """Optional frontend aim metadata stored with a shot trajectory.""";

    angle: float;
    power: float;
    cue_x: float;
    cue_y: float;

class Trajectory(TypedDict, total=False):
    """Physics trajectory JSON; frame details remain engine-owned.""";

    x_vel: float;
    y_vel: float;
    aim: AimMetadata;
    frames: list[dict[str, Any]];

class PoolTable(TypedDict, total=False):
    """Serialized Pool table exposed to clients and persisted without SVG/photos.""";

    physics_game_id: str;
    game_name: str;
    mode: Mode;
    status: Status;
    game_over: bool;
    game_started: bool;
    winner: str | None;
    winner_player_id: str | None;
    winner_message: str;
    p1_name: str;
    p1_playing: str;
    p1_score: int;
    p2_name: str;
    p2_playing: str;
    p2_score: int;
    current_player: str;
    current_player_id: str;
    player1_id: str;
    player2_id: str;
    p1_photo_url: str | None;
    p2_photo_url: str | None;
    ball_in_hand_for_player_id: str | None;
    ball_in_hand: bool;
    svg: str;
    balls: list[BallPosition];

class SeatFlags(TypedDict):
    """Per-viewer action permissions derived from table state and seat.""";

    can_place_cue: bool;
    can_fire_shot: bool;

class PoolResult(TypedDict, total=False):
    """Terminal result embedded in authoritative Pool state and SSE events.""";

    status: Status;
    winner: str | None;
    reason: str | None;

class PoolState(TypedDict, total=False):
    """Authoritative HTTP/SSE Pool state for one game.""";

    ok: bool;
    game_id: str;
    mode: Mode;
    status: Status;
    result: PoolResult;
    table: PoolTable;
    you_seat: Seat | None;
    stream_seq: int;
    clock_a_ms: int;
    clock_b_ms: int;
    clock_active_color: Color;
    clock_anchor_iso: str;
    can_place_cue: bool;
    can_fire_shot: bool;
    _internal_realtime_next_seq: int;

class PoolPersistPayload(TypedDict, total=False):
    """Async persistence queue item for one Pool table transition.""";

    game_id: str;
    table: PoolTable;
    trajectory: Trajectory | None;
    label: str;
    played_by_id: str | None;
    next_player_id: str | None;
    time_a_ms: int;
    time_b_ms: int;
    mode: Mode;
    owner_user_id: str;
    winner_player_id: str | None;

class ShotAccepted(TypedDict, total=False):
    """HTTP shot/cue response returned to the acting Pool client.""";

    ok: bool;
    valid: bool;
    game_id: str;
    trajectory: Trajectory | None;
    table: PoolTable;
    stream_seq: int;
    clock_a_ms: int;
    clock_b_ms: int;
    clock_active_color: Color;
    clock_anchor_iso: str;
    can_place_cue: bool;
    can_fire_shot: bool;

class PoolGameOverResponse(PoolState, total=False):
    """HTTP surrender/draw response with the final state repeated for clients.""";

    type: Literal["game_over"];
    game_over: PoolState;

class PoolEvent(TypedDict, total=False):
    """Seat-neutral Pool SSE event.""";

    type: Literal["shot_accepted", "game_over", "chat_message"];
    game_id: str;
    next_state: PoolState;
    trajectory: Trajectory | None;
    last_shot_seq: int;
    result: PoolResult;
    message: dict[str, Any];

class ReplayEntry(TypedDict, total=False):
    """One Pool replay position with optional preceding trajectory.""";

    index: int;
    step: int;
    label: str;
    snapshot: PoolTable;
    trajectory: Trajectory | None;

class ReplayTimeline(TypedDict, total=False):
    """Pool replay response assembled from persisted move rows.""";

    ok: bool;
    game_id: str;
    entries: list[ReplayEntry];
    live_index: int;
    trajectories: list[dict[str, Any]];

class SubscribePayload(TypedDict):
    """Long-poll/SSE batch returned by the Pool session coordinator.""";

    game_id: str;
    events: list[dict[str, Any]];
    last_seq: int;
