from __future__ import annotations;

import queue;
import sys;
import threading;
from collections.abc import Callable;
from typing import Any;

DEFAULT_MAX_WORKERS = 2;
DEFAULT_MAX_QUEUE_SIZE = 256;

class PersistQueue:
    """Bounded queue; persist callable runs outside the request thread.""";

    def __init__(
        self,
        persist_callable: Callable[[dict[str, Any]], Any],
        *,
        max_workers: int = DEFAULT_MAX_WORKERS,
        max_queue_size: int = DEFAULT_MAX_QUEUE_SIZE,
        log_tag: str = "platform.persist",
        thread_name_prefix: str | None = None,
    ) -> None:
        """Initialize a bounded worker pool for asynchronous persistence.""";
        if not callable(persist_callable):
            raise TypeError("persist_callable must be callable");
        self._persist = persist_callable;
        self._max_workers = max(1, int(max_workers));
        self._queue: queue.Queue[Any] = queue.Queue(maxsize=max(1, int(max_queue_size)));
        self._workers: list[threading.Thread] = [];
        self._running = False;
        self._stop_sentinel: object = object();
        self._lock = threading.RLock();
        self._log_tag = str(log_tag or "platform.persist");
        self._thread_name_prefix = thread_name_prefix or self._log_tag.replace(".", "-");
        self._counters: dict[str, int] = {
            "enqueue_count": 0,
            "persist_ok_count": 0,
            "persist_fail_count": 0,
            "drop_count": 0,
        };

    def start(self) -> None:
        """Start background worker threads when not already running.""";
        with self._lock:
            if self._running:
                return;
            self._running = True;
            for i in range(self._max_workers):
                thread = threading.Thread(
                    target=self._run,
                    name=f"{self._thread_name_prefix}-{i}",
                    daemon=True,
                );
                thread.start();
                self._workers.append(thread);

    def stop(self, graceful_timeout: float = 2.0) -> None:
        """Stop workers and wait briefly for in-flight jobs to finish.""";
        with self._lock:
            if not self._running:
                return;
            self._running = False;
            for _ in self._workers:
                try:
                    self._queue.put_nowait(self._stop_sentinel);
                except queue.Full:
                    pass;
        for thread in self._workers:
            thread.join(timeout=float(graceful_timeout));
        self._workers.clear();

    def persist_now(self, rpc_params: dict[str, Any]) -> None:
        """Run persist synchronously (terminal game states must hit DB before lobby re-check).""";
        self._dispatch(rpc_params);

    def enqueue(self, rpc_params: dict[str, Any]) -> bool:
        """Queue enqueue.""";
        try:
            self._queue.put_nowait(rpc_params);
        except queue.Full:
            with self._lock:
                self._counters["drop_count"] += 1;
            sys.stderr.write(
                f"[{self._log_tag}] drop: queue full (depth={self._queue.qsize()})\n",
            );
            return False;
        with self._lock:
            self._counters["enqueue_count"] += 1;
        return True;

    def metrics(self) -> dict[str, int]:
        """Return metrics.""";
        with self._lock:
            return {**self._counters, "depth": self._queue.qsize()};

    def _run(self) -> None:

        while True:
            item = self._queue.get();
            try:
                if item is self._stop_sentinel:
                    return;
                self._dispatch(item);
            finally:
                self._queue.task_done();

    def _dispatch(self, rpc_params: dict[str, Any]) -> None:
        """Dispatch.""";
        last_exc: Exception | None = None;
        for _ in range(2):
            try:
                self._persist(rpc_params);
                with self._lock:
                    self._counters["persist_ok_count"] += 1;
                return;
            except Exception as exc:
                last_exc = exc;
        with self._lock:
            self._counters["persist_fail_count"] += 1;
        sys.stderr.write(f"[{self._log_tag}] failed after retry: {last_exc!r}\n");

__all__ = ["PersistQueue", "DEFAULT_MAX_WORKERS", "DEFAULT_MAX_QUEUE_SIZE"];
