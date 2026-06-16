"""Typed registry for game-owned runtime adapters.""";

from __future__ import annotations;

from collections.abc import Callable;
from pathlib import Path;
from typing import Protocol;
from typing import Any;

from src.platform.backend import ServiceError;

from .contracts import ChatRow, GameType, JsonObject, MatchRow, RuntimeDatabase, SubscribePayload;

class GameRuntime(Protocol):
    """Operations every registered game exposes to the platform.""";

    game_type: GameType;
    modes: frozenset[str];

    def create_offline(self, user_id: str, body: JsonObject) -> str:
        """Create an offline game for one user.""";
        ...;

    def active_game(self, user_id: str) -> str:
        """Return the user's active game id.""";
        ...;

    def active_incomplete_game(self, user_id: str) -> tuple[str | None, str | None]:
        """Return the user's active unfinished game and mode.""";
        ...;

    def activate_pvp(self, user_id: str, match_id: str, player_a_id: str, player_b_id: str, match: MatchRow) -> None:
        """Activate one ready PvP match.""";
        ...;

    def create_rematch(self, player_a_id: str, player_b_id: str) -> str:
        """Create a rematch for two players.""";
        ...;

    def load_state(self, user_id: str, game_id: str) -> JsonObject:
        """Load personalized game state.""";
        ...;

    def replay(self, user_id: str, game_id: str | None, include_events: bool) -> JsonObject:
        """Load replay data for one game.""";
        ...;

    def surrender(self, user_id: str, game_id: str, cause: str | None = None) -> JsonObject:
        """Apply a player surrender.""";
        ...;

    def agree_draw(self, user_id: str, game_id: str) -> JsonObject:
        """Apply an agreed draw.""";
        ...;

    def subscribe(self, user_id: str, game_id: str, since_seq: int, wait_seconds: float) -> SubscribePayload:
        """Return realtime events after a cursor.""";
        ...;

    def broadcast_chat(self, user_id: str, game_id: str, rows: list[ChatRow]) -> None:
        """Broadcast persisted chat rows.""";
        ...;

    def reconcile_expired(self, user_id: str, game_id: str) -> bool:
        """Reconcile clock expiry for one game.""";
        ...;

    def reuse_offline(self, game_id: str) -> None:
        """Warm an existing offline game.""";
        ...;

    def metrics(self) -> dict[str, Any]:
        """Return runtime metrics.""";
        ...;

    def stop(self) -> None:
        """Stop owned runtime workers.""";
        ...;

class RuntimeRegistry:
    """Resolve registered game runtimes without platform-side game branching.""";

    def __init__(self) -> None:

        self._runtimes: dict[GameType, GameRuntime] = {};

    def register(self, runtime: GameRuntime) -> None:
        """Register one runtime by its stable game type.""";
        self._runtimes[runtime.game_type] = runtime;

    def get(self, game_type: str) -> GameRuntime:
        """Return the runtime for ``game_type`` or reject an unknown key.""";
        normalized = str(game_type or "").strip().lower();
        runtime = self._runtimes.get(normalized);  # type: ignore[arg-type]
        if runtime is None:
            raise ServiceError(400, f"Unknown game type: {normalized!r}");
        return runtime;

    def stop_all(self) -> None:
        """Stop every registered runtime coordinator.""";
        for runtime in self._runtimes.values():
            runtime.stop();

def build_runtime_registry(
    registry: RuntimeRegistry,
    *,
    database: RuntimeDatabase,
    chezz_root: Path,
    unfinished_pvp_game: Callable[[str, str], str | None],
    unfinished_offline_game: Callable[[str, str, str], str | None],
) -> None:
    """Construct each game-owned runtime adapter.""";
    from src.chezz.runtime.sessions import ChezzRuntime;
    from src.pool.runtime.sessions import PoolRuntime;

    registry.register(PoolRuntime(database, unfinished_pvp_game=unfinished_pvp_game, unfinished_offline_game=unfinished_offline_game));
    registry.register(ChezzRuntime(database, project_root=chezz_root, unfinished_pvp_game=unfinished_pvp_game, unfinished_offline_game=unfinished_offline_game));
