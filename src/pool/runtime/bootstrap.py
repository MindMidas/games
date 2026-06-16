from __future__ import annotations;

import random;
import uuid;
from datetime import UTC, datetime;
from typing import Any, Callable;

from src.platform.backend import ServiceError;
from src.platform.backend.contracts import RuntimeDatabase;
from src.pool.runtime import Physics;
from src.pool.runtime.contracts import (
    GAME_TYPE_POOL,
    INITIAL_CLOCK_MS,
    Mode,
    MODE_PASS_AND_PLAY,
    MODE_PVP,
    STATUS_ACTIVE,
);
from src.pool.runtime.game import game_to_table_snapshot, initialize_table;
from src.pool.runtime.repository import commit_pool_step;

RegisterWarm = Callable[..., None];

def bootstrap_offline(service: RuntimeDatabase, user_id: str, body: dict[str, Any], *, register_warm: RegisterWarm | None = None) -> str:
    """Bootstrap offline.""";
    p1 = str(body.get("player1_name") or body.get("p1_name") or "").strip();
    p2 = str(body.get("player2_name") or body.get("p2_name") or "").strip();
    user_row = service.select_one("app_users", filters={"id": user_id});
    username = str((user_row or {}).get("username") or "Player 1");
    if not p1:
        p1 = username;
    if not p2:
        p2 = "Player 2";
    return create_pass_and_play_game(service, user_id, player1_name=p1, player2_name=p2, register_warm=register_warm);

def on_reuse_offline_game(service: RuntimeDatabase, game_id: str) -> None:
    """Reuse an existing offline game.""";
    row = service.select_one(
        "app_games",
        filters={"id": game_id, "game_type": GAME_TYPE_POOL},
    );
    if isinstance(row, dict):
        repair_missing_board_snapshot(service, game_id, row);

def insert_pvp_app_game(
    service: RuntimeDatabase,
    user_id: str,
    *,
    match_id: str,
    player_a_id: str,
    player_b_id: str,
    match: dict[str, Any],
    register_warm: RegisterWarm | None = None,
) -> None:
    """Insert one PvP app game row.""";
    from src.pool.runtime.repository import load_player_profiles;
    user_a, user_b = load_player_profiles(service, player_a_id, player_b_id);
    p1_name = str((user_a or {}).get("username") or "Player 1");
    p2_name = str((user_b or {}).get("username") or "Player 2");
    p1_photo = (user_a or {}).get("photo_url");
    p2_photo = (user_b or {}).get("photo_url");
    now_iso = service.iso_datetime(datetime.now(UTC));
    # The pairing already created a status='ready' app_games row; flip it to 'active'.
    update = {
        "user_id": user_id,
        "player_a_id": player_a_id,
        "player_b_id": player_b_id,
        "mode": MODE_PVP,
        "status": STATUS_ACTIVE,
        "updated_at": now_iso,
    };
    updated = service.update(
        "app_games",
        update,
        filters={"id": match_id},
        returning="representation",
    );
    if not updated:
        try:
            service.insert(
                "app_games",
                {
                    "id": match_id,
                    "game_type": GAME_TYPE_POOL,
                    "created_at": now_iso,
                    **update,
                },
            );
        except ServiceError as exc:
            if exc.status != 409:
                raise;
    board_exists = service.select_one(
        "app_game_moves",
        columns="id",
        filters={"game_id": match_id},
    );
    if board_exists is None:
        bootstrap_physics_game(
            service,
            match_id,
            p1_name,
            p2_name,
            MODE_PVP,
            owner_user_id=user_id,
            player1_id=player_a_id,
            player2_id=player_b_id,
            player1_photo_url=p1_photo,
            player2_photo_url=p2_photo,
            register_warm=register_warm,
        );

def materialize_rematch(service: RuntimeDatabase, player_a_id: str, player_b_id: str, *, register_warm: RegisterWarm | None = None) -> str:
    """Materialize rematch.""";
    match_id = str(uuid.uuid4());
    now_iso = service.iso_datetime(datetime.now(UTC));
    from src.pool.runtime.repository import load_player_profiles;
    user_a, user_b = load_player_profiles(service, player_a_id, player_b_id);
    try:
        service.insert(
            "app_games",
            {
                "id": match_id,
                "user_id": player_a_id,
                "player_a_id": player_a_id,
                "player_b_id": player_b_id,
                "game_type": GAME_TYPE_POOL,
                "mode": MODE_PVP,
                "status": STATUS_ACTIVE,
                "winner_id": None,
                "reason": None,
                "created_at": now_iso,
                "updated_at": now_iso,
            },
        );
    except ServiceError as exc:
        if exc.status != 409:
            raise;
    bootstrap_physics_game(
        service,
        match_id,
        str(user_a.get("username") or "Player 1"),
        str(user_b.get("username") or "Player 2"),
        MODE_PVP,
        owner_user_id=player_a_id,
        player1_id=player_a_id,
        player2_id=player_b_id,
        player1_photo_url=user_a.get("photo_url"),
        player2_photo_url=user_b.get("photo_url"),
        register_warm=register_warm,
    );
    return match_id;

def create_pass_and_play_game(
    service: RuntimeDatabase,
    user_id: str,
    *,
    player1_name: str,
    player2_name: str,
    register_warm: RegisterWarm | None = None,
) -> str:
    """Create pass and play game.""";
    game_id = str(uuid.uuid4());
    now_iso = service.iso_datetime(datetime.now(UTC));
    service.insert(
        "app_games",
        {
            "id": game_id,
            "user_id": user_id,
            "player_a_id": user_id,
            "player_b_id": None,
            "game_type": GAME_TYPE_POOL,
            "mode": MODE_PASS_AND_PLAY,
            "status": STATUS_ACTIVE,
            "winner_id": None,
            "reason": None,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
    );
    owner_row = service.select_one("app_users", filters={"id": user_id}) if user_id else None;
    owner_photo = (owner_row or {}).get("photo_url") if owner_row else None;
    bootstrap_physics_game(
        service,
        game_id,
        player1_name,
        player2_name,
        MODE_PASS_AND_PLAY,
        owner_user_id=user_id,
        player1_photo_url=owner_photo,
        player2_photo_url=None,
        register_warm=register_warm,
    );
    return game_id;

def bootstrap_physics_game(
    service: RuntimeDatabase,
    app_game_id: str,
    p1_name: str,
    p2_name: str,
    mode: Mode,
    *,
    owner_user_id: str,
    player1_id: str | None = None,
    player2_id: str | None = None,
    player1_photo_url: str | None = None,
    player2_photo_url: str | None = None,
    register_warm: RegisterWarm | None = None,
) -> None:
    """Bootstrap a physics-backed pool game.""";
    if player1_id is not None and player2_id is not None:
        physics = Physics.Game(
            game_name=f"Pool {app_game_id[:8]}",
            player1_name=p1_name,
            player2_name=p2_name,
            player1_id=player1_id,
            player2_id=player2_id,
            current_player_id=random.choice([player1_id, player2_id]),
        );
    else:
        physics = Physics.Game(
            game_name=f"Pool {app_game_id[:8]}",
            player1_name=p1_name,
            player2_name=p2_name,
        );
    physics.app_game_id = app_game_id;
    physics.player1_photo_url = player1_photo_url;
    physics.player2_photo_url = player2_photo_url;
    rack = initialize_table();
    physics._cached_table = rack;
    snapshot = game_to_table_snapshot(physics, svg=rack.svg(), mode=mode, table=rack);
    try:
        commit_pool_step(
            service,
            app_game_id,
            snapshot,
            None,
            label="Break",
            next_player_id=snapshot.get("current_player_id"),
            time_a_ms=INITIAL_CLOCK_MS,
            time_b_ms=INITIAL_CLOCK_MS,
        );
    except ServiceError as exc:
        service.delete("app_games", filters={"id": app_game_id});
        msg = str(exc.message or "").lower();
        if exc.status == 404 or "app_commit_move" in msg:
            raise ServiceError(
                503,
                "Pool database function app_commit_move is missing. "
                "Run src/db/supabase_schema.sql in Supabase.",
            ) from exc;
        raise;
    row = service.select_one(
        "app_games",
        filters={"id": app_game_id, "game_type": GAME_TYPE_POOL},
    );
    if isinstance(row, dict) and register_warm is not None:
        register_warm(
            owner_user_id,
            app_game_id,
            physics=physics,
            row=row,
            mode=mode,
            ply=0,
        );

def repair_missing_board_snapshot(service: RuntimeDatabase, game_id: str, row: dict[str, Any]) -> bool:
    """Backfill the opening snapshot for an old active pass-and-play row only.""";
    if str(row.get("status") or "") != STATUS_ACTIVE:
        return False;
    mode = str(row.get("mode") or MODE_PASS_AND_PLAY);
    if mode != MODE_PASS_AND_PLAY:
        return False;
    owner = str(row.get("user_id") or "");
    user_row = service.select_one("app_users", filters={"id": owner}) if owner else None;
    p1 = str((user_row or {}).get("username") or "Player 1");
    owner_photo = (user_row or {}).get("photo_url") if user_row else None;
    physics = Physics.Game(
        game_name=f"Pool {game_id[:8]}",
        player1_name=p1,
        player2_name="Player 2",
    );
    physics.app_game_id = game_id;
    physics.player1_photo_url = owner_photo;
    physics.player2_photo_url = None;
    rack = initialize_table();
    physics._cached_table = rack;
    snapshot = game_to_table_snapshot(physics, svg=rack.svg(), mode=mode, table=rack);
    commit_pool_step(
        service,
        game_id,
        snapshot,
        None,
        label="Break",
        next_player_id=snapshot.get("current_player_id"),
        time_a_ms=INITIAL_CLOCK_MS,
        time_b_ms=INITIAL_CLOCK_MS,
    );
    return True;
