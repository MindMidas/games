from __future__ import annotations;

import copy;
import threading;
import time;
from collections import OrderedDict;
from collections.abc import Callable;
from pathlib import Path;
from typing import Any, cast;

import logging;

from src.chezz.runtime.contracts import ENGINE_USER_ID, MAX_CLIENT_MOVE_ID_LENGTH, STATUS_DRAW;
from src.chezz.runtime.game import player_color_for;
from src.platform.backend import ServiceError;
from src.platform.backend.game_persist import CommitMoveParams;
from src.platform.backend.contracts import ChatRow, GameType, JsonObject, MatchRow, RuntimeDatabase;

from .engine import ChezzEngine;
from .game import ChezzGame;

from src.platform.backend.runtime import (
    PersistQueue,
    SessionRegistry,
    attach_clock_and_realtime,
    is_terminal_game_state,
);
from .contracts import (
    AnimationEvent,
    Color,
    GameOver,
    GameState,
    EngineBoard,
    LegalAfterPayload,
    MoveAccepted,
    MoveRequest,
    MoveSummary,
    Players,
    SseEvent,
    SubscribePayload,
);

MAX_PROCESSED_CLIENT_MOVE_IDS = 256;
STATUS_ACTIVE = "active";
STATUS_FINISHED = "finished";

TerminalCallback = Callable[[str, GameOver], None];
_log = logging.getLogger(__name__);

class ChezzSession:
    """Single writer for GameState under self._lock; SSE via realtime append.""";

    def __init__(
        self,
        *,
        game_id: str,
        initial_state: GameState,
        engine: ChezzEngine,
        persist: PersistQueue,
        on_terminal: TerminalCallback | None = None,
    ) -> None:
        """Initialize session state and realtime attachments.""";
        self.game_id = str(game_id);
        self.game = ChezzGame(initial_state, engine);
        self.clock, self.realtime = attach_clock_and_realtime(self.state);
        self.clock.active_color = _color(self.state.get("clock_active_color"));
        self.persist = persist;
        self._lock = threading.RLock();
        self._processed_client_move_ids: OrderedDict[str, MoveAccepted] = OrderedDict();
        self._terminal_callback = on_terminal;
        self.last_activity_ns = time.monotonic_ns();
        self.terminal_since_ns: int | None = None;
        self._stamp_terminal_eviction();
        if int(self.state.get("stream_seq", 0)) < 0:
            self.state["stream_seq"] = 0;
        if self.state.get("status") == STATUS_ACTIVE:
            forfeit = self._maybe_time_forfeit(time.monotonic_ns());
            if forfeit is None:
                self.clock.schedule_expiry(self._handle_clock_expiry);

    def state_snapshot(self) -> GameState:
        """Deep-copy GameState for readers (updates last_activity_ns).""";
        with self._lock:
            self.last_activity_ns = time.monotonic_ns();
            return copy.deepcopy(self.state);

    @property
    def state(self) -> GameState:
        """Expose the mutable state owned by the embedded `ChezzGame`.""";
        return self.game.state;

    @state.setter
    def state(self, value: GameState) -> None:
        """Replace the mutable state owned by the embedded `ChezzGame`.""";
        self.game.state = value;

    def _stamp_terminal_eviction(self) -> None:
        """Mark the session ready for terminal eviction.""";
        if self.terminal_since_ns is None and is_terminal_game_state(self.state):
            self.terminal_since_ns = time.monotonic_ns();

    def ensure_clock_resolved(self) -> None:
        """If PvP clocks ran out: pick winner, finish game, persist, emit ``game_over`` for SSE.""";
        with self._lock:
            if self.state.get("status") != STATUS_ACTIVE:
                return;
            self._maybe_time_forfeit(time.monotonic_ns());

    def ensure_time_forfeit_if_due(self) -> None:
        """Alias for :meth:`ensure_clock_resolved` (join / refresh / lobby).""";
        self.ensure_clock_resolved();

    def update_players(self, players: Players) -> None:
        """Replace players map after a profile refresh from app_users.""";
        with self._lock:
            self.state["players"] = copy.deepcopy(players);

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

    def apply_player_move(
        self,
        *,
        user_id: str,
        move_request: MoveRequest,
    ) -> SseEvent:
        """Validate seq/turn, apply engine move package, commit and broadcast.""";
        with self._lock:
            self.last_activity_ns = time.monotonic_ns();
            client_move_id = str(move_request.get("client_move_id") or "");
            if not client_move_id:
                raise ServiceError(400, "client_move_id is required");
            if len(client_move_id) > MAX_CLIENT_MOVE_ID_LENGTH:
                raise ServiceError(400, "client_move_id is too long");
            cached = self._lookup_cached(client_move_id);
            if cached is not None:
                return cached;

            self._assert_seq(int(move_request.get("expected_seq", -1)));
            player_color = player_color_for(self.state, user_id);
            if player_color is None or player_color != self.state.get("current_turn"):
                raise ServiceError(403, "Not your turn");
            if self.state.get("status") != STATUS_ACTIVE:
                raise ServiceError(409, "Game is not active");

            now_ns = time.monotonic_ns();
            forfeit = self._maybe_time_forfeit(now_ns);
            if forfeit is not None:
                return forfeit;

            next_board, animation_events, summary = self.game.play(move_request, player_color);
            return self._commit_move(
                next_board=next_board,
                animation_events=animation_events,
                summary=summary,
                mover_color=player_color,
                actor_user_id=user_id,
                client_move_id=client_move_id,
                now_ns=now_ns,
                action_key=str(summary.get("notation") or ""),
            );

    def apply_engine_move(self) -> SseEvent:
        """Run engine best-move path under the same commit pipeline as human moves.""";
        with self._lock:
            self.last_activity_ns = time.monotonic_ns();
            if self.state.get("status") != STATUS_ACTIVE:
                raise ServiceError(409, "Game is not active");
            mover_color = _color(self.state.get("current_turn"));
            now_ns = time.monotonic_ns();
            forfeit = self._maybe_time_forfeit(now_ns);
            if forfeit is not None:
                return forfeit;

            next_board, animation_events, summary, action_key = self.game.play_engine();
            return self._commit_move(
                next_board=next_board,
                animation_events=animation_events,
                summary=summary,
                mover_color=mover_color,
                actor_user_id=None,
                client_move_id="",
                now_ns=now_ns,
                action_key=action_key,
            );

    def force_terminal(self, *, reason: str, winner: Color | None) -> GameOver:
        """Force terminal result (admin/forfeit paths outside normal moves).""";
        with self._lock:
            self.clock.cancel_expiry();
            self.game.finish(reason=reason, winner=winner);
            event = self._emit_game_over();
            self._enqueue_persist(
                action_key=reason,
                animation_events=[{"type": 0, "action": reason}],
                summary={"notation": reason},
                mover_color=None,
            );
            self._fire_terminal_hook(event);
            return event;

    def surrender(self, color: Color, *, cause: str | None = None) -> GameOver:
        """Apply a seated player's surrender through the game state machine.""";
        with self._lock:
            self.clock.cancel_expiry();
            self.game.surrender(color, cause=cause);
            reason = str((self.state.get("result") or {}).get("reason") or "surrender");
            event = self._emit_game_over();
            self._enqueue_persist(
                action_key=reason,
                animation_events=[{"type": 0, "action": reason}],
                summary={"notation": reason},
                mover_color=None,
            );
            self._fire_terminal_hook(event);
            return event;

    def agree_draw(self) -> GameOver:
        """Mark agreed draw and mirror persistence fields like other terminals.""";
        with self._lock:
            self.clock.cancel_expiry();
            self.game.agree_draw();
            event = self._emit_game_over();
            self._enqueue_persist(
                action_key="draw_agreed",
                animation_events=[{"type": 0, "action": "draw_agreed"}],
                summary={"notation": "draw_agreed"},
                mover_color=None,
            );
            self._fire_terminal_hook(event);
            return event;

    def _handle_clock_expiry(self, color: Color) -> None:
        """Timer callback: forfeit active side if still their move when expiry fires.""";
        with self._lock:
            if self.state.get("status") != STATUS_ACTIVE:
                return;
            if self.state.get("current_turn") != color:
                return;
            winner: Color = "b" if color == "w" else "w";
            self.game.finish(reason="time_forfeit", winner=winner);
            self.clock.cancel_expiry();
            event = self._emit_game_over();
            self._enqueue_persist(
                action_key="time_forfeit",
                animation_events=[{"type": 0, "action": "time_forfeit"}],
                summary={"notation": "time_forfeit"},
                mover_color=None,
            );
            self._fire_terminal_hook(event);

    def _commit_move(
        self,
        *,
        next_board: EngineBoard,
        animation_events: list[AnimationEvent],
        summary: MoveSummary,
        mover_color: Color,
        actor_user_id: str | None,
        client_move_id: str,
        now_ns: int,
        action_key: str,
    ) -> MoveAccepted:
        """Advance clocks, merge terminal overlays, broadcast MoveAccepted, enqueue persist.""";
        self.clock.apply_move(now_ns);
        next_state = self.game.advance(
            next_board=next_board,
            animation_events=list(animation_events),
            summary=summary,
            mover_color=mover_color,
            clock_fields=self.clock.snapshot(),
        );

        seq = self.realtime.next_seq;
        next_state["stream_seq"] = seq;
        event: MoveAccepted = {
            "type": "move_accepted",
            "game_id": self.game_id,
            "next_state": copy.deepcopy(next_state),
            "move": summary,
            "animation_events": list(animation_events),
            "last_move_seq": seq,
        };

        if next_state.get("status") == STATUS_ACTIVE:
            try:
                legal: LegalAfterPayload = {
                    "cursor": str(seq),
                    "actions": self.game.engine.legal_moves(event["next_state"]["board"]),
                };
                board_snap = event["next_state"].get("board");
                if isinstance(board_snap, dict):
                    legal["premove_by_color"] = self.game.engine.premove_actions_by_color(board_snap);
                event["legal"] = legal;
                next_state["legal"] = legal;
                event["next_state"]["legal"] = copy.deepcopy(legal);
            except Exception as exc:
                _log.warning("legal build failed for game %s: %s", self.game_id, exc, exc_info=True);
                raise;

        queued: MoveAccepted = copy.deepcopy(event);
        if self.realtime.append(queued) != seq:
            raise RuntimeError("Chezz realtime sequence changed while committing move");
        self.state = next_state;

        if client_move_id:
            self._cache_accepted(client_move_id, event);
        self._enqueue_persist(
            action_key=action_key,
            animation_events=animation_events,
            summary=summary,
            mover_color=mover_color,
        );

        if next_state.get("status") == STATUS_FINISHED:
            self.clock.cancel_expiry();
            self._fire_terminal_hook(self._emit_game_over());
        else:
            self.clock.schedule_expiry(self._handle_clock_expiry);
        return event;

    def _emit_game_over(self) -> GameOver:
        """Emit game_over SSE with cloned next_state and bump stream_seq on state.""";
        self._stamp_terminal_eviction();
        seq = self.realtime.next_seq;
        self.state["stream_seq"] = seq;
        event: GameOver = {
            "type": "game_over",
            "game_id": self.game_id,
            "next_state": copy.deepcopy(self.state),
            "result": dict(self.state.get("result") or {}),
        };
        if self.realtime.append(copy.deepcopy(event)) != seq:
            raise RuntimeError("Chezz realtime sequence changed while emitting terminal event");
        return event;

    def _maybe_time_forfeit(self, now_ns: int) -> GameOver | None:
        """Inline time loss detection before applying a move commitment.""";
        self.clock.sync_wall_clock();
        self.state.update(self.clock.snapshot());
        if self.clock.remaining_ms_for_active() > 0:
            return None;
        active = self.clock.active_color;
        winner: Color = "b" if active == "w" else "w";
        if active == "w":
            self.clock.white_ms = 0;
        else:
            self.clock.black_ms = 0;
        self.game.finish(reason="time_forfeit", winner=winner);
        self.clock.cancel_expiry();
        event = self._emit_game_over();
        self._enqueue_persist(
            action_key="time_forfeit",
            animation_events=[{"type": 0, "action": "time_forfeit"}],
            summary={"notation": "time_forfeit"},
            mover_color=None,
        );
        self._fire_terminal_hook(event);
        return event;

    def _enqueue_persist(
        self,
        *,
        action_key: str,
        animation_events: list[AnimationEvent] | list[dict[str, Any]],
        summary: MoveSummary | dict[str, Any],
        mover_color: Color | None = None,
    ) -> None:
        """Append write-behind rpc_params (board-only state + events + actor FKs + per-slot score/clock).""";
        board = self.state.get("board") if isinstance(self.state.get("board"), dict) else {};
        inner = board.get("board") if isinstance(board.get("board"), dict) else {};
        state_json = {"board": dict(inner)};

        if self.state.get("status") == STATUS_FINISHED:
            result = dict(self.state.get("result") or {});
        else:
            result = {"status": STATUS_ACTIVE, "winner": None, "reason": None};
        status = str(result.get("status") or STATUS_ACTIVE);
        if status == STATUS_DRAW:
            status = STATUS_FINISHED;

        players = self.state.get("players") if isinstance(self.state.get("players"), dict) else {};

        def _user_id_for_color(color: Any) -> str | None:
            """Resolve a board color to a persistable app-user foreign key.""";
            info = players.get(color) if isinstance(players, dict) else None;
            user_id = str((info or {}).get("user_id") or "").strip() if isinstance(info, dict) else "";
            return user_id or None;

        winner_color = result.get("winner");
        winner_id = _user_id_for_color(winner_color) if (status == STATUS_FINISHED and winner_color in ("w", "b")) else None;
        next_color = self.state.get("current_turn");
        played_by_id = _user_id_for_color(mover_color) if mover_color in ("w", "b") else None;
        next_player_id = _user_id_for_color(next_color) if next_color in ("w", "b") else None;

        captured = self.state.get("captured") if isinstance(self.state.get("captured"), dict) else {};
        score_a = list(captured.get("w") or []);  # white pieces removed (slot a panel)
        score_b = list(captured.get("b") or []);  # black pieces removed (slot b panel)

        notation = str(summary.get("notation") or action_key or "move");
        terminal_reason = str(result.get("reason") or "").strip() or (
            action_key if status == STATUS_FINISHED else ""
        ) or None;
        params: CommitMoveParams = {
            "p_game_id": self.game_id,
            "p_state_json": state_json,
            "p_events": _build_rpc_events(events=list(animation_events), action_key=action_key),
            "p_notation": notation,
            "p_status": status,
            "p_winner_id": winner_id,
            "p_reason": terminal_reason,
            "p_played_by_id": played_by_id,
            "p_next_player_id": next_player_id,
            "p_score_a": score_a,
            "p_score_b": score_b,
            "p_time_a_ms": int(self.state.get("clock_a_ms", 0)),
            "p_time_b_ms": int(self.state.get("clock_b_ms", 0)),
        };  # param names must match app_commit_move exactly
        self.persist.enqueue(params);

    def _fire_terminal_hook(self, event: GameOver) -> None:
        """Invoke optional terminal subscriber without breaking commit flow.""";
        if self._terminal_callback is None:
            return;
        try:
            self._terminal_callback(self.game_id, copy.deepcopy(event));
        except Exception as exc:
            _log.warning("terminal callback failed for game %s: %s", self.game_id, exc, exc_info=True);

    def _assert_seq(self, expected: int) -> None:
        """Compare MoveRequest.expected_seq against authoritative stream_seq.""";
        current = int(self.state.get("stream_seq", 0));
        if int(expected) != current:
            raise ServiceError(409, f"stale: expected seq {current} got {int(expected)}");

    def _lookup_cached(self, client_move_id: str) -> MoveAccepted | None:
        """Return cached MoveAccepted for repeating client_move_id.""";
        if not client_move_id or client_move_id not in self._processed_client_move_ids:
            return None;
        cached = self._processed_client_move_ids[client_move_id];
        self._processed_client_move_ids.move_to_end(client_move_id);
        return dict(cached);

    def _cache_accepted(self, client_move_id: str, event: MoveAccepted) -> None:
        """LRU-insert accepted client_move_id responses for MAX_PROCESSED_CLIENT_MOVE_IDS window.""";
        if not client_move_id:
            return;
        self._processed_client_move_ids[client_move_id] = dict(event);
        self._processed_client_move_ids.move_to_end(client_move_id);
        while len(self._processed_client_move_ids) > MAX_PROCESSED_CLIENT_MOVE_IDS:
            self._processed_client_move_ids.popitem(last=False);

def _color(value: Any) -> Color:
    """Normalise stored colour markers to "w" or "b".""";
    return "b" if str(value or "w").strip().lower() == "b" else "w";

def _build_rpc_events(
    *,
    events: list[dict[str, Any]],
    action_key: str,
) -> list[dict[str, Any]]:
    """Build ``events_json`` for one move: the raw animation events (no snapshot/label duplication).""";
    rows: list[dict[str, Any]] = [];
    for raw in events:
        rows.append(dict(raw) if isinstance(raw, dict) else {"value": raw});
    _ = action_key;  # action lives in the move's notation column
    return rows;

class ChezzSessions:
    """Runtime-owned Chezz coordinator for sessions, hydration, and persistence.""";

    def __init__(
        self,
        *,
        project_root: Path,
        persist_callable: Callable[[CommitMoveParams], Any],
        hydrate_state: Callable[[str, str | None], GameState],
        publish_terminal: TerminalCallback | None = None,
        database: Any = None,
    ) -> None:

        self.engine = ChezzEngine(project_root);
        self.persist = PersistQueue(
            persist_callable,
            log_tag="chezz.persist",
            thread_name_prefix="chezz-gameplay-persist",
        );
        self.persist.start();
        self.registry = SessionRegistry(env_var="GAMES_SESSION_IDLE_SECONDS");
        self.registry.start_sweeper(thread_name="chezz-gameplay-registry-sweep");
        self.hydrate_state = hydrate_state;
        self.publish_terminal = publish_terminal;
        self.database = database;

    def metrics(self) -> dict[str, Any]:
        """Return registry and persistence metrics for the ops endpoint.""";
        return {"sessions": self.registry.size(), "persist_queue": self.persist.metrics()};

    def get_session(self, user_id: str, game_id: str) -> ChezzSession:
        """Return a warm session or hydrate one repository snapshot.""";
        return self.registry.get_or_hydrate(
            game_id,
            lambda hydrated_game_id: ChezzSession(
                game_id=hydrated_game_id,
                initial_state=self.hydrate_state(user_id, hydrated_game_id),
                engine=self.engine,
                persist=self.persist,
                on_terminal=self.publish_terminal,
            ),
        );

    def load_state(self, user_id: str, *, game_id: str) -> GameState:
        """Return personalized state and refreshed profiles without mutating gameplay.""";
        session = self.get_session(user_id, game_id);
        session.ensure_clock_resolved();
        if self.database is not None:
            from .repository import refresh_players;

            session.update_players(refresh_players(self.database, game_id, session.state_snapshot()));
        state = session.state_snapshot();
        state["you_color"] = player_color_for(state, user_id);
        state["self_user_id"] = str(user_id);
        state["legal"] = session.game.legal();
        return state;

    def submit_move(self, user_id: str, *, move_request: MoveRequest) -> SseEvent:
        """Submit one authenticated player move to its coordinated session.""";
        game_id = str(move_request.get("game_id") or "");
        if not game_id:
            raise ServiceError(400, "move_request missing game_id");
        return self.get_session(user_id, game_id).apply_player_move(user_id=user_id, move_request=move_request);

    def play_engine_move(self, user_id: str, *, game_id: str) -> SseEvent:
        """Apply one engine move after validating PvE mode and active engine seat.""";
        session = self.get_session(user_id, game_id);
        state = session.state_snapshot();
        if str(state.get("mode") or "") != "pve":
            raise ServiceError(403, "Engine moves are only allowed in vs-engine games");
        if player_color_for(state, user_id) is None:
            raise ServiceError(403, "Not a player in this game");
        current = str(state.get("current_turn") or "");
        if current not in ("w", "b"):
            raise ServiceError(409, "Game is not active");
        players = state.get("players") or {};
        seat = (players.get(current) if isinstance(players, dict) else {}) or {};
        if str(seat.get("user_id") or "") != ENGINE_USER_ID:
            raise ServiceError(403, "Not engine turn");
        return session.apply_engine_move();

    def surrender(self, user_id: str, *, game_id: str, cause: str | None = None) -> GameOver:
        """End a Chezz game by surrender from one seated player.""";
        session = self.get_session(user_id, game_id);
        color = player_color_for(session.state_snapshot(), user_id);
        if color not in ("w", "b"):
            raise ServiceError(403, "Not a player in this game");
        return session.surrender(color, cause=cause);

    def agree_draw(self, user_id: str, *, game_id: str) -> GameOver:
        """End a Chezz game after both PvP players accept a draw.""";
        session = self.get_session(user_id, game_id);
        state = session.state_snapshot();
        if str(state.get("mode") or "") != "pvp":
            raise ServiceError(400, "Draw offers are only available in PvP games.");
        if player_color_for(state, user_id) not in ("w", "b"):
            raise ServiceError(403, "Not a player in this game");
        return session.agree_draw();

    def subscribe(self, user_id: str, *, game_id: str, since_seq: int, wait_seconds: float) -> SubscribePayload:
        """Return ordered Chezz SSE events after the supplied stream cursor.""";
        events, last_seq = self.get_session(user_id, game_id).subscribe(int(since_seq), timeout_seconds=float(wait_seconds));
        return {"game_id": str(game_id), "events": events, "last_seq": last_seq};

    def broadcast_chat(self, user_id: str, game_id: str, chat_rows: list[dict[str, Any]]) -> None:
        """Publish already-persisted chat rows to Chezz SSE subscribers.""";
        resolved_user_id = str(user_id or "").strip() or str((chat_rows[0] if chat_rows else {}).get("user_id") or "").strip();
        if resolved_user_id and chat_rows:
            self.get_session(resolved_user_id, str(game_id)).publish_chat_messages([dict(row) for row in chat_rows if isinstance(row, dict)]);

    def stop(self) -> None:
        """Stop workers for isolated tests or process shutdown.""";
        self.persist.stop(graceful_timeout=1.0);
        self.registry.stop_sweeper(graceful_timeout=1.0);

class ChezzRuntime:
    """Platform adapter for Chezz-owned bootstrap, repository, and sessions.""";

    game_type: GameType = "chezz";
    modes = frozenset({"pve", "pvp"});

    def __init__(
        self,
        database: RuntimeDatabase,
        *,
        project_root: Path,
        unfinished_pvp_game: Callable[[str, str], str | None],
        unfinished_offline_game: Callable[[str, str, str], str | None],
    ) -> None:

        from . import repository;

        self.database = database;
        self.unfinished_pvp_game = unfinished_pvp_game;
        self.unfinished_offline_game = unfinished_offline_game;
        self.sessions = ChezzSessions(
            project_root=project_root,
            persist_callable=repository.make_persist_callable(database),
            hydrate_state=repository.make_hydrate_state(database),
            database=database,
        );

    def create_offline(self, user_id: str, body: JsonObject) -> str:
        """Create offline.""";
        from .bootstrap import bootstrap_offline;
        return bootstrap_offline(self.database, user_id, body);

    def active_game(self, user_id: str) -> str:
        """Resolve the player's current Chezz game through repository hydration.""";
        from .repository import active_game_id;
        return active_game_id(self.database, user_id);

    def active_incomplete_game(self, user_id: str) -> tuple[str | None, str | None]:
        """Prefer an active PvP game, then the player's resumable PvE game.""";
        game_id = self.unfinished_pvp_game(user_id, self.game_type);
        if game_id:
            return game_id, "pvp";
        game_id = self.unfinished_offline_game(user_id, self.game_type, "pve");
        return (game_id, "pve") if game_id else (None, None);

    def activate_pvp(self, user_id: str, match_id: str, player_a_id: str, player_b_id: str, match: MatchRow) -> None:
        """Activate pvp.""";
        from .bootstrap import insert_pvp_app_game;
        insert_pvp_app_game(self.database, user_id, match_id=match_id, player_a_id=player_a_id, player_b_id=player_b_id, match=dict(match));

    def create_rematch(self, player_a_id: str, player_b_id: str) -> str:
        """Create rematch.""";
        from .bootstrap import materialize_rematch;
        return materialize_rematch(self.database, player_a_id, player_b_id);

    def load_state(self, user_id: str, game_id: str) -> JsonObject:
        """Load state.""";
        return cast(JsonObject, self.sessions.load_state(user_id, game_id=game_id));

    def replay(self, user_id: str, game_id: str | None, include_events: bool) -> JsonObject:

        from .repository import build_replay;
        return cast(JsonObject, build_replay(self.database, user_id, game_id=game_id, include_events=include_events, state_loader=lambda replay_user_id, replay_game_id: self.sessions.load_state(replay_user_id, game_id=replay_game_id)));

    def surrender(self, user_id: str, game_id: str, cause: str | None = None) -> JsonObject:
        """Apply surrender.""";
        return cast(JsonObject, self.sessions.surrender(user_id, game_id=game_id, cause=cause));

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
        """Chezz PvE games do not need resume repair.""";
        _ = game_id;

    def metrics(self) -> dict[str, Any]:
        """Return metrics.""";
        return self.sessions.metrics();

    def stop(self) -> None:
        """Stop owned queue and registry workers.""";
        self.sessions.stop();

    def submit_move(self, user_id: str, *, move_request: MoveRequest) -> SseEvent:
        """Submit one authenticated player move.""";
        return self.sessions.submit_move(user_id, move_request=move_request);

    def play_engine_move(self, user_id: str, *, game_id: str) -> SseEvent:
        """Submit one authenticated engine move.""";
        return self.sessions.play_engine_move(user_id, game_id=game_id);

__all__ = [
    "ChezzSession",
    "ChezzSessions",
    "ChezzRuntime",
    "MAX_PROCESSED_CLIENT_MOVE_IDS",
];
