from __future__ import annotations;

from typing import Any, Literal, TypedDict, cast;

from .contracts import RpcDatabase;

class AppGameRow(TypedDict, total=False):
    """Canonical `app_games` row shared by game runtimes.""";

    id: str;
    user_id: str | None;
    player_a_id: str | None;
    player_b_id: str | None;
    game_type: Literal["pool", "chezz"];
    mode: str;
    status: Literal["ready", "active", "finished"];
    winner_id: str | None;
    reason: str | None;
    side_a: str | None;
    side_b: str | None;
    created_at: str;
    updated_at: str;

class CommitMoveParams(TypedDict, total=False):
    """Canonical `app_commit_move` RPC arguments shared by game runtimes.""";

    p_game_id: str;
    p_state_json: dict[str, Any];
    p_events: list[dict[str, Any]];
    p_notation: str;
    p_status: Literal["active", "finished"];
    p_winner_id: str | None;
    p_reason: str | None;
    p_played_by_id: str | None;
    p_next_player_id: str | None;
    p_score_a: list[Any];
    p_score_b: list[Any];
    p_time_a_ms: int | None;
    p_time_b_ms: int | None;
    p_side_a: str | None;
    p_side_b: str | None;

COMMIT_MOVE_RPC_KEYS: frozenset[str] = frozenset(
    {
        "p_game_id",
        "p_state_json",
        "p_events",
        "p_notation",
        "p_status",
        "p_winner_id",
        "p_reason",
        "p_played_by_id",
        "p_next_player_id",
        "p_score_a",
        "p_score_b",
        "p_time_a_ms",
        "p_time_b_ms",
        "p_side_a",
        "p_side_b",
    }
);

def filter_commit_params(params: CommitMoveParams) -> CommitMoveParams:
    """Filter commit parameters.""";
    return cast(CommitMoveParams, {k: v for k, v in params.items() if k in COMMIT_MOVE_RPC_KEYS});

def commit_move(service: RpcDatabase, params: CommitMoveParams) -> Any:
    """Atomic move append + game-row update via ``app_commit_move``.""";
    return service.rpc("app_commit_move", filter_commit_params(params));

def load_active_game(service: RpcDatabase, user_id: str, game_type: str) -> list[dict[str, Any]]:
    """Load active game.""";
    rows = service.rpc(
        "app_load_active_game",
        {"p_user_id": user_id, "p_game_type": game_type},
    );
    if rows is None:
        return [];
    if isinstance(rows, list):
        return rows;
    return [rows];
