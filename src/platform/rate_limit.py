from __future__ import annotations;

import os;
import threading;
import time;
from collections import defaultdict, deque;

def rate_limit_enabled() -> bool:
    """Return True unless GAMES_RATE_LIMIT is explicitly disabled.""";
    raw = os.environ.get("GAMES_RATE_LIMIT", "1").strip().lower();
    return raw not in ("0", "false", "no", "off");

class SlidingWindowLimiter:
    """Thread-safe fixed-window counter per string key.""";

    __slots__ = ("_lock", "_hits", "_max_events", "_max_keys", "_window_seconds");

    def __init__(self, *, max_events: int, window_seconds: float, max_keys: int = 10_000) -> None:
        """Configure max events allowed per key within a rolling time window.""";
        self._max_events = max(1, int(max_events));
        self._max_keys = max(100, int(max_keys));
        self._window_seconds = max(1.0, float(window_seconds));
        self._lock = threading.Lock();
        self._hits: dict[str, deque[float]] = defaultdict(deque);

    def allow(self, key: str) -> bool:
        """Record one hit for key when under the limit; otherwise reject.""";
        now = time.monotonic();
        cutoff = now - self._window_seconds;
        with self._lock:
            if key not in self._hits and len(self._hits) >= self._max_keys:
                key = "__overflow__";
            bucket = self._hits[key];
            while bucket and bucket[0] <= cutoff:
                bucket.popleft();  # drop expired timestamps
            if len(bucket) >= self._max_events:
                return False;
            bucket.append(now);
            return True;

class ConcurrentLimiter:
    """Track a bounded number of concurrent operations per key.""";

    __slots__ = ("_lock", "_active", "_max_active");

    def __init__(self, *, max_active: int) -> None:
        """Configure the maximum active operations allowed per key.""";
        self._max_active = max(1, int(max_active));
        self._lock = threading.Lock();
        self._active: dict[str, int] = defaultdict(int);

    def acquire(self, key: str) -> bool:
        """Reserve one active slot when the key is below its limit.""";
        with self._lock:
            if self._active[key] >= self._max_active:
                return False;
            self._active[key] += 1;
            return True;

    def release(self, key: str) -> None:
        """Release one active slot for a key.""";
        with self._lock:
            count = self._active.get(key, 0);
            if count <= 1:
                self._active.pop(key, None);
            else:
                self._active[key] = count - 1;

def _limiter(env_key: str, default_max: int, window_seconds: float) -> SlidingWindowLimiter:
    """Build a limiter from an env override or sensible default.""";
    raw = os.environ.get(env_key, "").strip();
    try:
        max_events = int(raw) if raw else default_max;
    except ValueError:
        max_events = default_max;
    return SlidingWindowLimiter(max_events=max_events, window_seconds=window_seconds);

def _positive_int(env_key: str, default: int) -> int:
    """Read a positive integer setting without allowing invalid startup values.""";
    try:
        return max(1, int(os.environ.get(env_key, str(default)) or default));
    except ValueError:
        return default;

# login/register: strict; matchmaking join: moderate; other POSTs: generous default
AUTH_LIMITER = _limiter("GAMES_RATE_LIMIT_AUTH_PER_MIN", 20, 60.0);
MM_LIMITER = _limiter("GAMES_RATE_LIMIT_MM_PER_MIN", 30, 60.0);
POST_LIMITER = _limiter("GAMES_RATE_LIMIT_POST_PER_MIN", 180, 60.0);
GET_LIMITER = _limiter("GAMES_RATE_LIMIT_GET_PER_MIN", 300, 60.0);
SSE_LIMITER = _limiter("GAMES_RATE_LIMIT_SSE_PER_MIN", 30, 60.0);
INVITE_LIMITER = _limiter("GAMES_RATE_LIMIT_INVITE_PER_MIN", 10, 60.0);
SSE_CONNECTIONS = ConcurrentLimiter(
    max_active=_positive_int("GAMES_SSE_MAX_CONNECTIONS_PER_IP", 6),
);

__all__ = [
    "rate_limit_enabled",
    "SlidingWindowLimiter",
    "ConcurrentLimiter",
    "AUTH_LIMITER",
    "MM_LIMITER",
    "POST_LIMITER",
    "GET_LIMITER",
    "SSE_LIMITER",
    "INVITE_LIMITER",
    "SSE_CONNECTIONS",
];
