from __future__ import annotations;

import json;
from collections.abc import Callable;
from datetime import UTC, datetime;
from typing import Any;

from src.platform.backend.replay import coerce_snapshot;
from src.platform.backend import ServiceError;
from src.platform.backend.contracts import DatabaseReader, RuntimeDatabase;
from src.platform.backend.game_persist import CommitMoveParams, commit_move, load_active_game;

from src.chezz.runtime.contracts import (
    COLOR_BLACK,
    COLOR_WHITE,
    ENGINE_USER_ID,
    GAME_TYPE_CHEZZ,
    MODE_PVE,
    STATUS_ACTIVE,
    TERMINAL_STATUSES,
);

from .contracts import (
    Captured,
    EngineBoard,
    GameResult,
    GameState,
    Mode,
    MoveRow,
    PlayerInfo,
    Players,
    ReplayEntry,
    ReplayTimeline,
    Status,
);

class ChezzRepository:
    """Load persisted Chezz rows through the shared typed database boundary.""";

    def __init__(self, database: RuntimeDatabase) -> None:

        self.database = database;

    @staticmethod
    def _coerce_board_json(value: Any) -> dict[str, Any] | None:
        """Decode one persisted board object.""";
        if isinstance(value, dict):
            return value;
        if isinstance(value, str):
            try:
                parsed = json.loads(value.strip());
            except json.JSONDecodeError:
                return None;
            return parsed if isinstance(parsed, dict) else None;
        return None;

    @staticmethod
    def _color_for_user_id(user_id: Any, player_a_id: Any, player_b_id: Any) -> str | None:
        """Map a persisted player id to its Chezz color.""";
        value = str(user_id or "").strip();
        if value == str(player_a_id or "").strip() and value:
            return COLOR_WHITE;
        if value == str(player_b_id or "").strip() and value:
            return COLOR_BLACK;
        return None;

    def _latest_move_row(self, game_id: str) -> dict[str, Any] | None:
        """Return the newest persisted board, clocks, and turn row.""";
        return self.database.select_one(
            "app_game_moves",
            columns="ply,state_json,next_player_id,time_a_ms,time_b_ms,score_a,score_b,created_at",
            filters={"game_id": game_id},
            order="ply.desc",
        );

    @staticmethod
    def _clock_fields_from_move(move_row: dict[str, Any] | None) -> dict[str, Any]:
        """Extract persisted clocks from one move row.""";
        return {
            "clock_a_ms": (move_row or {}).get("time_a_ms"),
            "clock_b_ms": (move_row or {}).get("time_b_ms"),
            "clock_anchor_iso": str((move_row or {}).get("created_at") or ""),
        };

    def _reassemble_snapshot(
        self,
        state_json: Any,
        game_row: dict[str, Any],
        move_row: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Build the client board snapshot from normalized DB columns.""";
        stored = self._coerce_board_json(state_json);
        if stored is None:
            return None;
        board = stored.get("board");
        if not isinstance(board, dict):
            board = stored if "board" not in stored else {};
        player_a_id = game_row.get("player_a_id");
        player_b_id = game_row.get("player_b_id");
        winner = self._color_for_user_id(game_row.get("winner_id"), player_a_id, player_b_id);
        status = str(game_row.get("status") or STATUS_ACTIVE);
        turn = self._color_for_user_id((move_row or {}).get("next_player_id"), player_a_id, player_b_id) or COLOR_WHITE;
        snapshot: dict[str, Any] = {
            "board": board,
            "header": {"turn": turn, "num_moves": int((move_row or {}).get("ply") or 0)},
            "winner": winner if status in TERMINAL_STATUSES else None,
        };
        snapshot["result"] = {
            "status": "finished" if status in TERMINAL_STATUSES else STATUS_ACTIVE,
            "winner": snapshot["winner"],
            "reason": game_row.get("reason") if status in TERMINAL_STATUSES else None,
        };
        return snapshot;

    def _load_context_by_game_id(self, user_id: str, game_id: str) -> dict[str, Any] | None:
        """Load one authorized Chezz game by id.""";
        game_row = self.database.select_one(
            "app_games",
            columns="id,user_id,player_a_id,player_b_id,mode,status,winner_id,reason",
            filters={"id": game_id, "game_type": GAME_TYPE_CHEZZ},
        );
        if not isinstance(game_row, dict):
            return None;
        move_row = self._latest_move_row(game_id);
        return self._context_from_rows(user_id, game_id, game_row, move_row);

    def _context_from_rows(
        self,
        user_id: str,
        game_id: str,
        game_row: dict[str, Any],
        move_row: dict[str, Any] | None,
        *,
        state_json: Any = None,
    ) -> dict[str, Any] | None:
        """Assemble one authorized context from already-loaded rows.""";
        snapshot = self._reassemble_snapshot(
            state_json if state_json is not None else move_row.get("state_json") if isinstance(move_row, dict) else None,
            game_row,
            move_row,
        );
        if snapshot is None:
            return None;
        player_a_id = game_row.get("player_a_id");
        player_b_id = game_row.get("player_b_id");
        player_color = self._color_for_user_id(user_id, player_a_id, player_b_id);
        if player_color is None:
            raise ServiceError(403, "Not a player in this game");
        return {
            "game_id": game_id,
            "snapshot": snapshot,
            "mode": str(game_row.get("mode") or MODE_PVE),
            "player_color": player_color,
            **self._clock_fields_from_move(move_row),
            "stream_seq": int((move_row or {}).get("ply", -1)),
            "_game_row": game_row,
        };

    def _load_context_from_tables(self, user_id: str) -> dict[str, Any] | None:
        """Load active context through one RPC, then fall back to finished rows.""";
        active_rows = load_active_game(self.database, user_id, GAME_TYPE_CHEZZ);
        if active_rows:
            row = active_rows[0];
            game_row = row.get("game_row");
            move_row = row.get("latest_move");
            game_id = str(row.get("game_id") or "");
            if game_id and isinstance(game_row, dict):
                return self._context_from_rows(
                    user_id,
                    game_id,
                    game_row,
                    move_row if isinstance(move_row, dict) else None,
                    state_json=row.get("snapshot"),
                );

        columns = "id,user_id,player_a_id,player_b_id,status,mode,winner_id,reason,updated_at";
        rows_by_id: dict[str, dict[str, Any]] = {};
        for seat_column in ("player_a_id", "player_b_id"):
            rows = self.database.select(
                "app_games",
                columns=columns,
                filters={"game_type": GAME_TYPE_CHEZZ, seat_column: user_id},
                order="updated_at.desc",
            );
            rows_by_id.update({str(row.get("id")): row for row in rows if row.get("id")});
        rows = sorted(rows_by_id.values(), key=lambda row: str(row.get("updated_at") or ""), reverse=True);
        chosen = next((row for row in rows if row.get("status") in TERMINAL_STATUSES), None);
        if not isinstance(chosen, dict):
            return None;
        return self._load_context_by_game_id(user_id, str(chosen["id"]));

    def _load_context(self, user_id: str, *, game_id: str | None = None) -> dict[str, Any]:
        """Load one explicit game or the player's preferred resumable game.""";
        context = self._load_context_by_game_id(user_id, game_id) if game_id else self._load_context_from_tables(user_id);
        if context is not None:
            return context;
        if game_id:
            raise ServiceError(404, "Game not found.");
        raise ServiceError(404, "No active chezz game context. Start or join a game first.");

    def active_game_id(self, user_id: str) -> str:
        """Return the player's preferred resumable Chezz game id.""";
        return str(self._load_context(user_id)["game_id"]);

def make_hydrate_state(database: RuntimeDatabase) -> Callable[[str, str | None], GameState]:
    """Return a hydrate callable that loads GameState from the database.""";

    def _hydrate(user_id: str, game_id: str | None) -> GameState:
        """Load one requested Chezz game or reject missing game identity.""";
        if not game_id:
            raise ServiceError(
                400,
                "hydrate_state requires a game_id (new-game flow goes through /api/new-game)",
            );
        return _hydrate_game_state(database, user_id, str(game_id));
    return _hydrate;

def make_persist_callable(database: Any) -> Callable[[CommitMoveParams], Any]:
    """Return a write-behind callable that persists through the shared move RPC.""";

    def _persist(rpc_params: CommitMoveParams) -> Any:
        """Forward one queued Chezz move payload to the shared commit RPC.""";
        return commit_move(database, rpc_params);
    return _persist;

def _hydrate_game_state(database: RuntimeDatabase, user_id: str, game_id: str) -> GameState:
    """Load persisted rows and assemble GameState.""";
    context = ChezzRepository(database)._load_context(user_id, game_id=game_id);
    snapshot = dict(context.get("snapshot") or {});
    if not isinstance(snapshot, dict) or not snapshot:
        raise ServiceError(404, "Game has no board snapshot");

    mode: Mode = "pvp" if str(context.get("mode") or "").lower() == "pvp" else "pve";
    game_row = context.get("_game_row");
    players = _build_players(database, game_id, mode, game_row=game_row if isinstance(game_row, dict) else None);
    you_color: str | None = None;  # per-request in load_state()

    result_block = snapshot.get("result") if isinstance(snapshot.get("result"), dict) else None;
    status: Status = "active";
    if result_block:
        rs = str(result_block.get("status") or "").lower();
        if rs in ("finished", "draw"):
            status = "finished";
    result: GameResult | None = None;
    if result_block:
        result = {
            "status": str(result_block.get("status") or "finished"),
            "winner": result_block.get("winner"),
            "reason": result_block.get("reason"),
        };

    header_raw = snapshot.get("header") if isinstance(snapshot.get("header"), dict) else {};
    current_turn = "b" if str(header_raw.get("turn") or "w").lower() == "b" else "w";

    history, captured, move_number = _backfill_history(database, game_id);

    clock_a_ms = context.get("clock_a_ms");
    clock_b_ms = context.get("clock_b_ms");
    if clock_a_ms is None or clock_b_ms is None:
        raise ServiceError(500, "Game move row is missing clocks");

    anchor_iso = (
        str(context.get("clock_anchor_iso") or "")
        or datetime.now(UTC).isoformat()
    );
    persisted_stream_seq = int(context.get("stream_seq") if context.get("stream_seq") is not None else -1);
    display_stream_seq = persisted_stream_seq if persisted_stream_seq >= 0 else 0;
    next_realtime_seq = (persisted_stream_seq + 1) if persisted_stream_seq >= 0 else 0;

    board: EngineBoard = snapshot;

    state: GameState = {
        "game_id": game_id,
        "mode": mode,
        "status": status,
        "result": result,
        "players": players,
        "you_color": you_color if you_color in ("w", "b") else None,
        "board": board,
        "current_turn": current_turn,
        "move_number": move_number,
        "move_history": history,
        "captured": captured,
        "clock_a_ms": int(clock_a_ms),
        "clock_b_ms": int(clock_b_ms),
        "clock_active_color": current_turn,
        "clock_anchor_iso": anchor_iso,
        "stream_seq": display_stream_seq,
        "_internal_realtime_next_seq": next_realtime_seq,
    };
    return state;

def _build_players(database: DatabaseReader, game_id: str, mode: Mode, *, game_row: dict[str, Any] | None = None) -> Players:
    """Build Players map from app_games row.""";
    row = game_row or database.select_one(
        "app_games", columns="id,user_id,player_a_id,player_b_id", filters={"id": game_id},
    );
    white_col = (row or {}).get("player_a_id");
    black_col = (row or {}).get("player_b_id");
    white_raw = str(white_col).strip() if white_col else "";
    black_raw = str(black_col).strip() if black_col else "";

    if mode == "pve":
        if not white_raw or not black_raw:
            raise ServiceError(
                500,
                "PVE app_games row must set both player_a_id and player_b_id (human + engine).",
            );
        profiles = _player_infos(database, [white_raw, black_raw]);
        if white_raw == ENGINE_USER_ID and black_raw != ENGINE_USER_ID:
            return {"w": profiles[ENGINE_USER_ID], "b": profiles[black_raw]};
        if black_raw == ENGINE_USER_ID and white_raw != ENGINE_USER_ID:
            return {"w": profiles[white_raw], "b": profiles[ENGINE_USER_ID]};
        raise ServiceError(
            500,
            "PVE app_games row must assign the engine user to exactly one of player_a_id / player_b_id.",
        );

    owner_uid = str((row or {}).get("user_id") or "").strip();
    white_uid = white_raw or owner_uid;
    black_uid = black_raw;
    profiles = _player_infos(database, [white_uid, black_uid]);
    white_info = profiles.get(white_uid, _empty_player());
    black_info = profiles.get(black_uid, _empty_player());
    return {"w": white_info, "b": black_info};

def _player_infos(database: DatabaseReader, user_ids: list[str]) -> dict[str, PlayerInfo]:
    """Resolve player cards with one app_users query.""";
    ids = sorted({user_id for user_id in user_ids if user_id});
    if not ids:
        return {};
    rows = database.select(
        "app_users",
        columns="id,username,photo_url",
        filters={"id": ("in", ids)},
    );
    by_id = {str(row.get("id")): row for row in rows if row.get("id")};
    return {
        user_id: {
            "user_id": user_id,
            "username": str(by_id.get(user_id, {}).get("username") or user_id),
            "photo_url": by_id.get(user_id, {}).get("photo_url") or None,
        }
        for user_id in ids
    };

def _empty_player() -> PlayerInfo:
    """Empty PlayerInfo used when a seat is unset.""";
    return {"user_id": "", "username": "", "photo_url": None};

def _backfill_history(database: DatabaseReader, game_id: str) -> tuple[list[MoveRow], Captured, int]:
    """Reconstruct move_history (one app_game_moves row per ply) and the cumulative captured panel.""";
    rows = database.select(
        "app_game_moves",
        columns="ply,events_json,notation,score_a,score_b,time_a_ms,time_b_ms,created_at",
        filters={"game_id": game_id},
        order="ply.asc",
    ) or [];

    history: list[MoveRow] = [];
    captured: Captured = {"w": [], "b": []};
    for move_row in rows:
        ply = int(move_row.get("ply") or 0);
        if ply <= 0:  # ply 0 = initial "Start" row, not a move
            continue;
        events = move_row.get("events_json");
        events = events if isinstance(events, list) else [];
        notation = str(move_row.get("notation") or "");
        summary = _summary_from_events(events, notation);
        row: MoveRow = {
            "seq": ply - 1,
            "step": len(history) + 1,
            "color": str(summary.get("color") or "w"),
            "from_": str(summary.get("from_") or ""),
            "to": str(summary.get("to") or ""),
            "piece": str(summary.get("piece") or ""),
            "captured": list(summary.get("captured") or []),
            "spawned": list(summary.get("spawned") or []),
            "transformed": list(summary.get("transformed") or []),
            "destroyed": list(summary.get("destroyed") or []),
            "notation": notation,
            "clock_a_ms_after": int(move_row.get("time_a_ms") or 0),
            "clock_b_ms_after": int(move_row.get("time_b_ms") or 0),
            "created_at": str(move_row.get("created_at") or ""),
        };
        history.append(row);
        score_a = move_row.get("score_a");
        score_b = move_row.get("score_b");
        if isinstance(score_a, list) or isinstance(score_b, list):
            captured = {
                "w": list(score_a) if isinstance(score_a, list) else captured["w"],
                "b": list(score_b) if isinstance(score_b, list) else captured["b"],
            };
    return history, captured, len(history);

def _summary_from_events(events: list[dict[str, Any]], action_key: str) -> dict[str, Any]:
    """Coarse move summary from stored engine events (hydrate-only).""";
    summary: dict[str, Any] = {
        "from_": "",
        "to": "",
        "piece": "",
        "color": "w",
        "captured": [],
        "spawned": [],
        "transformed": [],
        "destroyed": [],
    };
    captured: list[str] = [];
    spawned: list[str] = [];
    transformed: list[str] = [];
    destroyed: list[str] = [];
    for evt in events:
        if not isinstance(evt, dict):
            continue;
        etype = int(evt.get("type", -1)) if str(evt.get("type", "")).lstrip("-").isdigit() else -1;
        piece = str(evt.get("piece") or evt.get("from_piece") or "");
        if etype == 2 and not summary["from_"]:
            summary["from_"] = str(evt.get("from_square") or "");
            summary["to"] = str(evt.get("to_square") or "");
            summary["piece"] = piece;
            if piece:
                summary["color"] = piece[0].lower();
        elif etype == 1:
            cp = str(evt.get("piece") or evt.get("from_piece") or "");
            if cp:
                captured.append(cp);
        elif etype == 3:
            transformed.append(str(evt.get("to_piece") or piece));
        elif etype == 4:
            spawned.append(str(evt.get("to_piece") or piece));

    if not summary["from_"] and action_key:
        kind, _, rest = action_key.partition(":");
        if kind == "shoot" and rest:
            sq, _, _direction = rest.partition(":");
            summary["from_"] = sq;
            summary["to"] = sq;
        elif kind == "fling" and rest:
            cat, _, payload_target = rest.partition(":");
            payload, _, target = payload_target.partition(">");
            summary["from_"] = payload or cat;
            summary["to"] = target;
        elif kind == "move" and rest:
            f, _, t = rest.partition(">");
            summary["from_"] = f;
            summary["to"] = t;

    summary["captured"] = captured;
    summary["spawned"] = spawned;
    summary["transformed"] = transformed;
    summary["destroyed"] = destroyed;
    return summary;

def refresh_players(database: Any, game_id: str, state: GameState) -> Players:
    """Re-read player profiles from app_users (profile photo/username edits).""";
    mode: Mode = "pvp" if str(state.get("mode") or "").lower() == "pvp" else "pve";
    return _build_players(database, game_id, mode);

def active_game_id(database: RuntimeDatabase, user_id: str) -> str:
    """Return the player's preferred resumable Chezz game id.""";
    return ChezzRepository(database).active_game_id(user_id);

def build_replay(
    database: RuntimeDatabase,
    user_id: str,
    *,
    game_id: str | None,
    include_events: bool = False,
    state_loader: Callable[[str, str], GameState] | None = None,
) -> ReplayTimeline:
    """Load the persisted Chezz replay timeline.""";
    game_id = str(game_id or "").strip();
    if not game_id:
        raise ServiceError(400, "game_id is required");
    ChezzRepository(database)._load_context(user_id, game_id=game_id);
    rows = database.select(
        "app_game_moves",
        columns="ply,state_json,notation,events_json",
        filters={"game_id": game_id},
        order="ply.asc",
    ) or [];
    entries: list[ReplayEntry] = [];
    for index, row in enumerate(rows):
        snapshot = coerce_snapshot(row.get("state_json"));
        if snapshot is None:
            continue;
        entry = {
            "index": index,
            "step": int(row.get("ply", index)),
            "label": str(row.get("notation") or f"Position {index}"),
            "snapshot": snapshot,
        };
        if include_events:
            events = row.get("events_json");
            entry["events"] = events if isinstance(events, list) else [];
        entries.append(entry);
    if not entries:
        if state_loader is None:
            raise ServiceError(404, "Game not found");
        state = state_loader(user_id, game_id);
        snapshot = coerce_snapshot(state.get("board"));
        if snapshot is None:
            raise ServiceError(404, "Game not found");
        entries = [{"index": 0, "step": 0, "label": "Position", "snapshot": snapshot}];
        if include_events:
            entries[0]["events"] = [];
    return {"game_id": game_id, "entries": entries, "live_index": max(len(entries) - 1, 0)};

__all__ = [
    "ChezzRepository",
    "active_game_id",
    "make_hydrate_state",
    "make_persist_callable",
    "refresh_players",
    "build_replay",
];
