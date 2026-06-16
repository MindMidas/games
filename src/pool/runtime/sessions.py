from __future__ import annotations;

import copy;
import threading;
import time;
from collections.abc import Callable;
from typing import Any, cast;

from src.platform.backend.runtime import (
    PersistQueue,
    SessionRegistry,
    attach_clock_and_realtime,
    is_terminal_game_state,
);
from src.platform.backend import ServiceError;
from src.platform.backend.game_persist import AppGameRow;
from src.platform.backend.contracts import STATUS_DRAW;
from src.platform.backend.contracts import ChatRow, GameType, JsonObject, MatchRow, RuntimeDatabase;

from src.pool.runtime import Physics;
from src.pool.runtime.contracts import (
    AimMetadata,
    Color,
    Mode,
    MODE_PASS_AND_PLAY,
    MODE_PVP,
    PoolEvent,
    PoolGameOverResponse,
    PoolPersistPayload,
    PoolState,
    PoolTable,
    ShotAccepted,
    STATUS_ACTIVE,
    STATUS_FINISHED,
    SubscribePayload,
    Trajectory,
);
from src.pool.runtime.game import (
    can_fire_shot_table as _can_fire_shot_table,
    can_place_cue_table as _can_place_cue_table,
    seat_flags as _seat_flags,
    game_to_table_snapshot,
    normalize_shot_velocity,
    PoolGame,
    seat_for_user,
);
from src.pool.runtime.repository import color_for_player_id as _color_for_player_id;

class PoolGameSession:
    """Authoritative in-memory pool game with SSE via RealtimeLog.""";

    def __init__(
        self,
        *,
        game_id: str,
        initial_state: PoolState,
        physics: Physics.Game,
        app_row: AppGameRow,
        persist: PersistQueue,
    ) -> None:
        """Initialize an in-memory pool session with physics, clocks, and persist queue.""";
        self.game_id = str(game_id);
        self.state: PoolState = copy.deepcopy(initial_state);
        self.physics = physics;
        self.game = PoolGame(physics);
        self._app_row = dict(app_row);
        self.persist = persist;
        self._lock = threading.RLock();
        self.last_activity_ns = time.monotonic_ns();
        self.terminal_since_ns: int | None = None;

        self.clock, self.realtime = attach_clock_and_realtime(self.state);
        self._stamp_terminal_eviction();

        if self.state.get("status") == STATUS_ACTIVE:
            if not self.ensure_clock_resolved():
                self.clock.schedule_expiry(self._handle_clock_expiry);

    def state_snapshot(self) -> PoolState:
        """Return a deep copy of the current session state.""";
        with self._lock:
            self.last_activity_ns = time.monotonic_ns();
            return copy.deepcopy(self.state);

    def _stamp_terminal_eviction(self) -> None:
        """Mark the session ready for terminal eviction.""";
        if self.terminal_since_ns is None and is_terminal_game_state(self.state):
            self.terminal_since_ns = time.monotonic_ns();

    def subscribe(
        self,
        since_seq: int,
        *,
        timeout_seconds: float,
    ) -> tuple[list[dict[str, Any]], int]:
        """Subscribe to realtime updates.""";
        self.ensure_clock_resolved();
        self.last_activity_ns = time.monotonic_ns();
        return self.realtime.wait_for_updates(int(since_seq), timeout_seconds=float(timeout_seconds));

    def publish_chat_message(self, chat_row: dict[str, Any]) -> int:
        """Publish chat message.""";
        seqs = self.publish_chat_messages([chat_row]);
        return int(seqs[0]) if seqs else -1;

    def publish_chat_messages(self, chat_rows: list[dict[str, Any]]) -> list[int]:
        """Publish chat messages.""";
        if not chat_rows:
            return [];
        with self._lock:
            self.last_activity_ns = time.monotonic_ns();
            events = [
                {
                    "type": "chat_message",
                    "game_id": self.game_id,
                    "message": dict(row),
                }
                for row in chat_rows
                if isinstance(row, dict)
            ];
            return [int(s) for s in self.realtime.append_many(events)];

    def _broadcast_state_payload(self) -> PoolState:
        """Seat-neutral state for SSE (clients derive you_seat / can_* locally).""";
        with self._lock:
            mode = str(self.state.get("mode") or MODE_PASS_AND_PLAY);
            table = dict(self.state.get("table") or {});
            return {
                "ok": True,
                "game_id": self.game_id,
                "mode": mode,
                "status": self.state.get("status") or table.get("status"),
                "table": table,
                "stream_seq": int(self.state.get("stream_seq", 0)),
                **self.clock.snapshot(),
            };

    def load_state_for(self, user_id: str) -> PoolState:
        """Load state for one game.""";
        with self._lock:
            self.ensure_clock_resolved();
            payload = self._broadcast_state_payload();
            mode = str(payload.get("mode") or MODE_PASS_AND_PLAY);
            table = dict(payload.get("table") or {});
            seat = seat_for_user(
                user_id=user_id,
                player_a_id=str(self._app_row.get("player_a_id") or ""),
                player_b_id=str(self._app_row.get("player_b_id") or ""),
            );
            payload["you_seat"] = seat;
            payload.update(_seat_flags(table, user_id, self._app_row, mode));
            return payload;

    def submit_shot(
        self,
        user_id: str,
        *,
        x_vel: float,
        y_vel: float,
        cue_x: float | None = None,
        cue_y: float | None = None,
        aim: AimMetadata | None = None,
    ) -> ShotAccepted:
        """Submit one Pool shot.""";
        with self._lock:
            if not self._is_session_active():
                raise ServiceError(409, "Game is not active");
            self.ensure_clock_resolved();
            if not self._is_session_active():
                raise ServiceError(409, "Game is not active");
            mode = str(self.state.get("mode") or MODE_PASS_AND_PLAY);
            tbl = self.physics._cached_table;
            if tbl is None:
                tbl = self.game.table(self.state.get("table"));
            table_before = game_to_table_snapshot(
                self.physics,
                svg=tbl.svg(),
                mode=mode,
                table=tbl,
            );
            if not _can_fire_shot_table(table_before, user_id, self._app_row, mode):
                raise ServiceError(403, "Not your turn");

            x_vel, y_vel = normalize_shot_velocity(x_vel, y_vel);

            if table_before.get("ball_in_hand"):
                if cue_x is None or cue_y is None:
                    raise ServiceError(
                        400,
                        "Cue ball position is required before shooting on ball in hand",
                    );
                try:
                    tbl = self.game.place_cue(tbl, float(cue_x), float(cue_y));
                except (TypeError, ValueError) as exc:
                    raise ServiceError(400, str(exc)) from exc;

            prev_player_id = table_before.get("current_player_id");
            last_snap = dict(self.state.get("table") or table_before);
            trajectory, end_table = self.game.shoot(
                last_snap,
                x_vel,
                y_vel,
            );
            svg = end_table.svg();
            table = game_to_table_snapshot(
                self.physics,
                svg=svg,
                mode=mode,
                table=end_table,
            );
            self.physics._board_ply = int(getattr(self.physics, "_board_ply", -1)) + 1;

            now_ns = time.monotonic_ns();
            if str(table.get("current_player_id") or "") != str(prev_player_id or ""):
                self._tick_clock(now_ns);

            return self._commit_table(
                user_id,
                table=table,
                trajectory=trajectory,
                label="Shot",
                played_by_id=prev_player_id,
                next_player_id=table.get("current_player_id"),
                x_vel=float(x_vel),
                y_vel=float(y_vel),
                aim=aim,
            );

    def place_cue(
        self,
        user_id: str,
        *,
        x: float,
        y: float,
        validate_only: bool = False,
    ) -> ShotAccepted:
        """Place the cue ball.""";
        with self._lock:
            if not self._is_session_active():
                raise ServiceError(409, "Game is not active");
            self.ensure_clock_resolved();
            if not self._is_session_active():
                raise ServiceError(409, "Game is not active");
            mode = str(self.state.get("mode") or MODE_PASS_AND_PLAY);
            tbl = self.physics._cached_table;
            if tbl is None:
                tbl = self.game.table(self.state.get("table"));
            table_before = game_to_table_snapshot(
                self.physics,
                svg=tbl.svg(),
                mode=mode,
                table=tbl,
            );
            if not _can_place_cue_table(table_before, user_id, self._app_row, mode):
                raise ServiceError(403, "You cannot place the cue right now");
            try:
                end_table = self.game.place_cue(tbl, float(x), float(y));
            except (TypeError, ValueError) as exc:
                raise ServiceError(400, str(exc)) from exc;
            if validate_only:
                return {"ok": True, "valid": True};
            svg = end_table.svg();
            table = game_to_table_snapshot(
                self.physics,
                svg=svg,
                mode=mode,
                table=end_table,
            );
            self.physics._board_ply = int(getattr(self.physics, "_board_ply", -1)) + 1;
            return self._commit_table(
                user_id,
                table=table,
                trajectory=None,
                label="PlaceCue",
                played_by_id=table.get("ball_in_hand_for_player_id"),
                next_player_id=table.get("current_player_id"),
            );

    def surrender(self, user_id: str, *, cause: str | None = None) -> ShotAccepted:
        """Apply surrender.""";
        with self._lock:
            if not self._is_session_active():
                raise ServiceError(409, "Game is not active");
            self.ensure_clock_resolved();
            if not self._is_session_active():
                raise ServiceError(409, "Game is not active");
            mode = str(self.state.get("mode") or MODE_PASS_AND_PLAY);
            seat = seat_for_user(
                user_id=user_id,
                player_a_id=str(self._app_row.get("player_a_id") or ""),
                player_b_id=str(self._app_row.get("player_b_id") or ""),
            );
            if seat is None:
                raise ServiceError(403, "Not a player in this game");
            cause_key = str(cause or "").strip().lower();
            if cause_key == "inactivity":
                terminal_reason = "inactivity_forfeit";
            elif mode == MODE_PASS_AND_PLAY:
                terminal_reason = "local_end";
            else:
                terminal_reason = "surrender";
            if mode == MODE_PASS_AND_PLAY:
                tbl = self.physics._cached_table;
                if tbl is None:
                    tbl = self.game.table(self.state.get("table"));
                self.game.finish_without_winner();
                table = game_to_table_snapshot(self.physics, svg=tbl.svg(), mode=mode, table=tbl);
                table["game_over"] = True;
                table["status"] = STATUS_FINISHED;
                table["winner"] = None;
                table["winner_message"] = terminal_reason;
                self.state["result"] = {
                    "status": STATUS_FINISHED,
                    "winner": table.get("winner"),
                    "reason": terminal_reason,
                };
                self.physics._board_ply = int(getattr(self.physics, "_board_ply", -1)) + 1;
                self.clock.cancel_expiry();
                payload = self._commit_table(user_id, table=table, trajectory=None, label="Abandon");
                return payload;
            opponent_id = (
                self.physics.player2_id if seat == "player1" else self.physics.player1_id
            );
            self.game.surrender(opponent_id, terminal_reason);
            tbl = self.physics._cached_table;
            if tbl is None:
                tbl = self.game.table(self.state.get("table"));
            table = game_to_table_snapshot(self.physics, svg=tbl.svg(), mode=mode, table=tbl);
            table["game_over"] = True;
            table["status"] = STATUS_FINISHED;
            table["winner_message"] = terminal_reason;
            self.state["result"] = {
                "status": STATUS_FINISHED,
                "winner": table.get("winner"),
                "reason": terminal_reason,
            };
            self.physics._board_ply = int(getattr(self.physics, "_board_ply", -1)) + 1;
            self.clock.cancel_expiry();
            payload = self._commit_table(user_id, table=table, trajectory=None, label="Surrender");
            return payload;

    def agree_draw(self, user_id: str) -> ShotAccepted:
        """Apply an agreed draw.""";
        with self._lock:
            if not self._is_session_active():
                raise ServiceError(409, "Game is not active");
            self.ensure_clock_resolved();
            if not self._is_session_active():
                raise ServiceError(409, "Game is not active");
            if str(self.state.get("mode") or "") != MODE_PVP:
                raise ServiceError(400, "Draw offers are only available in PvP games.");
            if seat_for_user(
                user_id=user_id,
                player_a_id=str(self._app_row.get("player_a_id") or ""),
                player_b_id=str(self._app_row.get("player_b_id") or ""),
            ) is None:
                raise ServiceError(403, "Not a player in this game");
            mode = MODE_PVP;
            tbl = self.physics._cached_table;
            if tbl is None:
                tbl = self.game.table(self.state.get("table"));
            self.game.finish_without_winner();
            table = game_to_table_snapshot(self.physics, svg=tbl.svg(), mode=mode, table=tbl);
            table["game_over"] = True;
            table["status"] = STATUS_DRAW;
            table["winner"] = None;
            table["winner_message"] = "draw_agreed";
            self.state["result"] = {
                "status": STATUS_DRAW,
                "winner": None,
                "reason": "draw_agreed",
            };
            self.physics._board_ply = int(getattr(self.physics, "_board_ply", -1)) + 1;
            self.clock.cancel_expiry();
            payload = self._commit_table(user_id, table=table, trajectory=None, label="DrawAgreed");
            return payload;

    def _tick_clock(self, now_ns: int) -> None:
        """Tick clock.""";
        self.clock.apply_move(now_ns);
        self.state.update(self.clock.snapshot());

    def _is_session_active(self) -> bool:
        """Return whether the session is still active.""";
        return str(self.state.get("status") or "") == STATUS_ACTIVE;

    def ensure_clock_resolved(self) -> bool:
        """Join, refresh, moves: if time ran out, end game and broadcast ``game_over``. Returns True if ended.""";
        with self._lock:
            return self._maybe_time_forfeit();

    def _maybe_time_forfeit(self) -> bool:
        """True when the game was ended because the active clock hit zero.""";
        if not self._is_session_active():
            return False;
        self.clock.sync_wall_clock();
        self.state.update(self.clock.snapshot());
        if self.clock.remaining_ms_for_active() > 0:
            return False;
        loser: Color = self.clock.active_color;
        self._handle_clock_expiry(loser);
        self._app_row["status"] = STATUS_FINISHED;
        return True;

    @staticmethod
    def _trajectory_with_shot_meta(
        trajectory: Trajectory | None,
        *,
        x_vel: float | None = None,
        y_vel: float | None = None,
        aim: AimMetadata | None = None,
    ) -> Trajectory | None:
        """Attach shot metadata to a trajectory.""";
        if trajectory is None:
            return None;
        if not isinstance(trajectory, dict):
            return trajectory;
        payload = dict(trajectory);
        if x_vel is not None and y_vel is not None:
            payload["x_vel"] = float(x_vel);
            payload["y_vel"] = float(y_vel);
        if isinstance(aim, dict) and aim:
            payload["aim"] = aim;
        return payload;

    def _commit_table(
        self,
        user_id: str,
        *,
        table: PoolTable,
        trajectory: Trajectory | None,
        label: str,
        played_by_id: str | None = None,
        next_player_id: str | None = None,
        x_vel: float | None = None,
        y_vel: float | None = None,
        aim: AimMetadata | None = None,
    ) -> ShotAccepted:
        """Commit table.""";
        trajectory = self._trajectory_with_shot_meta(
            trajectory,
            x_vel=x_vel,
            y_vel=y_vel,
            aim=aim,
        );
        mode = str(self.state.get("mode") or MODE_PASS_AND_PLAY);
        self.state["table"] = table;
        if table.get("game_over"):
            status = STATUS_FINISHED;
        else:
            status = str(table.get("status") or STATUS_ACTIVE);
        self.state["status"] = status;
        if table.get("game_over") and not self.state.get("result"):
            self.state["result"] = {
                "status": status,
                "winner": table.get("winner"),
                "reason": table.get("winner_message"),
            };

        payload = self._broadcast_state_payload();
        event: PoolEvent = {
            "type": "shot_accepted",
            "game_id": self.game_id,
            "next_state": copy.deepcopy(payload),
            "trajectory": trajectory,
        };
        seq = int(self.realtime.append(event));
        event["last_shot_seq"] = seq;
        payload["stream_seq"] = seq;
        event["next_state"]["stream_seq"] = seq;
        self.state["stream_seq"] = seq;

        persist_payload: PoolPersistPayload = {
            "game_id": self.game_id,
            "table": table,
            "trajectory": trajectory,
            "label": label,
            "played_by_id": played_by_id,
            "next_player_id": next_player_id,
            "time_a_ms": int(self.state.get("clock_a_ms", 0)),
            "time_b_ms": int(self.state.get("clock_b_ms", 0)),
            "mode": mode,
            "owner_user_id": str(self._app_row.get("player_a_id") or self._app_row.get("user_id") or ""),
            "winner_player_id": self.physics.winner if table.get("game_over") else None,
        };
        if table.get("game_over"):
            self.persist.persist_now(persist_payload);
        else:
            self.persist.enqueue(persist_payload);

        if table.get("game_over"):
            self.clock.cancel_expiry();
            self._emit_game_over();
        else:
            self.clock.schedule_expiry(self._handle_clock_expiry);

        return {
            "ok": True,
            "game_id": self.game_id,
            "trajectory": trajectory,
            "table": table,
            **_seat_flags(table, user_id, self._app_row, mode),
            "stream_seq": seq,
            "clock_a_ms": payload.get("clock_a_ms"),
            "clock_b_ms": payload.get("clock_b_ms"),
            "clock_active_color": payload.get("clock_active_color"),
            "clock_anchor_iso": payload.get("clock_anchor_iso"),
        };

    def _emit_game_over(self) -> PoolEvent:
        """Emit a terminal game-over event.""";
        self._stamp_terminal_eviction();
        next_state = copy.deepcopy(self._broadcast_state_payload());
        table = next_state.get("table") or {};
        result = dict(self.state.get("result") or {});
        if not result:
            result = {
                "status": next_state.get("status"),
                "winner": table.get("winner"),
                "reason": table.get("winner_message"),
            };
        event = {
            "type": "game_over",
            "game_id": self.game_id,
            "next_state": copy.deepcopy(next_state),
            "result": dict(result),
        };
        seq = int(self.realtime.append(dict(event)));
        event["next_state"]["stream_seq"] = seq;
        self.state["stream_seq"] = seq;
        return event;

    def _handle_clock_expiry(self, color: Color) -> None:
        """Handle clock expiry.""";
        with self._lock:
            if not self._is_session_active():
                return;
            mode = str(self.state.get("mode") or MODE_PASS_AND_PLAY);
            tbl = self.physics._cached_table;
            if tbl is None:
                tbl = self.game.table(self.state.get("table"));
            table_probe = game_to_table_snapshot(
                self.physics,
                svg=tbl.svg(),
                mode=mode,
                table=tbl,
            );
            on_clock = _color_for_player_id(table_probe, table_probe.get("current_player_id"));
            if on_clock != color:
                return;
            winner_color: Color = "b" if color == "w" else "w";
            if color == "w":
                self.clock.white_ms = 0;
            else:
                self.clock.black_ms = 0;
            self.state.update(self.clock.snapshot());
            winner_id = (
                self.physics.player1_id if winner_color == "w" else self.physics.player2_id
            );
            self.game.surrender(winner_id, "Time forfeit");
            table = game_to_table_snapshot(self.physics, svg=tbl.svg(), mode=mode, table=tbl);
            table["game_over"] = True;
            table["status"] = STATUS_FINISHED;
            table["winner_message"] = "time_forfeit";
            self.state["table"] = table;
            self.state["status"] = STATUS_FINISHED;
            self.state["result"] = {
                "status": STATUS_FINISHED,
                "winner": table.get("winner"),
                "reason": "time_forfeit",
            };
            self.clock.cancel_expiry();
            self._enqueue_terminal_persist(table, label="TimeForfeit");
            self._emit_game_over();

    def _enqueue_terminal_persist(self, table: PoolTable, *, label: str) -> None:
        """Queue enqueue terminal persist.""";
        payload = {
            "game_id": self.game_id,
            "table": table,
            "trajectory": None,
            "label": label,
            "time_a_ms": int(self.state.get("clock_a_ms", 0)),
            "time_b_ms": int(self.state.get("clock_b_ms", 0)),
            "mode": str(self.state.get("mode") or MODE_PASS_AND_PLAY),
            "owner_user_id": str(self._app_row.get("player_a_id") or self._app_row.get("user_id") or ""),
            "winner_player_id": self.physics.winner,
        };
        self.persist.persist_now(payload);

class PoolSessions:
    """Runtime-owned Pool coordinator for sessions, hydration, and persistence.""";

    def __init__(self, *, database: Any) -> None:

        from .repository import make_persist_callable;

        self.database = database;
        self.persist = PersistQueue(
            persist_callable=make_persist_callable(database),
            log_tag="pool.persist",
            thread_name_prefix="pool-gameplay-persist",
        );
        self.persist.start();
        self.registry: SessionRegistry[PoolGameSession] = SessionRegistry(env_var="GAMES_SESSION_IDLE_SECONDS");
        self.registry.start_sweeper(thread_name="pool-gameplay-registry-sweep");

    def metrics(self) -> dict[str, Any]:
        """Return registry and persistence metrics for ops endpoints.""";
        return {"sessions": self.registry.size(), "persist_queue": self.persist.metrics()};

    def wrap(self, state: PoolState, physics: Physics.Game, row: AppGameRow) -> PoolGameSession:
        """Construct one session from hydrated state.""";
        return PoolGameSession(
            game_id=str(state.get("game_id") or ""),
            initial_state=state,
            physics=physics,
            app_row=row,
            persist=self.persist,
        );

    def get_session(self, user_id: str, game_id: str) -> PoolGameSession:
        """Return a warm session or hydrate one repository snapshot.""";
        from .repository import load_game;

        def hydrate(hydrated_game_id: str) -> PoolGameSession:
            """Hydrate one Pool game session.""";
            state, physics, row = load_game(self.database, user_id, hydrated_game_id);
            return self.wrap(state, physics, row);

        return self.registry.get_or_hydrate(game_id, hydrate);

    def register_warm(self, state: PoolState, physics: Physics.Game, row: AppGameRow) -> None:
        """Register a newly-created game without a redundant DB reload.""";
        self.registry.register(self.wrap(state, physics, row));

    def register_warm_session(self, user_id: str, game_id: str, *, physics: Physics.Game, row: AppGameRow, mode: Mode, ply: int) -> None:
        """Register a newly bootstrapped game without a redundant DB reload.""";
        from .repository import build_pool_state;
        self.register_warm(build_pool_state(self.database, user_id, game_id, physics=physics, row=row, mode=mode, ply=ply), physics, row);

    def load_state(self, user_id: str, *, game_id: str) -> PoolState:
        """Return seat-personalized state for one authenticated player.""";
        return self.get_session(user_id, game_id).load_state_for(user_id);

    def submit_shot(self, user_id: str, *, game_id: str, x_vel: float, y_vel: float, cue_x: float | None = None, cue_y: float | None = None, aim: AimMetadata | None = None) -> ShotAccepted:
        """Submit one authenticated shot.""";
        return self.get_session(user_id, game_id).submit_shot(user_id, x_vel=x_vel, y_vel=y_vel, cue_x=cue_x, cue_y=cue_y, aim=aim);

    def place_cue(self, user_id: str, *, game_id: str, x: float, y: float, validate_only: bool = False) -> ShotAccepted:
        """Validate or persist one authenticated cue-ball placement.""";
        return self.get_session(user_id, game_id).place_cue(user_id, x=x, y=y, validate_only=validate_only);

    def surrender(self, user_id: str, *, game_id: str, cause: str | None = None) -> PoolGameOverResponse:
        """End a game by surrender and return the terminal state.""";
        session = self.get_session(user_id, game_id);
        session.surrender(user_id, cause=cause);
        state = session.load_state_for(user_id);
        return {"ok": True, "type": "game_over", "game_over": state, "game_id": game_id, **state};

    def agree_draw(self, user_id: str, *, game_id: str) -> PoolGameOverResponse:
        """End an active PvP game after both players accept a draw.""";
        session = self.get_session(user_id, game_id);
        session.agree_draw(user_id);
        state = session.load_state_for(user_id);
        return {"ok": True, "type": "game_over", "game_over": state, "game_id": game_id, **state};

    def broadcast_chat(self, user_id: str, game_id: str, chat_rows: list[dict[str, Any]]) -> None:
        """Publish already-persisted chat rows to subscribers.""";
        resolved_user_id = str(user_id or "").strip() or str((chat_rows[0] if chat_rows else {}).get("user_id") or "").strip();
        if resolved_user_id and chat_rows:
            self.get_session(resolved_user_id, str(game_id)).publish_chat_messages([dict(row) for row in chat_rows if isinstance(row, dict)]);

    def evict(self, game_id: str) -> None:
        """Remove one game from the in-memory registry.""";
        self.registry.remove(str(game_id));

    def subscribe(self, user_id: str, *, game_id: str, since_seq: int, wait_seconds: float) -> SubscribePayload:
        """Return ordered SSE events after the supplied stream cursor.""";
        events, last_seq = self.get_session(user_id, game_id).subscribe(int(since_seq), timeout_seconds=float(wait_seconds));
        return {"game_id": str(game_id), "events": events, "last_seq": last_seq};

    def stop(self) -> None:
        """Stop workers for isolated tests or process shutdown.""";
        self.persist.stop(graceful_timeout=1.0);
        self.registry.stop_sweeper(graceful_timeout=1.0);

class PoolRuntime:
    """Platform adapter for Pool-owned bootstrap, repository, and sessions.""";

    game_type: GameType = "pool";
    modes = frozenset({"pnp", "pvp"});

    def __init__(
        self,
        database: RuntimeDatabase,
        *,
        unfinished_pvp_game: Callable[[str, str], str | None],
        unfinished_offline_game: Callable[[str, str, str], str | None],
    ) -> None:

        self.database = database;
        self.unfinished_pvp_game = unfinished_pvp_game;
        self.unfinished_offline_game = unfinished_offline_game;
        self.sessions = PoolSessions(database=database);

    def create_offline(self, user_id: str, body: JsonObject) -> str:
        """Create offline.""";
        from .bootstrap import bootstrap_offline;
        return bootstrap_offline(self.database, user_id, body, register_warm=self.sessions.register_warm_session);

    def active_game(self, user_id: str) -> str:
        """Resolve the player's current active Pool game through its repository.""";
        from .repository import active_game_id;
        return active_game_id(self.database, user_id);

    def active_incomplete_game(self, user_id: str) -> tuple[str | None, str | None]:
        """Prefer an active PvP game, then the player's resumable local game.""";
        game_id = self.unfinished_pvp_game(user_id, self.game_type);
        if game_id:
            return game_id, "pvp";
        game_id = self.unfinished_offline_game(user_id, self.game_type, "pnp");
        return (game_id, "pnp") if game_id else (None, None);

    def activate_pvp(self, user_id: str, match_id: str, player_a_id: str, player_b_id: str, match: MatchRow) -> None:
        """Activate pvp.""";
        from .bootstrap import insert_pvp_app_game;
        insert_pvp_app_game(self.database, user_id, match_id=match_id, player_a_id=player_a_id, player_b_id=player_b_id, match=dict(match), register_warm=self.sessions.register_warm_session);

    def create_rematch(self, player_a_id: str, player_b_id: str) -> str:
        """Create rematch.""";
        from .bootstrap import materialize_rematch;
        return materialize_rematch(self.database, player_a_id, player_b_id, register_warm=self.sessions.register_warm_session);

    def load_state(self, user_id: str, game_id: str) -> JsonObject:
        """Load state.""";
        return cast(JsonObject, self.sessions.load_state(user_id, game_id=game_id));

    def replay(self, user_id: str, game_id: str | None, include_events: bool) -> JsonObject:

        from .repository import build_replay;
        return cast(JsonObject, build_replay(self.database, user_id, game_id=game_id, include_events=include_events, state_loader=lambda replay_user_id, replay_game_id: self.sessions.load_state(replay_user_id, game_id=replay_game_id)));

    def surrender(self, user_id: str, game_id: str, cause: str | None = None) -> JsonObject:
        """Apply surrender.""";
        from .repository import _latest_board, _load_row, close_without_snapshot, ensure_finished_row;

        row = _load_row(self.database, user_id, game_id);
        snapshot, _ply = _latest_board(self.database, game_id);
        if snapshot is None:
            close_without_snapshot(self.database, game_id, row);
            self.sessions.evict(game_id);
            return {"ok": True, "type": "game_over", "game_id": game_id, "status": "finished"};
        payload = self.sessions.surrender(user_id, game_id=game_id, cause=cause);
        table = cast(PoolTable, payload.get("table") if isinstance(payload.get("table"), dict) else {});
        ensure_finished_row(
            self.database,
            game_id,
            table=table,
            mode=str(row.get("mode") or ""),
            owner_user_id=str(row.get("player_a_id") or row.get("user_id") or ""),
        );
        self.sessions.evict(game_id);
        return cast(JsonObject, payload);

    def agree_draw(self, user_id: str, game_id: str) -> JsonObject:
        """Apply an agreed draw.""";
        return cast(JsonObject, self.sessions.agree_draw(user_id, game_id=game_id));

    def subscribe(self, user_id: str, game_id: str, since_seq: int, wait_seconds: float) -> SubscribePayload:
        """Subscribe to realtime updates.""";
        return self.sessions.subscribe(user_id, game_id=game_id, since_seq=since_seq, wait_seconds=wait_seconds);

    def broadcast_chat(self, user_id: str, game_id: str, rows: list[ChatRow]) -> None:
        """Broadcast chat.""";
        self.sessions.broadcast_chat(user_id, game_id, [dict(row) for row in rows]);

    def reconcile_expired(self, user_id: str, game_id: str) -> bool:
        """Reconcile expired clocks.""";
        return str(self.load_state(user_id, game_id).get("status") or "") != "active";

    def reuse_offline(self, game_id: str) -> None:
        """Reuse an offline game session.""";
        from .bootstrap import on_reuse_offline_game;
        on_reuse_offline_game(self.database, game_id);

    def metrics(self) -> dict[str, Any]:
        """Return metrics.""";
        return self.sessions.metrics();

    def stop(self) -> None:
        """Stop owned queue and registry workers.""";
        self.sessions.stop();

    def submit_shot(self, user_id: str, *, game_id: str, x_vel: float, y_vel: float, cue_x: float | None = None, cue_y: float | None = None, aim: JsonObject | None = None) -> JsonObject:
        """Submit one Pool shot.""";
        return cast(JsonObject, self.sessions.submit_shot(user_id, game_id=game_id, x_vel=x_vel, y_vel=y_vel, cue_x=cue_x, cue_y=cue_y, aim=cast(AimMetadata | None, aim)));

    def place_cue(self, user_id: str, *, game_id: str, x: float, y: float, validate_only: bool = False) -> JsonObject:
        """Place the cue ball.""";
        return cast(JsonObject, self.sessions.place_cue(user_id, game_id=game_id, x=x, y=y, validate_only=validate_only));

__all__ = ["PoolGameSession", "PoolSessions", "PoolRuntime"];
