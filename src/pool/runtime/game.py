from __future__ import annotations;

import math;
from typing import Any;

from src.platform.backend import ServiceError;
from src.pool.runtime import Physics;
from src.platform.backend.game_persist import AppGameRow;
from src.pool.runtime.contracts import (
    BallPosition,
    MAX_SHOT_VELOCITY,
    Mode,
    MODE_PASS_AND_PLAY,
    PoolTable,
    SHOT_VEL_EPSILON,
    Seat,
    SeatFlags,
    Trajectory,
);

SOLIDS = frozenset(range(1, 8));
STRIPES = frozenset(range(9, 16));
OBJECT_BALLS = SOLIDS | STRIPES;

class PoolGame:
    """Pool rule boundary around the unchanged legacy Physics engine.""";

    def __init__(self, physics: Physics.Game) -> None:
        """Wrap one mutable legacy physics game without changing engine behavior.""";
        self.physics = physics;

    def table(self, last_snapshot: PoolTable | None) -> Physics.Table:
        """Return the live table copy used for the next Pool action.""";
        return table_for_shot(self.physics, last_snapshot);

    def snapshot(self, *, mode: Mode, table: Physics.Table | None = None) -> PoolTable:
        """Serialize current physics state and ball positions for API/persistence.""";
        current_table = table or self.table(None);
        return game_to_table_snapshot(self.physics, svg=current_table.svg(), mode=mode, table=current_table);

    def shoot(self, last_snapshot: PoolTable | None, x_vel: float, y_vel: float) -> tuple[Trajectory, Physics.Table]:
        """Apply one normalized shot through the legacy physics engine.""";
        return execute_shot(self.physics, last_snapshot, x_vel, y_vel);

    def place_cue(self, table: Physics.Table, x: float, y: float) -> Physics.Table:
        """Place the cue ball through engine validation and return the new table.""";
        return self.physics.place_cue(table, float(x), float(y));

    def surrender(self, winner_id: str | None, reason: str) -> None:
        """Mark the physics game terminal with the supplied winner and reason.""";
        self.physics.surrender(winner_id, reason);

    def finish_without_winner(self) -> None:
        """Mark a local abandonment or agreed draw terminal without a winner.""";
        self.physics.game_over = 1;
        self.physics.winnerID = None;

def seat_for_user(*, user_id: str, player_a_id: str, player_b_id: str) -> Seat | None:
    """Map an authenticated user id to the persisted Pool seat.""";
    if user_id and user_id == str(player_a_id or ""):
        return "player1";
    if user_id and user_id == str(player_b_id or ""):
        return "player2";
    return None;

def normalize_group(raw: Any) -> str | None:
    """Normalize legacy singular/plural group labels to `solids` or `stripes`.""";
    value = str(raw or "").strip().lower();
    if value in ("solid", "solids"):
        return "solids";
    if value in ("stripe", "stripes"):
        return "stripes";
    return None;

def as_app_user_fk(raw: Any) -> str | None:
    """Return a real app-user id, excluding local pass-and-play seat tokens.""";
    value = str(raw or "").strip();
    return None if not value or value.startswith("pass:") else value;

def pool_slot_scores(table: PoolTable) -> tuple[list[int], list[int]]:
    """Return cumulative sunk object-ball numbers for player-one and player-two.""";
    on_table: set[int] = set();
    for row in table.get("balls") or []:
        if isinstance(row, dict):
            try:
                on_table.add(int(row.get("n", -1)));
            except (TypeError, ValueError):
                pass;
    sunk = sorted(number for number in OBJECT_BALLS if number not in on_table);

    def for_group(group: str | None) -> list[int]:
        """Filter sunk object balls to the requested normalized group.""";
        target = SOLIDS if group == "solids" else STRIPES if group == "stripes" else frozenset();
        return [number for number in sunk if number in target];
    return for_group(normalize_group(table.get("p1_playing"))), for_group(normalize_group(table.get("p2_playing")));

def move_actor_ids(*, played_by_id: Any = None, next_player_id: Any = None, table: PoolTable | None = None) -> tuple[str | None, str | None]:
    """Resolve app-user foreign keys for the acting and next Pool player.""";
    played = as_app_user_fk(played_by_id);
    next_player = as_app_user_fk(next_player_id);
    if next_player is None and next_player_id is None and isinstance(table, dict):
        next_player = as_app_user_fk(table.get("current_player_id"));
    return played, next_player;

def terminal_reason(table: PoolTable) -> str:
    """Return a stable persistence reason for terminal Pool tables.""";
    reason = str(table.get("winner_message") or "").strip();
    if reason:
        return reason;
    return "finished" if table.get("game_over") or str(table.get("status") or "") == "finished" else "";

def resolve_winner_user_id(table: PoolTable, *, mode: str, owner_user_id: str | None = None, winner_player_id: str | None = None) -> str | None:
    """Map engine winner identity to the nullable `app_games.winner_id` FK.""";
    if not (table.get("game_over") or str(table.get("status") or "") == "finished"):
        return None;
    winner = winner_player_id;
    if winner is None:
        winner_name_value = str(table.get("winner") or "").strip();
        if winner_name_value == str(table.get("p1_name") or "").strip():
            winner = table.get("player1_id");
        elif winner_name_value == str(table.get("p2_name") or "").strip():
            winner = table.get("player2_id");
        else:
            return None;
    user_id = as_app_user_fk(winner);
    if user_id:
        return user_id;
    if mode == MODE_PASS_AND_PLAY and str(winner or "") == str(table.get("player1_id") or "pass:p1"):
        return str(owner_user_id or "").strip() or None;
    return None;

def normalize_shot_velocity(x_vel: float, y_vel: float) -> tuple[float, float]:
    """Reject tiny shots and clamp excessive velocity while preserving direction.""";
    x = float(x_vel);
    y = float(y_vel);
    magnitude = math.hypot(x, y);
    if magnitude < SHOT_VEL_EPSILON:
        raise ServiceError(400, "Shot velocity too small");
    if magnitude > MAX_SHOT_VELOCITY:
        scale = MAX_SHOT_VELOCITY / magnitude;
        x *= scale;
        y *= scale;
    return x, y;

def is_valid_cue_xy(game: Physics.Game, table: Physics.Table, x: float, y: float, *, ignore_cue: bool = False) -> bool:
    """Return whether engine placement rules permit the cue-ball coordinates.""";
    return bool(game._is_valid_cue_xy(table, x, y, ignore_cue=ignore_cue));

def initialize_table() -> Physics.Table:
    """Build a standard rack and cue ball on a fresh physics table.""";
    table = Physics.Table();
    balls = [1, 2, 9, 3, 8, 10, 4, 14, 7, 11, 12, 6, 15, 13, 5];
    for row, count in enumerate([1, 2, 3, 4, 5]):
        for ball_number in range(count):
            x = Physics.TABLE_WIDTH / 2.0 + (ball_number - count / 2.0) * (Physics.BALL_DIAMETER + 4.0);
            y = Physics.TABLE_WIDTH / 2.0 - math.sqrt(3.0) / 2.0 * (Physics.BALL_DIAMETER + 4.0) * row;
            table += Physics.StillBall(balls.pop(0), Physics.Coordinate(x, y));
    table += Physics.StillBall(0, Physics.Coordinate(Physics.TABLE_WIDTH / 2.0 + 2, Physics.TABLE_LENGTH - Physics.TABLE_WIDTH / 2.0));
    return table;

def extract_ball_positions(table: Physics.Table) -> list[BallPosition]:
    """Serialize still and rolling ball positions, ordered by ball number.""";
    balls: list[BallPosition] = [];
    for obj in table:
        if isinstance(obj, Physics.StillBall):
            ball = obj.obj.still_ball;
        elif isinstance(obj, Physics.RollingBall):
            ball = obj.obj.rolling_ball;
        else:
            continue;
        balls.append({"n": int(ball.number), "x": float(ball.pos.x), "y": float(ball.pos.y)});
    return sorted(balls, key=lambda ball: int(ball["n"]));

def as_table(raw: Physics.Table) -> Physics.Table:
    """Rebind a copied phylib table to the Python subclass used by runtime code.""";
    raw.__class__ = Physics.Table;
    raw.current = -1;
    return raw;

def table_from_ball_positions(balls: list[BallPosition]) -> Physics.Table:
    """Rebuild a physics table from persisted numbered ball coordinates.""";
    table = Physics.Table();
    for row in balls:
        number = int(row.get("n", -1));
        if number >= 0:
            table += Physics.StillBall(number, Physics.Coordinate(float(row["x"]), float(row["y"])));
    table.time = 0.0;
    return table;

def merge_balls_into_snapshot(snapshot: PoolTable, table: Physics.Table) -> PoolTable:
    """Copy a serialized table snapshot and attach current ball positions.""";
    return {**snapshot, "balls": extract_ball_positions(table)};

def current_player_name(game: Physics.Game) -> str:
    """Return the display name of the physics player currently on turn.""";
    return game.player1_name if game.current_player_id == game.player1_id else game.player2_name;

def winner_name(game: Physics.Game) -> str:
    """Return the winner display name or an empty string before terminal state.""";
    if game.winner is None:
        return "";
    return game.player1_name if game.winner == game.player1_id else game.player2_name;

def game_to_table_snapshot(game: Physics.Game, *, svg: str, mode: str, table: Physics.Table | None = None) -> PoolTable:
    """Serialize engine state into the stable Pool table JSON contract.""";
    snapshot: PoolTable = {
        "physics_game_id": getattr(game, "app_game_id", None) or game.game_id,
        "game_name": game.game_name,
        "mode": mode,
        "status": "finished" if int(game.game_over or 0) else "active",
        "game_over": bool(int(game.game_over or 0)),
        "game_started": bool(int(game.game_started or 0)),
        "winner": winner_name(game),
        "winner_player_id": game.winner,
        "winner_message": game.winner_message or "",
        "p1_name": game.player1_name,
        "p1_playing": game.player1_playing or "",
        "p1_score": int(game.player1_score or 0),
        "p2_name": game.player2_name,
        "p2_playing": game.player2_playing or "",
        "p2_score": int(game.player2_score or 0),
        "current_player": current_player_name(game),
        "current_player_id": game.current_player_id,
        "player1_id": game.player1_id,
        "player2_id": game.player2_id,
        "p1_photo_url": getattr(game, "player1_photo_url", None),
        "p2_photo_url": getattr(game, "player2_photo_url", None),
        "ball_in_hand_for_player_id": getattr(game, "ball_in_hand_for", None),
        "ball_in_hand": bool(getattr(game, "ball_in_hand_for", None)),
        "svg": svg,
    };
    return merge_balls_into_snapshot(snapshot, table) if table is not None else snapshot;

def enrich_table_player_photos(table: PoolTable, *, mode: str, player_a_id: str, player_b_id: str, owner_user_id: str, lookup_photo: Any) -> PoolTable:
    """Refresh non-persisted player photo URLs on a serialized Pool table.""";
    enriched_table = dict(table);
    player_one_id = str(player_a_id or owner_user_id or "");
    if player_one_id:
        enriched_table["p1_photo_url"] = lookup_photo(player_one_id);
    enriched_table["p2_photo_url"] = None if mode == MODE_PASS_AND_PLAY else (lookup_photo(str(player_b_id)) if player_b_id else None);
    return enriched_table;

def pass_and_play_turn(table: PoolTable, user_id: str, row: AppGameRow) -> bool:
    """Return whether the local pass-and-play owner may act on either seat.""";
    return not table.get("game_over") and str(user_id or "") in {str(row.get("player_a_id") or ""), str(row.get("player_b_id") or "")};

def can_place_cue_table(table: PoolTable, user_id: str, row: AppGameRow, mode: str) -> bool:
    """Return whether this viewer may place the cue ball during ball-in-hand.""";
    receiver_id = table.get("ball_in_hand_for_player_id");
    if table.get("game_over") or not table.get("ball_in_hand") or receiver_id is None:
        return False;
    if mode == MODE_PASS_AND_PLAY:
        return pass_and_play_turn(table, user_id, row);
    seat = seat_for_user(user_id=user_id, player_a_id=str(row.get("player_a_id") or ""), player_b_id=str(row.get("player_b_id") or ""));
    expected = table.get("player1_id") if seat == "player1" else table.get("player2_id");
    return seat is not None and str(receiver_id) == str(expected);

def can_fire_shot_table(table: PoolTable, user_id: str, row: AppGameRow, mode: str) -> bool:
    """Return whether this viewer may submit the next shot.""";
    if table.get("game_over"):
        return False;
    if mode == MODE_PASS_AND_PLAY:
        return pass_and_play_turn(table, user_id, row);
    if table.get("ball_in_hand"):
        return can_place_cue_table(table, user_id, row, mode);
    seat = seat_for_user(user_id=user_id, player_a_id=str(row.get("player_a_id") or ""), player_b_id=str(row.get("player_b_id") or ""));
    expected = table.get("player1_id") if seat == "player1" else table.get("player2_id");
    return seat is not None and str(table.get("current_player_id")) == str(expected);

def seat_flags(table: PoolTable, user_id: str, row: AppGameRow, mode: str) -> SeatFlags:
    """Return client action flags derived from mode, seat, and table state.""";
    return {"can_place_cue": can_place_cue_table(table, user_id, row, mode), "can_fire_shot": can_fire_shot_table(table, user_id, row, mode)};

def refresh_game_from_snapshot(game: Physics.Game, snapshot: PoolTable) -> Physics.Game:
    """Refresh mutable engine metadata from a persisted serialized table.""";
    hydrated = Physics.Game.from_snapshot(snapshot, app_game_id=getattr(game, "app_game_id", None));
    for attr in ("current_player_id", "game_started", "game_over", "winner", "winner_message", "player1_playing", "player2_playing", "player1_score", "player2_score", "player1_photo_url", "player2_photo_url", "ball_in_hand_for"):
        setattr(game, attr, getattr(hydrated, attr));
    return game;

def table_for_shot(game: Physics.Game, last_snapshot: PoolTable | None) -> Physics.Table:
    """Return a copied cached table, persisted reconstruction, or fresh rack.""";
    if game._cached_table is not None:
        return as_table(game._cached_table.copy());
    balls = (last_snapshot or {}).get("balls");
    if isinstance(balls, list) and balls:
        return as_table(table_from_ball_positions(balls).copy());
    return initialize_table();

def execute_shot(game: Physics.Game, last_snapshot: PoolTable | None, x_vel: float, y_vel: float) -> tuple[Trajectory, Physics.Table]:
    """Run one engine shot against the table reconstructed for this turn.""";
    return game.apply_shot(table_for_shot(game, last_snapshot), x_vel, y_vel);

def current_table_svg(game: Physics.Game, last_snapshot: PoolTable | None) -> str:
    """Render SVG for the cached or reconstructed current table.""";
    return game._cached_table.svg() if game._cached_table is not None else table_for_shot(game, last_snapshot).svg();

_as_table = as_table;
