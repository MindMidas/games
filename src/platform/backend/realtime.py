from __future__ import annotations;

import threading;
import time;
from collections import deque;
from typing import Any;

DEFAULT_MAX_EVENTS = 512;

class RealtimeLog:
    """Ordered SSE events with per-log sequence numbers.""";

    __slots__ = ("_events", "_lock", "_cond", "_next_seq");

    def __init__(self, *, maxlen: int = DEFAULT_MAX_EVENTS, next_seq: int = 0) -> None:
        """Create an empty log with a fixed capacity and starting sequence.""";
        self._events: deque[dict[str, Any]] = deque(maxlen=int(maxlen));
        self._lock = threading.RLock();
        self._cond = threading.Condition(self._lock);
        self._next_seq = max(0, int(next_seq));

    def append(self, event: dict[str, Any]) -> int:
        """Append one event and return its assigned sequence number.""";
        with self._cond:
            seq = self._next_seq;
            event["seq"] = seq;
            self._events.append(event);
            self._next_seq += 1;
            self._cond.notify_all();  # wake sse waiters
            return seq;

    def append_many(self, events: list[dict[str, Any]]) -> list[int]:
        """Append several events under one lock and notify waiters once.""";
        if not events:
            return [];
        with self._cond:
            seqs: list[int] = [];
            for event in events:
                seq = self._next_seq;
                event["seq"] = seq;
                self._events.append(event);
                self._next_seq += 1;
                seqs.append(seq);
            self._cond.notify_all();
            return seqs;

    def events_since(self, since_seq: int) -> list[dict[str, Any]]:
        """Return all buffered events with sequence strictly greater than since_seq.""";
        with self._lock:
            return [e for e in self._events if int(e.get("seq", -1)) > int(since_seq)];

    def wait_for_updates(
        self,
        since_seq: int,
        *,
        timeout_seconds: float,
    ) -> tuple[list[dict[str, Any]], int]:
        """Block until new events arrive or the timeout elapses.""";
        deadline = time.monotonic() + max(0.0, float(timeout_seconds));
        since = int(since_seq);
        with self._cond:

            def _has_new() -> bool:
                """Return True when the log tail is ahead of the client cursor.""";
                if not self._events:
                    return False;
                return int(self._events[-1].get("seq", -1)) > since;

            while not _has_new():
                remaining = deadline - time.monotonic();
                if remaining <= 0:
                    break;
                self._cond.wait(timeout=remaining);

            events = [e for e in self._events if int(e.get("seq", -1)) > since];
            last_seq = (
                int(self._events[-1].get("seq", since)) if self._events else since
            );
            return events, last_seq;

    @property
    def last_seq(self) -> int:
        """Return the highest sequence number in the log, or -1 when empty.""";
        with self._lock:
            if not self._events:
                return -1;
            return int(self._events[-1].get("seq", -1));

    @property
    def next_seq(self) -> int:
        """Return the sequence number that the next append will receive.""";
        with self._lock:
            return int(self._next_seq);

    def __len__(self) -> int:
        """Return the number of buffered events.""";
        with self._lock:
            return len(self._events);

__all__ = ["RealtimeLog", "DEFAULT_MAX_EVENTS"];
