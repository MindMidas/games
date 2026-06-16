from __future__ import annotations;

from dataclasses import dataclass;
from src.platform.backend import ServiceError;

@dataclass(frozen=True)
class GameDef:
    game_type: str;
    offline_mode: str;
    pvp_mode: str;
    valid_modes: frozenset[str];
    default_mode: str;
    mode_error: str;
    workflow_step: str | None;
    err_pvp_blocks_offline: str;
    err_offline_blocks_other: str;

GAMES: dict[str, GameDef] = {
    "pool": GameDef(
        game_type="pool",
        offline_mode="pnp",
        pvp_mode="pvp",
        valid_modes=frozenset({"pvp", "pnp"}),
        default_mode="pnp",
        mode_error="mode must be 'pvp' or 'pnp'",
        workflow_step=None,
        err_pvp_blocks_offline=(
            "Finish or end your current online game before starting Pass & Play."
        ),
        err_offline_blocks_other=(
            "Finish or end your current Pass & Play game before starting another match."
        ),
    ),
    "chezz": GameDef(
        game_type="chezz",
        offline_mode="pve",
        pvp_mode="pvp",
        valid_modes=frozenset({"pve", "pvp"}),
        default_mode="pve",
        mode_error="mode must be 'pve' or 'pvp'",
        workflow_step="new_game",
        err_pvp_blocks_offline=(
            "Finish or surrender your current online game before starting a vs-engine match."
        ),
        err_offline_blocks_other=(
            "Finish or surrender your current game before starting a new match."
        ),
    ),
};

def get_game_def(game_type: str) -> GameDef:
    """Return static registration metadata for Pool or Chezz.""";
    normalized_game_type = str(game_type or "").strip().lower();
    if normalized_game_type not in GAMES:
        raise ServiceError(400, f"Unknown game type: {normalized_game_type!r}");
    return GAMES[normalized_game_type];
