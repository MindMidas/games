from __future__ import annotations;

import os;
from pathlib import Path;
from typing import Any;

from src.platform.backend.auth import AuthService;
from src.platform.backend.constants import DEFAULT_ONLINE_PRESENCE_SECONDS, DEFAULT_SESSION_TTL_DAYS;
from src.platform.backend.matchmaking import MatchmakingService;
from src.platform.backend.runtimes import GameRuntime, RuntimeRegistry, build_runtime_registry;
from src.platform.backend import ServiceError;
from src.platform.backend.db import Database;
from src.platform.backend.social import SocialService;
from src.platform.supabase import SupabaseConfig, SupabaseStore;

from src.chezz.runtime.contracts import (
    GAME_TYPE_CHEZZ,
);

class GamesApp:

    def __init__(self, games_root: Path) -> None:
        """Initialize the composed platform application and game runtimes.""";
        chezz_root = games_root / "chezz";
        config = SupabaseConfig.from_env();
        if config is None:
            raise RuntimeError(
                "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
            );
        auth_pepper = (os.environ.get("GAMES_AUTH_PEPPER") or "").strip();
        if len(auth_pepper) < 32 or auth_pepper.lower().startswith("change-me"):
            raise RuntimeError("GAMES_AUTH_PEPPER must be a stable random value of at least 32 characters.");
        store = SupabaseStore(config);
        self.database = Database(store);
        self.auth = AuthService(
            self.database,
            auth_pepper,
            session_ttl_days=DEFAULT_SESSION_TTL_DAYS,
            online_presence_seconds=DEFAULT_ONLINE_PRESENCE_SECONDS,
        );
        self._runtimes = RuntimeRegistry();
        self.matchmaking = MatchmakingService(
            self.database,
            self.runtime,
            online_presence_seconds=DEFAULT_ONLINE_PRESENCE_SECONDS,
        );
        build_runtime_registry(
            self._runtimes,
            database=self.database,
            chezz_root=chezz_root,
            unfinished_pvp_game=self.matchmaking.existing_unfinished_pvp_game_id,
            unfinished_offline_game=self.matchmaking.existing_unfinished_game_by_mode,
        );
        self.social = SocialService(self.database, self.runtime);

    def runtime(self, game_type: str) -> GameRuntime:
        """Return the registered runtime for an explicit game type.""";
        return self._runtimes.get(game_type);

    def runtime_metrics(self, user_id: str) -> dict[str, Any]:
        """Return runtime metrics.""";
        from src.platform.security_config import runtime_metrics_allowed;

        if not runtime_metrics_allowed(str(user_id)):
            raise ServiceError(403, "Forbidden");
        metrics = self.runtime(GAME_TYPE_CHEZZ).metrics();
        return {
            "ok": True,
            "runtime": {
                "status": "ok",
                **metrics,
                "chat_persist_queue": self.social.chat_queue.metrics(),
            },
        };

    def readiness(self) -> dict[str, bool]:
        """Confirm the database and required engine profile are available.""";
        row = self.database.select_one(
            "app_users",
            columns="id",
            filters={"id": "engine"},
        );
        if not row:
            raise ServiceError(503, "Database is not ready");
        return {"ok": True, "ready": True};

    def close(self) -> None:
        """Stop owned background workers during process shutdown.""";
        self.social.close();
        self._runtimes.stop_all();
