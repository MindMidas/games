from __future__ import annotations;

from collections.abc import Callable;
from datetime import UTC, datetime;
from typing import Any;

from src.platform.backend import ServiceError;
from src.platform.backend.contracts import DatabaseReader, RpcDatabase, RuntimeDatabase;
from src.platform.backend.replay import coerce_snapshot;
from src.platform.backend.game_persist import AppGameRow, CommitMoveParams, commit_move;
from src.pool.runtime import Physics;
from src.pool.runtime.contracts import (
    Color,
    GAME_TYPE_POOL,
    Mode,
    MODE_PASS_AND_PLAY,
    PoolPersistPayload,
    PoolState,
    PoolTable,
    ReplayTimeline,
    Trajectory,
);
from src.pool.runtime.game import (
    enrich_table_player_photos,
    game_to_table_snapshot,
    seat_for_user,
    table_for_shot,
    table_from_ball_positions,
    move_actor_ids,
    pool_slot_scores,
    resolve_winner_user_id,
    terminal_reason,
);

def load_player_profiles(service: DatabaseReader, player_a_id: str, player_b_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Load both PvP profiles with one Supabase fetch.""";
    rows = service.select(
        "app_users",
        columns="id,username,photo_url",
        filters={"id": ("in", [player_a_id, player_b_id])},
    );
    by_id = {str(row.get("id") or ""): row for row in rows};
    player_a = by_id.get(player_a_id);
    player_b = by_id.get(player_b_id);
    if not isinstance(player_a, dict) or not isinstance(player_b, dict):
        raise ServiceError(404, "Player not found");
    return player_a, player_b;

STATUS_ACTIVE = "active";
STATUS_FINISHED = "finished";
_DROP_FROM_STATE = frozenset({"svg", "p1_photo_url", "p2_photo_url"});

def active_game_id(service: DatabaseReader, user_id: str) -> str:
    """Return the player's newest active Pool game id.""";
    row = service.select_one(
        "app_games",
        columns="id",
        filters={"user_id": user_id, "game_type": "pool", "status": STATUS_ACTIVE},
        order="updated_at.desc",
    );
    if row is None:
        raise ServiceError(404, "No active game");
    return str(row["id"]);

def color_for_player_id(table: PoolTable, player_id: str | None) -> Color:
    """Map Pool slot A/B player ids to shared clock colors.""";
    if str(player_id or "") == str(table.get("player1_id") or ""):
        return "w";
    return "b";

def _user_photo_urls(service: DatabaseReader, user_ids: list[str]) -> dict[str, str | None]:
    """Resolve profile photos with one app_users query.""";
    ids = sorted({user_id for user_id in user_ids if user_id});
    if not ids:
        return {};
    rows = service.select(
        "app_users",
        columns="id,photo_url",
        filters={"id": ("in", ids)},
    );
    return {
        str(row["id"]): str(row.get("photo_url")).strip() if row.get("photo_url") else None
        for row in rows
        if row.get("id")
    };

def _load_row(service: DatabaseReader, user_id: str, game_id: str) -> AppGameRow:
    """Load one authorized Pool app_games row.""";
    row = service.select_one(
        "app_games",
        filters={"id": game_id, "game_type": GAME_TYPE_POOL},
    );
    if row is None:
        raise ServiceError(404, "Game not found");
    player_a_id = str(row.get("player_a_id") or "");
    player_b_id = str(row.get("player_b_id") or "");
    owner = str(row.get("user_id") or "");
    if user_id not in {player_a_id, player_b_id, owner}:
        raise ServiceError(403, "You are not part of this game");
    return row;

def _mode_from_row(row: AppGameRow) -> Mode:
    """Return the Pool runtime mode stored on app_games.""";
    return "pvp" if str(row.get("mode") or "") == "pvp" else MODE_PASS_AND_PLAY;

def latest_move(service: DatabaseReader, game_id: str) -> dict[str, Any] | None:
    """Return the latest persisted Pool move row.""";
    return service.select_one(
        "app_game_moves",
        columns="ply,state_json,time_a_ms,time_b_ms,created_at",
        filters={"game_id": game_id},
        order="ply.desc",
    );

def _latest_board(service: DatabaseReader, game_id: str) -> tuple[PoolTable | None, int]:
    """Return the latest persisted Pool table and ply.""";
    row = latest_move(service, game_id);
    if row is None:
        return None, -1;
    state_json = row.get("state_json");
    table = state_json if isinstance(state_json, dict) else None;
    if table is None:
        return None, -1;
    return table, int(row.get("ply", -1));

def _resolve_board_snapshot(
    service: DatabaseReader,
    game_id: str,
    *,
    move: dict[str, Any] | None = None,
) -> tuple[PoolTable | None, int]:
    """Return the latest persisted Pool table and ply.""";
    move = move if move is not None else latest_move(service, game_id);
    state_json = (move or {}).get("state_json");
    table = state_json if isinstance(state_json, dict) else None;
    ply = int((move or {}).get("ply", -1));
    if table is not None:
        return table, ply;
    return None, -1;

def _physics_from_snapshot(
    game_id: str,
    snap: PoolTable,
    ply: int,
) -> Physics.Game:
    """Build Physics state from a persisted snapshot.""";
    game = Physics.Game.from_snapshot(snap, app_game_id=game_id);
    game._board_ply = ply;
    balls = snap.get("balls");
    if isinstance(balls, list) and len(balls) > 0:
        game._cached_table = table_from_ball_positions(balls);
    else:
        game._cached_table = None;
    return game;

def build_pool_state(
    service: DatabaseReader,
    user_id: str,
    game_id: str,
    *,
    physics: Physics.Game,
    row: AppGameRow,
    mode: Mode,
    ply: int,
    move: dict[str, Any] | None = None,
) -> PoolState:
    """Build pool state from persisted data.""";
    move = move if move is not None else latest_move(service, game_id);
    last_snap = (move or {}).get("state_json") if isinstance((move or {}).get("state_json"), dict) else {};
    tbl = physics._cached_table;
    if tbl is None:
        tbl = table_for_shot(physics, last_snap if isinstance(last_snap, dict) else None);
    table = game_to_table_snapshot(physics, svg=tbl.svg(), mode=mode, table=tbl);
    player_a_id = str(row.get("player_a_id") or "");
    player_b_id = str(row.get("player_b_id") or "");
    owner_user_id = str(row.get("user_id") or "");
    photos = _user_photo_urls(service, [player_a_id or owner_user_id, player_b_id]);
    table = enrich_table_player_photos(
        table,
        mode=mode,
        player_a_id=player_a_id,
        player_b_id=player_b_id,
        owner_user_id=owner_user_id,
        lookup_photo=photos.get,
    );
    physics.player1_photo_url = table.get("p1_photo_url");
    physics.player2_photo_url = table.get("p2_photo_url");

    status = str(row.get("status") or STATUS_ACTIVE);
    if table.get("game_over"):
        status = str(table.get("status") or STATUS_FINISHED);

    clock_a_ms = (move or {}).get("time_a_ms");
    clock_b_ms = (move or {}).get("time_b_ms");
    if clock_a_ms is None or clock_b_ms is None:
        raise ServiceError(500, "Game move row is missing clocks");
    clock_a_ms = int(clock_a_ms);
    clock_b_ms = int(clock_b_ms);

    anchor_iso = str((move or {}).get("created_at") or "") or datetime.now(UTC).isoformat();
    active_color = color_for_player_id(table, table.get("current_player_id"));

    raw_tail = int(ply);
    display_stream_seq = raw_tail if raw_tail >= 0 else 0;
    next_realtime_seq = (raw_tail + 1) if raw_tail >= 0 else 0;

    seat = seat_for_user(
        user_id=user_id,
        player_a_id=str(row.get("player_a_id") or ""),
        player_b_id=str(row.get("player_b_id") or ""),
    );

    return {
        "game_id": game_id,
        "mode": mode,
        "status": status,
        "table": table,
        "you_seat": seat,
        "stream_seq": display_stream_seq,
        "_internal_realtime_next_seq": next_realtime_seq,
        "clock_a_ms": int(clock_a_ms),
        "clock_b_ms": int(clock_b_ms),
        "clock_active_color": active_color,
        "clock_anchor_iso": anchor_iso,
    };

def load_game(service: DatabaseReader, user_id: str, game_id: str | None) -> tuple[PoolState, Physics.Game, AppGameRow]:
    """Load one Pool game state, physics object, and authorized row in one pass.""";
    if not game_id:
        raise ServiceError(400, "load_game requires game_id");
    requested_game_id = str(game_id);
    row = _load_row(service, user_id, requested_game_id);
    mode = _mode_from_row(row);
    move = latest_move(service, requested_game_id);
    snap, ply = _resolve_board_snapshot(service, requested_game_id, move=move);
    if snap is None:
        raise ServiceError(500, "Game has no board snapshot");
    physics = _physics_from_snapshot(requested_game_id, snap, ply);
    state = build_pool_state(
        service,
        user_id,
        requested_game_id,
        physics=physics,
        row=row,
        mode=mode,
        ply=ply,
        move=move,
    );
    return state, physics, row;

def make_persist_callable(service: RpcDatabase) -> Callable[[PoolPersistPayload], None]:

    """Create the Pool persistence callback.""";
    def _persist(payload: PoolPersistPayload) -> None:

        commit_pool_step(
            service,
            payload["game_id"],
            payload["table"],
            payload.get("trajectory"),
            label=payload.get("label") or "Shot",
            played_by_id=payload.get("played_by_id"),
            next_player_id=payload.get("next_player_id"),
            time_a_ms=payload.get("time_a_ms"),
            time_b_ms=payload.get("time_b_ms"),
            mode=payload.get("mode"),
            owner_user_id=payload.get("owner_user_id"),
            winner_player_id=payload.get("winner_player_id"),
        );
        return None;
    return _persist;

def commit_pool_step(
    service: RpcDatabase,
    game_id: str,
    table: PoolTable,
    trajectory: Trajectory | None,
    *,
    label: str,
    played_by_id: str | None = None,
    next_player_id: str | None = None,
    time_a_ms: int | None = None,
    time_b_ms: int | None = None,
    mode: Mode | None = None,
    owner_user_id: str | None = None,
    winner_player_id: str | None = None,
) -> None:
    """Persist one slim Pool table snapshot through the shared move RPC.""";
    finished = bool(table.get("game_over")) or str(table.get("status") or "") in (STATUS_FINISHED, "draw");
    game_mode = str(mode or table.get("mode") or "");
    played_fk, next_fk = move_actor_ids(played_by_id=played_by_id, next_player_id=next_player_id, table=table);
    score_a, score_b = pool_slot_scores(table);
    events = [{"trajectory": trajectory}] if trajectory is not None else [];
    params: CommitMoveParams = {
        "p_game_id": game_id,
        "p_state_json": {key: value for key, value in table.items() if key not in _DROP_FROM_STATE},
        "p_events": events,
        "p_notation": label,
        "p_status": STATUS_FINISHED if finished else STATUS_ACTIVE,
        "p_winner_id": resolve_winner_user_id(table, mode=game_mode, owner_user_id=owner_user_id, winner_player_id=winner_player_id),
        "p_reason": terminal_reason(table) or None,
        "p_played_by_id": played_fk,
        "p_next_player_id": next_fk,
        "p_score_a": score_a,
        "p_score_b": score_b,
        "p_time_a_ms": time_a_ms,
        "p_time_b_ms": time_b_ms,
        "p_side_a": table.get("p1_playing") or None,
        "p_side_b": table.get("p2_playing") or None,
    };
    commit_move(service, params);

def close_without_snapshot(service: RuntimeDatabase, game_id: str, row: AppGameRow) -> None:
    """Mark a snapshot-less Pool row finished.""";
    if str(row.get("status") or "") == STATUS_FINISHED:
        return;
    service.update(
        "app_games",
        {
            "status": STATUS_FINISHED,
            "winner_id": None,
            "reason": "Game ended",
            "updated_at": service.iso_datetime(datetime.now(UTC)),
        },
        filters={"id": game_id},
        returning="minimal",
    );

def ensure_finished_row(service: RuntimeDatabase, game_id: str, *, table: PoolTable, mode: str, owner_user_id: str) -> None:
    """Synchronously repair terminal app_games columns after cold surrender.""";
    row = service.select_one("app_games", filters={"id": game_id});
    if row is None or str(row.get("status") or "") == STATUS_FINISHED:
        return;
    service.update(
        "app_games",
        {
            "status": STATUS_FINISHED,
            "winner_id": resolve_winner_user_id(table, mode=mode, owner_user_id=owner_user_id, winner_player_id=table.get("winner_player_id")),
            "reason": terminal_reason(table) or STATUS_FINISHED,
            "updated_at": service.iso_datetime(datetime.now(UTC)),
        },
        filters={"id": game_id},
        returning="minimal",
    );

def hydrate_snapshot_svg(snapshot: PoolTable) -> PoolTable:
    """Regenerate replay SVG from persisted ball positions when necessary.""";
    if snapshot.get("svg"):
        return snapshot;
    balls = snapshot.get("balls");
    if not isinstance(balls, list) or not balls:
        return snapshot;
    return {**snapshot, "svg": table_from_ball_positions(balls).svg()};

def replay_rows(database: DatabaseReader, game_id: str) -> list[dict[str, Any]]:
    """Load ordered Pool replay snapshots and events with one query.""";
    return database.select(
        "app_game_moves",
        columns="ply,state_json,notation,events_json",
        filters={"game_id": game_id},
        order="ply.asc",
    );

def timeline_from_rows(game_id: str, rows: list[dict[str, Any]]) -> ReplayTimeline | None:
    """Build replay positions from already-loaded move rows.""";
    entries = [];
    for index, row in enumerate(rows):
        snapshot = coerce_snapshot(row.get("state_json"));
        if snapshot is not None:
            entries.append({"index": index, "step": int(row.get("ply", index)), "label": str(row.get("notation") or f"Shot {index}"), "snapshot": hydrate_snapshot_svg(snapshot), "trajectory": None});
    return {"game_id": game_id, "entries": entries, "live_index": max(len(entries) - 1, 0)} if entries else None;

def timeline_from_db(database: DatabaseReader, game_id: str) -> ReplayTimeline | None:
    """Load persisted Pool replay positions.""";
    return timeline_from_rows(game_id, replay_rows(database, game_id));

def attach_trajectories(timeline: ReplayTimeline, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach persisted shot trajectories to matching replay positions.""";
    trajectories = [{"seq": row.get("ply"), "trajectory": event.get("trajectory")} for row in rows or [] for event in row.get("events_json") or [] if isinstance(event, dict) and "trajectory" in event];
    trajectory_index = 0;
    for index, entry in enumerate(timeline.get("entries") or []):
        if index > 0 and str(entry.get("label") or "").strip() in {"Shot", "Break"} and trajectory_index < len(trajectories):
            entry["trajectory"] = trajectories[trajectory_index]["trajectory"];
            trajectory_index += 1;
        else:
            entry["trajectory"] = None;
    return trajectories;

def build_replay(database: DatabaseReader, user_id: str, *, game_id: str | None, include_events: bool = False, state_loader: Callable[[str, str], PoolState] | None = None) -> ReplayTimeline:
    """Load the persisted Pool replay timeline, falling back to the warm session.""";
    _ = include_events;
    game_id = str(game_id or "").strip();
    if not game_id:
        raise ServiceError(400, "game_id is required");
    _load_row(database, user_id, game_id);
    rows = replay_rows(database, game_id);
    timeline = timeline_from_rows(game_id, rows);
    if timeline is None:
        if state_loader is None:
            raise ServiceError(404, "Game not found");
        state = state_loader(user_id, game_id);
        table = state.get("table") if isinstance(state, dict) else None;
        if not isinstance(table, dict):
            raise ServiceError(404, "Game not found");
        timeline = {"game_id": game_id, "entries": [{"index": 0, "step": 0, "label": "Position", "snapshot": table, "trajectory": None}], "live_index": 0};
    trajectories = attach_trajectories(timeline, rows);
    return {"ok": True, "trajectories": trajectories, **timeline};

__all__ = [
    "load_game",
    "active_game_id",
    "make_persist_callable",
    "build_pool_state",
    "_load_row",
    "_mode_from_row",
    "_latest_board",
    "latest_move",
    "_resolve_board_snapshot",
    "color_for_player_id",
    "commit_pool_step",
    "close_without_snapshot",
    "ensure_finished_row",
    "build_replay",
    "hydrate_snapshot_svg",
    "timeline_from_db",
    "replay_rows",
    "timeline_from_rows",
];
