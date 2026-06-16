from __future__ import annotations;

import os;
import queue;
import sys;
import threading;
import time;
from collections import defaultdict;
from collections.abc import Callable, Sequence;
from typing import Any;

DEFAULT_MAX_QUEUE = 512;
DEFAULT_BATCH_MAX = 32;
DEFAULT_FLUSH_INTERVAL_S = 0.02;

def _env_int(key: str, default: int) -> int:
    """Read an integer environment setting.""";
    raw = os.environ.get(key, "").strip();
    if not raw:
        return default;
    try:
        return max(1, int(raw));
    except ValueError:
        return default;

def _env_float(key: str, default: float) -> float:
    """Read a float environment setting.""";
    raw = os.environ.get(key, "").strip();
    if not raw:
        return default;
    try:
        return max(0.001, float(raw));
    except ValueError:
        return default;

class ChatOutboundQueue:
    """
    Write-behind chat pipeline: drain the queue in batches, push all rows to SSE,
    then persist with one Supabase insert per batch.
    """;

    def __init__(
        self,
        *,
        persist_batch: Callable[[list[dict[str, Any]]], Sequence[dict[str, Any]] | None],
        broadcast_batch: Callable[[str, str, list[dict[str, Any]]], None],
        batch_max: int | None = None,
        flush_interval_s: float | None = None,
        max_queue_size: int = DEFAULT_MAX_QUEUE,
        log_tag: str = "games.chat",
    ) -> None:
        """Initialize the outbound chat worker queue and tuning knobs.""";
        if not callable(persist_batch):
            raise TypeError("persist_batch must be callable");
        if not callable(broadcast_batch):
            raise TypeError("broadcast_batch must be callable");
        self._persist_batch = persist_batch;
        self._broadcast_batch = broadcast_batch;
        self._batch_max = _env_int("GAMES_CHAT_BATCH_MAX", batch_max or DEFAULT_BATCH_MAX);
        self._flush_interval_s = _env_float(
            "GAMES_CHAT_FLUSH_MS",
            (flush_interval_s or DEFAULT_FLUSH_INTERVAL_S) * 1000.0,
        ) / 1000.0;
        self._max_queue_size = max(1, int(max_queue_size));
        self._queue: queue.Queue[dict[str, Any] | object] = queue.Queue(
            maxsize=self._max_queue_size,
        );
        self._worker: threading.Thread | None = None;
        self._running = False;
        self._stop_sentinel = object();
        self._log_tag = log_tag;
        self._lock = threading.RLock();
        self._counters: dict[str, int] = {
            "enqueue_count": 0,
            "drop_count": 0,
            "batch_count": 0,
            "fast_flush_count": 0,
            "rows_broadcast": 0,
            "rows_persisted": 0,
            "persist_fail_count": 0,
        };

    def start(self) -> None:
        """Start the background chat flush worker when not already running.""";
        with self._lock:
            if self._running:
                return;
            self._running = True;
            self._worker = threading.Thread(
                target=self._run,
                name="games-chat-outbound",
                daemon=True,
            );
            self._worker.start();

    def stop(self, graceful_timeout: float = 2.0) -> None:
        """Stop the worker and wait briefly for in-flight batches.""";
        with self._lock:
            if not self._running:
                return;
            self._running = False;
            try:
                self._queue.put_nowait(self._stop_sentinel);
            except queue.Full:
                pass;
        if self._worker is not None:
            self._worker.join(timeout=float(graceful_timeout));
            self._worker = None;

    def enqueue(
        self,
        game_id: str,
        chat_row: dict[str, Any],
        *,
        game_type: str,
    ) -> bool:
        """Enqueue one optimistic chat row for persistence and SSE broadcast.""";
        normalized_game_id = str(game_id or "").strip();
        if not normalized_game_id or not isinstance(chat_row, dict):
            return False;
        item = {
            "game_id": normalized_game_id,
            "game_type": str(game_type or "").strip().lower(),
            "row": dict(chat_row),
            "persist": {
                "game_id": normalized_game_id,
                "user_id": chat_row.get("user_id"),
                "username": chat_row.get("username"),
                "body": chat_row.get("body"),
                "created_at": chat_row.get("created_at"),
            },
        };
        try:
            self._queue.put_nowait(item);
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

    def status(self) -> dict[str, int | bool]:
        """Return status.""";
        depth = self._queue.qsize();
        max_q = self._max_queue_size;
        return {
            "depth": depth,
            "max": max_q,
            "accepting": depth < max_q,
            "ready": depth == 0,
        };

    def metrics(self) -> dict[str, int | float | bool]:
        """Return metrics.""";
        with self._lock:
            snap = self.status();
            out: dict[str, int | float | bool] = {
                **self._counters,
                **snap,
                "batch_max": self._batch_max,
                "flush_interval_ms": round(self._flush_interval_s * 1000.0, 3),
            };
            return out;

    def _run(self) -> None:

        while True:
            try:
                first = self._queue.get(timeout=self._flush_interval_s);
            except queue.Empty:
                continue;
            if first is self._stop_sentinel:
                self._drain_remaining();
                return;
            batch = [first];
            if self._queue.qsize() == 0:
                self._flush_batch(batch, fast=True);
                self._queue.task_done();
                continue;
            deadline = time.monotonic() + self._flush_interval_s;
            while len(batch) < self._batch_max:
                remaining = deadline - time.monotonic();
                if remaining <= 0:
                    break;
                try:
                    item = self._queue.get(timeout=remaining);
                except queue.Empty:
                    break;
                if item is self._stop_sentinel:
                    self._queue.put_nowait(item);
                    break;
                batch.append(item);
            self._flush_batch(batch, fast=False);
            for _ in batch:
                self._queue.task_done();

    def _drain_remaining(self) -> None:
        """Drain remaining queued chat rows.""";
        pending: list[dict[str, Any]] = [];
        while True:
            try:
                item = self._queue.get_nowait();
            except queue.Empty:
                break;
            if item is self._stop_sentinel:
                continue;
            pending.append(item);
            self._queue.task_done();
            if len(pending) >= self._batch_max:
                self._flush_batch(pending);
                pending = [];
        if pending:
            self._flush_batch(pending);

    def _flush_batch(self, items: list[dict[str, Any]], *, fast: bool = False) -> None:
        """Flush one chat batch.""";
        if not items:
            return;
        if fast:
            with self._lock:
                self._counters["fast_flush_count"] += 1;
        by_game: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list);
        persist_rows: list[dict[str, Any]] = [];
        row_items: list[tuple[str, str, dict[str, Any]]] = [];
        for item in items:
            game_id = str(item.get("game_id") or "");
            game_type = str(item.get("game_type") or "");
            row = item.get("row");
            if not game_id or not isinstance(row, dict):
                continue;
            row_copy = dict(row);
            row_items.append((game_id, game_type, row_copy));
            by_game[(game_id, game_type)].append(row_copy);
            persist = item.get("persist");
            if isinstance(persist, dict):
                persist_rows.append(dict(persist));

        persisted_by_key: dict[tuple[str, str, str], dict[str, Any]] = {};
        if persist_rows:
            last_exc: Exception | None = None;
            for attempt in range(2):
                try:
                    inserted = self._persist_batch(persist_rows) or [];
                    for saved in inserted:
                        if not isinstance(saved, dict):
                            continue;
                        key = (
                            str(saved.get("game_id") or ""),
                            str(saved.get("user_id") or ""),
                            str(saved.get("body") or ""),
                        );
                        if key[0] and key[2]:
                            persisted_by_key[key] = saved;
                    with self._lock:
                        self._counters["rows_persisted"] += len(persist_rows);
                        self._counters["batch_count"] += 1;
                    break;
                except Exception as exc:
                    last_exc = exc;
            else:
                with self._lock:
                    self._counters["persist_fail_count"] += 1;
                sys.stderr.write(
                    f"[{self._log_tag}] persist batch failed ({len(persist_rows)} rows): {last_exc!r}\n",
                );
                return;

        for game_id, _game_type, row in row_items:
            key = (
                game_id,
                str(row.get("user_id") or ""),
                str(row.get("body") or ""),
            );
            saved = persisted_by_key.get(key);
            if saved:
                row["id"] = saved.get("id", row.get("id"));
                if saved.get("created_at"):
                    row["created_at"] = saved.get("created_at");

        for (game_id, game_type), rows in by_game.items():
            try:
                self._broadcast_batch(game_id, game_type, rows);
                with self._lock:
                    self._counters["rows_broadcast"] += len(rows);
            except Exception as exc:
                sys.stderr.write(f"[{self._log_tag}] broadcast batch failed: {exc!r}\n");

__all__ = [
    "ChatOutboundQueue",
    "DEFAULT_MAX_QUEUE",
    "DEFAULT_BATCH_MAX",
    "DEFAULT_FLUSH_INTERVAL_S",
];
