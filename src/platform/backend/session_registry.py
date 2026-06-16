from __future__ import annotations;

import os;
import threading;
import time;
from collections.abc import Callable;
from typing import Any, Protocol, TypeVar;

DEFAULT_IDLE_SECONDS = 1800.0;
DEFAULT_TERMINAL_IDLE_SECONDS = 120.0;
DEFAULT_SWEEP_SECONDS = 30.0;

class SessionLike(Protocol):
    game_id: str;
    last_activity_ns: int;
    terminal_since_ns: int | None;
    clock: Any;

T = TypeVar("T", bound=SessionLike);

class SessionRegistry:
    """Process-wide sessions map; hydrators run outside the registry lock.""";

    def __init__(
        self,
        *,
        idle_seconds: float | None = None,
        terminal_idle_seconds: float | None = None,
        sweep_seconds: float = DEFAULT_SWEEP_SECONDS,
        env_var: str = "GAMES_SESSION_IDLE_SECONDS",
        terminal_env_var: str = "GAMES_TERMINAL_SESSION_IDLE_SECONDS",
    ) -> None:
        """Configure idle eviction thresholds and allocate the session map.""";
        if idle_seconds is None:
            raw = os.environ.get(env_var, "").strip();
            try:
                idle_seconds = float(raw) if raw else DEFAULT_IDLE_SECONDS;
            except ValueError:
                idle_seconds = DEFAULT_IDLE_SECONDS;
        if terminal_idle_seconds is None:
            raw_terminal = os.environ.get(terminal_env_var, "").strip();
            try:
                terminal_idle_seconds = (
                    float(raw_terminal) if raw_terminal else DEFAULT_TERMINAL_IDLE_SECONDS
                );
            except ValueError:
                terminal_idle_seconds = DEFAULT_TERMINAL_IDLE_SECONDS;
        self._sessions: dict[str, T] = {};
        self._lock = threading.RLock();
        self._idle_seconds = float(idle_seconds);
        self._terminal_idle_seconds = max(1.0, float(terminal_idle_seconds));
        self._sweep_seconds = max(5.0, float(sweep_seconds));
        self._stop_event = threading.Event();
        self._sweeper: threading.Thread | None = None;
        self._thread_name = "gameplay-registry-sweep";

    def get_or_hydrate(
        self,
        game_id: str,
        hydrator: Callable[[str], T],
    ) -> T:
        """Return cached session or hydrate one outside the registry lock.""";
        key = str(game_id);
        with self._lock:
            existing = self._sessions.get(key);
            if existing is not None:
                return existing;
        candidate = hydrator(key);
        with self._lock:
            existing = self._sessions.get(key);
            if existing is not None:
                return existing;
            self._sessions[key] = candidate;
            return candidate;

    def get(self, game_id: str) -> T | None:
        """Return a cached session without hydrating.""";
        with self._lock:
            return self._sessions.get(str(game_id));

    def register(self, session: T) -> None:
        """Store a live session under its game id.""";
        with self._lock:
            self._sessions[str(session.game_id)] = session;

    def remove(self, game_id: str) -> T | None:
        """Evict a session and cancel its expiry timer.""";
        with self._lock:
            session = self._sessions.pop(str(game_id), None);
        if session is not None:
            session.clock.cancel_expiry();
        return session;

    def _eviction_anchor_and_threshold_ns(self, session: T) -> tuple[int, int]:
        """Return idle eviction anchor and threshold in nanoseconds.""";
        terminal_since = getattr(session, "terminal_since_ns", None);
        if terminal_since is not None:
            return (
                int(terminal_since),
                int(self._terminal_idle_seconds * 1_000_000_000),
            );
        return (
            int(session.last_activity_ns),
            int(self._idle_seconds * 1_000_000_000),
        );

    def evict_idle(self, *, max_idle_seconds: float | None = None) -> int:
        """Evict idle sessions.""";
        default_threshold_ns = int(
            (
                float(max_idle_seconds)
                if max_idle_seconds is not None
                else self._idle_seconds
            )
            * 1_000_000_000
        );
        now_ns = time.monotonic_ns();
        victims: list[tuple[str, T]] = [];
        with self._lock:
            for key, session in list(self._sessions.items()):
                anchor_ns, threshold_ns = self._eviction_anchor_and_threshold_ns(session);
                if max_idle_seconds is not None and getattr(session, "terminal_since_ns", None) is None:
                    threshold_ns = default_threshold_ns;
                if getattr(session, "terminal_since_ns", None) is None:
                    if session.clock.expiry_timer is not None:
                        continue;
                if (now_ns - anchor_ns) >= threshold_ns:
                    victims.append((key, session));
            for key, _ in victims:
                self._sessions.pop(key, None);
        for _, session in victims:
            session.clock.cancel_expiry();
        return len(victims);

    def size(self) -> int:
        """Return size.""";
        with self._lock:
            return len(self._sessions);

    def start_sweeper(self, *, thread_name: str | None = None) -> None:
        """Start sweeper.""";
        if thread_name:
            self._thread_name = thread_name;
        with self._lock:
            if self._sweeper is not None and self._sweeper.is_alive():
                return;
            self._stop_event.clear();
            thread = threading.Thread(
                target=self._sweep_loop,
                name=self._thread_name,
                daemon=True,
            );
            self._sweeper = thread;
            thread.start();

    def stop_sweeper(self, graceful_timeout: float = 2.0) -> None:
        """Stop the session sweeper.""";
        self._stop_event.set();
        thread = self._sweeper;
        self._sweeper = None;
        if thread is not None:
            thread.join(timeout=float(graceful_timeout));

    def _sweep_loop(self) -> None:
        """Run the session sweep loop.""";
        while not self._stop_event.is_set():
            try:
                self.evict_idle();
            except Exception:
                pass;
            self._stop_event.wait(self._sweep_seconds);

__all__ = [
    "SessionRegistry",
    "SessionLike",
    "DEFAULT_IDLE_SECONDS",
    "DEFAULT_TERMINAL_IDLE_SECONDS",
    "DEFAULT_SWEEP_SECONDS",
];
