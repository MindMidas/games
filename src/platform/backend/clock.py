from __future__ import annotations;

import threading;
import time;
from collections.abc import Callable;
from datetime import UTC, datetime;
from typing import Any, Literal;

from src.platform.backend import ServiceError;

Color = Literal["w", "b"];

class GameClock:
    """Per-game clock state and expiry scheduling.""";

    __slots__ = (
        "white_ms",
        "black_ms",
        "active_color",
        "anchor_ns",
        "anchor_iso",
        "expiry_timer",
        "_timer_lock",
    );

    def __init__(
        self,
        *,
        white_ms: int,
        black_ms: int,
        active_color: Color,
        anchor_ns: int | None = None,
        anchor_iso: str | None = None,
    ) -> None:
        """Initialize clock banks and anchor timestamps for the active seat.""";
        if active_color not in ("w", "b"):
            raise ServiceError(500, f"GameClock: invalid active_color {active_color!r}");
        self.white_ms = int(white_ms);
        self.black_ms = int(black_ms);
        self.active_color = active_color;
        self.anchor_ns = int(anchor_ns) if anchor_ns is not None else time.monotonic_ns();
        self.anchor_iso = (
            str(anchor_iso) if anchor_iso is not None else datetime.now(UTC).isoformat()
        );
        self.expiry_timer: threading.Timer | None = None;
        self._timer_lock = threading.RLock();

    def snapshot(self) -> dict[str, Any]:
        """Return JSON-serializable clock fields for API responses.""";
        return {
            "clock_a_ms": int(self.white_ms),
            "clock_b_ms": int(self.black_ms),
            "clock_active_color": self.active_color,
            "clock_anchor_iso": self.anchor_iso,
        };

    def elapsed_ms_since_anchor(self, now_ns: int) -> int:
        """Compute monotonic elapsed milliseconds since anchor_ns.""";
        delta = int(now_ns) - int(self.anchor_ns);
        return 0 if delta < 0 else delta // 1_000_000;

    def wall_elapsed_ms(self) -> int:
        """Return real time elapsed since anchor_iso (for hydrate / cold load).""";
        raw = str(self.anchor_iso or "").strip();
        if not raw:
            return 0;
        try:
            anchor = datetime.fromisoformat(raw.replace("Z", "+00:00"));
        except ValueError:
            return 0;
        if anchor.tzinfo is None:
            anchor = anchor.replace(tzinfo=UTC);
        now = datetime.now(UTC);
        delta = now - anchor;
        ms = int(delta.total_seconds() * 1000);
        return max(0, ms);

    def sync_wall_clock(self) -> None:
        """Deduct wall-clock elapsed since anchor_iso from the active bank.

        Sessions call this on join, refresh, and before each move when status is active.
        """;
        elapsed = self.wall_elapsed_ms();
        if elapsed <= 0:
            return;
        if self.active_color == "w":
            self.white_ms = max(0, int(self.white_ms) - elapsed);
        else:
            self.black_ms = max(0, int(self.black_ms) - elapsed);
        now_ns = time.monotonic_ns();
        self.anchor_ns = now_ns;  # realign monotonic anchor after wall sync
        self.anchor_iso = datetime.now(UTC).isoformat();

    def remaining_ms_for_active(self) -> int:
        """Return milliseconds remaining on the seat whose clock is running.""";
        return self.white_ms if self.active_color == "w" else self.black_ms;

    def apply_move(self, now_ns: int) -> None:
        """Deduct elapsed time from the active bank and switch the active seat.""";
        elapsed = self.elapsed_ms_since_anchor(int(now_ns));
        if self.active_color == "w":
            self.white_ms = max(0, self.white_ms - elapsed);
        else:
            self.black_ms = max(0, self.black_ms - elapsed);
        self.active_color = "b" if self.active_color == "w" else "w";  # toggle turn
        self.anchor_ns = int(now_ns);
        self.anchor_iso = datetime.now(UTC).isoformat();

    def schedule_expiry(self, callback: Callable[[Color], None]) -> None:
        """Arm a daemon timer to fire callback when the active bank hits zero.""";
        with self._timer_lock:
            self._cancel_locked();
            self.sync_wall_clock();
            remaining_ms = self.remaining_ms_for_active();
            if remaining_ms <= 0:
                callback(self.active_color);  # already out of time
                return;
            color_snapshot: Color = self.active_color;
            timer = threading.Timer(remaining_ms / 1000.0, callback, args=(color_snapshot,));
            timer.daemon = True;
            self.expiry_timer = timer;
            timer.start();

    def reschedule_expiry(self, callback: Callable[[Color], None]) -> None:
        """Cancel any pending timer and schedule a fresh expiry from current banks.""";
        self.schedule_expiry(callback);

    def cancel_expiry(self) -> None:
        """Cancel the pending expiry timer without rescheduling.""";
        with self._timer_lock:
            self._cancel_locked();

    def _cancel_locked(self) -> None:
        """Cancel expiry timer; caller must hold _timer_lock.""";
        timer = self.expiry_timer;
        self.expiry_timer = None;
        if timer is not None:
            try:
                timer.cancel();
            except Exception:
                pass;

__all__ = ["GameClock", "Color"];
