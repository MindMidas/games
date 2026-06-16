from __future__ import annotations;

import random;
import uuid;
from datetime import UTC, datetime;
from typing import Any;

from src.platform.backend import ServiceError;
from src.platform.backend.contracts import RuntimeDatabase;
from src.platform.backend.game_persist import CommitMoveParams, commit_move;

from src.chezz.runtime.contracts import (
    CLOCK_INITIAL_SECONDS,
    COLOR_BLACK,
    COLOR_WHITE,
    ENGINE_USER_ID,
    GAME_TYPE_CHEZZ,
    MODE_PVE,
    MODE_PVP,
    STATUS_ACTIVE,
);

SIDE_A = "white";  # chezz slot a always plays white
SIDE_B = "black";  # chezz slot b always plays black

def initial_board_map() -> dict[str, str]:
    """Return the initial Chezz board map.""";
    return {
        "a1": "wF", "a2": "wP", "a7": "bP", "a8": "bF",
        "b1": "wN", "b2": "wP", "b7": "bP", "b8": "bN",
        "c1": "wC", "c2": "wP", "c7": "bP", "c8": "bC",
        "d1": "wQ", "d2": "wP", "d7": "bP", "d8": "bQ",
        "e1": "wK", "e2": "wZ", "e7": "bZ", "e8": "bK",
        "f1": "wB", "f2": "wP", "f7": "bP", "f8": "bB",
        "g1": "wN", "g2": "wP", "g7": "bP", "g8": "bN",
        "h1": "wR", "h2": "wP", "h7": "bP", "h8": "bR",
    };

def initial_board_state() -> dict[str, Any]:
    """Initial slim board config for the ply-0 move row (board position only).""";
    return {"board": initial_board_map()};

def append_initial_move(service: RuntimeDatabase, game_id: str, *, white_uid: str) -> None:
    """Write the ply-0 'Start' move row: board config + starting clocks + white-to-move FK.""";
    clock_ms = int(CLOCK_INITIAL_SECONDS) * 1000;
    params: CommitMoveParams = {
        "p_game_id": game_id,
        "p_state_json": initial_board_state(),
        "p_notation": "Start",
        "p_status": STATUS_ACTIVE,
        "p_winner_id": None,
        "p_reason": None,
        "p_next_player_id": str(white_uid),
        "p_time_a_ms": clock_ms,
        "p_time_b_ms": clock_ms,
        "p_side_a": SIDE_A,
        "p_side_b": SIDE_B,
    };
    commit_move(service, params);

def bootstrap_offline(service: RuntimeDatabase, user_id: str, body: dict[str, Any]) -> str:
    """Bootstrap offline.""";
    _ = body;
    return create_fresh_pve_game(service, user_id);

def create_fresh_pve_game(service: RuntimeDatabase, user_id: str) -> str:
    """Create fresh pve game.""";
    existing = service.select(
        "app_games",
        columns="id,status,mode",
        filters={"user_id": user_id, "game_type": GAME_TYPE_CHEZZ},
        limit=500,
    );
    for row in existing:
        if row.get("status") != STATUS_ACTIVE:
            continue;
        if str(row.get("mode") or "") == MODE_PVE:
            service.delete("app_games", filters={"id": row["id"]}, returning="minimal");

    player_color = random.choice([COLOR_WHITE, COLOR_BLACK]);
    if player_color == COLOR_WHITE:
        player_a_id = user_id;
        player_b_id = ENGINE_USER_ID;
    else:
        player_a_id = ENGINE_USER_ID;
        player_b_id = user_id;

    game_id = str(uuid.uuid4());
    now_iso = service.iso_datetime(datetime.now(UTC));
    service.insert(
        "app_games",
        {
            "id": game_id,
            "user_id": user_id,
            "player_a_id": player_a_id,
            "player_b_id": player_b_id,
            "game_type": GAME_TYPE_CHEZZ,
            "mode": MODE_PVE,
            "status": STATUS_ACTIVE,
            "winner_id": None,
            "reason": None,
            "side_a": SIDE_A,
            "side_b": SIDE_B,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
    );
    append_initial_move(service, game_id, white_uid=player_a_id);
    return game_id;

def insert_pvp_app_game(
    service: RuntimeDatabase,
    user_id: str,
    *,
    match_id: str,
    player_a_id: str,
    player_b_id: str,
    match: dict[str, Any],
) -> None:
    """Insert one PvP app game row.""";
    _ = user_id, match;
    now_iso = service.iso_datetime(datetime.now(UTC));
    if random.choice([True, False]):
        seat_a, seat_b = player_a_id, player_b_id;
    else:
        seat_a, seat_b = player_b_id, player_a_id;
    # The pairing already created a status='ready' app_games row; flip it to 'active' and set sides.
    update = {
        "user_id": seat_a,
        "player_a_id": seat_a,
        "player_b_id": seat_b,
        "mode": MODE_PVP,
        "status": STATUS_ACTIVE,
        "side_a": SIDE_A,
        "side_b": SIDE_B,
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
                    "game_type": GAME_TYPE_CHEZZ,
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
        append_initial_move(service, match_id, white_uid=seat_a);

def materialize_rematch(service: RuntimeDatabase, player_a_id: str, player_b_id: str) -> str:
    """Materialize rematch.""";
    match_id = str(uuid.uuid4());
    now_iso = service.iso_datetime(datetime.now(UTC));

    if random.choice([True, False]):
        seat_a, seat_b = player_a_id, player_b_id;
    else:
        seat_a, seat_b = player_b_id, player_a_id;

    try:
        service.insert(
            "app_games",
            {
                "id": match_id,
                "user_id": seat_a,
                "player_a_id": seat_a,
                "player_b_id": seat_b,
                "game_type": GAME_TYPE_CHEZZ,
                "mode": MODE_PVP,
                "status": STATUS_ACTIVE,
                "winner_id": None,
                "reason": None,
                "side_a": SIDE_A,
                "side_b": SIDE_B,
                "created_at": now_iso,
                "updated_at": now_iso,
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
        append_initial_move(service, match_id, white_uid=seat_a);
    return match_id;
