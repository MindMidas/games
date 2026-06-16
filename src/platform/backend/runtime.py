"""Shared runtime primitives retained for clocks, SSE, registries, and persistence.""";

from datetime import UTC, datetime;
from typing import Any;

from src.platform.backend.clock import GameClock;
from src.platform.backend.contracts import TERMINAL_STATUSES;
from src.platform.backend.persist import PersistQueue;
from src.platform.backend.realtime import RealtimeLog;
from src.platform.backend.session_registry import SessionRegistry;

def is_terminal_game_state(state: Any) -> bool:
    """Return whether hydrated or live state represents a finished match.""";
    if not isinstance(state, dict):
        return False;
    if str(state.get("status") or "").lower() in TERMINAL_STATUSES:
        return True;
    result = state.get("result");
    if isinstance(result, dict) and str(result.get("status") or "").lower() in TERMINAL_STATUSES:
        return True;
    table = state.get("table");
    return isinstance(table, dict) and bool(table.get("game_over"));

def attach_clock_and_realtime(state: dict[str, Any]) -> tuple[GameClock, RealtimeLog]:
    """Build a clock and SSE log from one hydrated state.""";
    clock = GameClock(
        white_ms=int(state.get("clock_a_ms", 0)),
        black_ms=int(state.get("clock_b_ms", 0)),
        active_color=state.get("clock_active_color") or "w",
        anchor_iso=str(state.get("clock_anchor_iso") or datetime.now(UTC).isoformat()),
    );
    state["clock_anchor_iso"] = clock.anchor_iso;
    hint = state.pop("_internal_realtime_next_seq", None);
    tail = int(state.get("stream_seq", 0));
    return clock, RealtimeLog(next_seq=int(hint) if hint is not None else ((tail + 1) if tail > 0 else 0));

__all__ = [
    "GameClock",
    "PersistQueue",
    "RealtimeLog",
    "SessionRegistry",
    "attach_clock_and_realtime",
    "is_terminal_game_state",
];
