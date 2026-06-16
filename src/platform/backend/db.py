from __future__ import annotations;

import logging;
from collections.abc import Mapping;
from typing import Any;

from src.platform.supabase import SupabaseError;

from .contracts import DbFilters, GameAccessRow;
from .errors import ServiceError;

LOGGER = logging.getLogger(__name__);

class Database:
    """Filter-safe Supabase boundary shared by platform services and runtimes.""";

    def __init__(self, store: Any) -> None:

        self._store = store;

    def select(self,
               table: str,
               *,
               columns: str = "*",
               filters: DbFilters | None = None,
               order: str | None = None,
               limit: int | None = None) -> list[dict[str, Any]]:
        """Select rows through the platform Supabase error boundary.""";
        try:
            return self._store.select(
                table,
                columns=columns,
                filters=filters,
                order=order,
                limit=limit,
            );
        except SupabaseError as exc:
            if exc.status >= 500:
                LOGGER.exception("Supabase select failed for table %s", table);
                raise ServiceError(502, "Database request failed") from exc;
            raise ServiceError(exc.status, "Database request rejected") from exc;

    def select_one(self,
                   table: str,
                   *,
                   columns: str = "*",
                   filters: DbFilters | None = None,
                   order: str | None = None) -> dict[str, Any] | None:
        """Select the first matching row, or return ``None``.""";
        rows = self.select(
            table,
            columns=columns,
            filters=filters,
            order=order,
            limit=1,
        );
        if not rows:
            return None;
        return rows[0];

    def insert(self,
               table: str,
               data: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Insert one row or a batch through the platform error boundary.""";
        try:
            return self._store.insert(table, data);
        except SupabaseError as exc:
            if exc.status == 409:
                raise ServiceError(409, "Request conflicts with existing data") from exc;
            if exc.status >= 500:
                LOGGER.exception("Supabase insert failed for table %s", table);
                raise ServiceError(502, "Database request failed") from exc;
            raise ServiceError(exc.status, "Database request rejected") from exc;

    def update(self,
               table: str,
               data: dict[str, Any],
               *,
               filters: DbFilters,
               returning: str = "representation") -> list[dict[str, Any]]:
        """Update selected rows and reject unfiltered writes.""";
        if not filters:
            raise ServiceError(500, f"update on {table} requires non-empty filters");
        try:
            return self._store.update(table, data, filters=filters, returning=returning);
        except SupabaseError as exc:
            if exc.status >= 500:
                LOGGER.exception("Supabase update failed for table %s", table);
                raise ServiceError(502, "Database request failed") from exc;
            raise ServiceError(exc.status, "Database request rejected") from exc;

    def delete(self,
               table: str,
               *,
               filters: DbFilters,
               returning: str = "representation") -> list[dict[str, Any]]:
        """Delete selected rows and reject unfiltered writes.""";
        if not filters:
            raise ServiceError(500, f"delete on {table} requires non-empty filters");
        try:
            return self._store.delete(table, filters=filters, returning=returning);
        except SupabaseError as exc:
            if exc.status >= 500:
                LOGGER.exception("Supabase delete failed for table %s", table);
                raise ServiceError(502, "Database request failed") from exc;
            raise ServiceError(exc.status, "Database request rejected") from exc;

    def rpc(self, function_name: str, params: Mapping[str, Any] | None = None) -> Any:
        """Call a Supabase RPC through the platform error boundary.""";
        try:
            return self._store.rpc(function_name, params=dict(params or {}));
        except SupabaseError as exc:
            if exc.status >= 500:
                LOGGER.exception("Supabase RPC failed for %s", function_name);
                raise ServiceError(502, "Database request failed") from exc;
            raise ServiceError(exc.status, "Database request rejected") from exc;

    def require_game_member(self, user_id: str, game_id: str) -> GameAccessRow:
        """Return one persisted game after checking that the caller occupies a seat.""";
        requested_game_id = str(game_id or "").strip();
        if not requested_game_id:
            raise ServiceError(400, "game_id is required.");
        row = self.select_one(
            "app_games",
            columns="id,game_type,status,mode,user_id,player_a_id,player_b_id",
            filters={"id": requested_game_id},
        );
        if not isinstance(row, dict):
            raise ServiceError(404, "Game not found.");
        if str(user_id) not in {
            str(row.get("player_a_id") or ""),
            str(row.get("player_b_id") or ""),
        }:
            raise ServiceError(403, "Not a player in this game.");
        return row;  # type: ignore[return-value]

    def iso_datetime(self, value: Any) -> str:
        """Serialize a timezone-aware timestamp for Supabase.""";
        from datetime import UTC;
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z");

    def parse_iso_datetime(self, value: str) -> Any:
        """Parse an ISO timestamp and normalize naive values to UTC.""";
        from datetime import UTC, datetime;

        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"));
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC);

__all__ = ["Database"];
