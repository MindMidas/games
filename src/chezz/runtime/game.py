from __future__ import annotations;

import copy;
from datetime import UTC, datetime;
from typing import Any;

from src.platform.backend import ServiceError;

from .engine import ChezzEngine;
from .contracts import AnimationEvent, Color, EngineBoard, GameState, LegalAfterPayload, MoveRequest, MoveSummary;
from .contracts import STATUS_ACTIVE, STATUS_DRAW, STATUS_FINISHED, WINNER_DRAW;

class ChezzGame:
    """Authoritative in-memory Chezz state machine without transport or persistence.""";

    def __init__(self, state: GameState, engine: ChezzEngine) -> None:
        """Initialize the authoritative state machine from hydrated state.""";
        self.state: GameState = copy.deepcopy(state);
        self.engine = engine;

    def snapshot(self) -> GameState:
        """Return a deep copy safe for HTTP, SSE, and persistence readers.""";
        return copy.deepcopy(self.state);

    def legal(self) -> LegalAfterPayload:
        """Build legal and premove actions for the current engine board.""";
        board = self.state.get("board");
        if not isinstance(board, dict) or self.state.get("status") != STATUS_ACTIVE:
            return {"cursor": str(int(self.state.get("stream_seq", 0))), "actions": [], "premove_by_color": {}};
        return {
            "cursor": str(int(self.state.get("stream_seq", 0))),
            "actions": self.engine.legal_moves(board),
            "premove_by_color": self.engine.premove_actions_by_color(board),
        };

    def play(self, move_request: MoveRequest, mover_color: Color) -> tuple[EngineBoard, list[AnimationEvent], MoveSummary]:
        """Validate turn ownership and apply one player-selected native action.""";
        if self.state.get("status") != STATUS_ACTIVE:
            raise ServiceError(409, "Game is not active");
        if mover_color != self.state.get("current_turn"):
            raise ServiceError(403, "Not your turn");
        meta = move_request.get("meta") or {};
        return self.engine.apply_move(
            self.state["board"],
            str(move_request.get("from_") or move_request.get("from") or ""),
            str(move_request.get("to") or ""),
            str(move_request.get("kind") or ""),
            square=meta.get("square"),
            direction=meta.get("direction"),
            catapult=meta.get("catapult"),
            payload=meta.get("payload"),
            target=meta.get("target"),
        );

    def play_engine(self) -> tuple[EngineBoard, list[AnimationEvent], MoveSummary, str]:
        """Select and apply one server-authoritative native engine action.""";
        if self.state.get("status") != STATUS_ACTIVE:
            raise ServiceError(409, "Game is not active");
        candidate = self.engine.engine_move(self.state["board"]);
        board, events, summary = self.engine.apply_candidate(self.state["board"], candidate);
        return board, events, summary, str(candidate.get("action_key") or summary.get("notation") or "");

    def advance(
        self,
        *,
        next_board: EngineBoard,
        animation_events: list[AnimationEvent],
        summary: MoveSummary,
        mover_color: Color,
        clock_fields: dict[str, Any],
    ) -> GameState:
        """Advance history, captures, clocks, turn, and terminal overlays.""";
        candidate = {"kind": str(summary.get("kind") or "move"), "events": list(animation_events)};
        next_board = dict(next_board);
        next_board["board"] = _clean_board(next_board.get("board"));
        next_board = apply_terminal_result(next_board, candidate);
        new_state: GameState = copy.deepcopy(self.state);
        new_state["board"] = next_board;
        new_state["current_turn"] = _color((next_board.get("header") or {}).get("turn") or _other(mover_color));
        new_state["move_number"] = int(new_state.get("move_number", 0)) + 1;

        history = list(new_state.get("move_history") or []);
        history.append({
            "seq": -1,
            "step": len(history) + 1,
            "color": mover_color,
            "from_": str(summary.get("from_") or ""),
            "to": str(summary.get("to") or ""),
            "piece": str(summary.get("piece") or ""),
            "captured": list(summary.get("captured") or []),
            "spawned": list(summary.get("spawned") or []),
            "transformed": list(summary.get("transformed") or []),
            "destroyed": list(summary.get("destroyed") or []),
            "notation": str(summary.get("notation") or ""),
            "clock_a_ms_after": int(clock_fields["clock_a_ms"]),
            "clock_b_ms_after": int(clock_fields["clock_b_ms"]),
            "created_at": datetime.now(UTC).isoformat(),
        });
        new_state["move_history"] = history;

        captured = dict(new_state.get("captured") or {"w": [], "b": []});
        captured.setdefault("w", []);
        captured.setdefault("b", []);
        for piece in summary.get("captured") or []:
            code = str(piece or "");
            if code and code[0].lower() in ("w", "b"):
                captured[code[0].lower()] = list(captured[code[0].lower()]) + [code];
        new_state["captured"] = captured;
        new_state.update(clock_fields);
        self.state = _apply_result(new_state, next_board);
        return self.state;

    def finish(self, *, reason: str, winner: Color | str | None) -> GameState:
        """Force a terminal result for non-board outcomes such as forfeits.""";
        self.state["status"] = STATUS_FINISHED;
        self.state["result"] = {"status": STATUS_DRAW if winner == WINNER_DRAW else STATUS_FINISHED, "winner": winner, "reason": reason};
        return self.state;

    def surrender(self, color: Color, *, cause: str | None = None) -> GameState:
        """Finish the game after one seated player surrenders.""";
        reason = "inactivity_forfeit" if str(cause or "").strip().lower() == "inactivity" else "surrender";
        return self.finish(reason=reason, winner=_other(color));

    def agree_draw(self) -> GameState:
        """Finish the game after both players agree to a draw.""";
        return self.finish(reason="draw_agreed", winner=WINNER_DRAW);

def _apply_result(state: GameState, board: EngineBoard) -> GameState:
    """Copy the engine-board terminal result into authoritative game state.""";
    result = board.get("result") if isinstance(board.get("result"), dict) else {};
    status = str(result.get("status") or STATUS_ACTIVE);
    if status == STATUS_FINISHED:
        state["status"] = STATUS_FINISHED;
        state["result"] = {"status": STATUS_FINISHED, "winner": result.get("winner"), "reason": result.get("reason")};
    elif status == STATUS_DRAW:
        state["status"] = STATUS_FINISHED;
        state["result"] = {"status": STATUS_DRAW, "winner": WINNER_DRAW, "reason": str(result.get("reason") or "Draw.")};
    else:
        state["status"] = STATUS_ACTIVE;
        state["result"] = None;
        state["winner"] = None;
    winner = board.get("winner") if isinstance(board.get("winner"), str) else None;
    if winner is not None:
        state["winner"] = winner;
    elif isinstance(state.get("result"), dict):
        state["winner"] = state["result"].get("winner");
    return state;

def _other(color: Color) -> Color:
    """Return the opposing Chezz color.""";
    return "b" if color == "w" else "w";

def _color(value: Any) -> Color:
    """Normalize an untrusted color marker to white or black.""";
    return "b" if str(value or "w").strip().lower() == "b" else "w";

def player_color_for(state: GameState, user_id: str) -> Color | None:
    """Return the user's board color, or None when the user is not seated.""";
    players = state.get("players") or {};
    for color in ("w", "b"):
        info = (players.get(color) if isinstance(players, dict) else {}) or {};
        if str(info.get("user_id") or "") == str(user_id):
            return color;
    return None;

def apply_terminal_result(snapshot: EngineBoard, candidate: dict[str, Any]) -> EngineBoard:
    """Add the game result after an action removes one or both kings.""";
    board = snapshot.get("board");
    if not isinstance(board, dict):
        return snapshot;
    result = snapshot.get("result");
    result = result if isinstance(result, dict) else {};
    if (result.get("status") or STATUS_ACTIVE) != STATUS_ACTIVE:
        return snapshot;
    pieces = [piece for square, piece in board.items() if isinstance(square, str) and len(square) == 2];
    white = "wK" in pieces;
    black = "bK" in pieces;
    if white and black:
        return snapshot;
    if not white and not black:
        reason = "Draw: both kings eliminated in the same action (cannon)." if _is_cannon(candidate) else "Draw: both kings eliminated in the same action.";
        result = {"status": STATUS_DRAW, "winner": WINNER_DRAW, "reason": reason};
    elif white:
        result = {"status": STATUS_FINISHED, "winner": "w", "reason": "White wins — enemy king eliminated."};
    else:
        result = {"status": STATUS_FINISHED, "winner": "b", "reason": "Black wins — enemy king eliminated."};
    return {**snapshot, "result": result, "winner": result["winner"]};

def _is_cannon(candidate: dict[str, Any]) -> bool:
    """Return whether a terminal action was caused by a cannon shot.""";
    if str(candidate.get("kind") or "").strip().lower() == "shoot":
        return True;
    return any(
        str(event.get("action") or "").strip().lower() in {"canon_shot", "cannon_shot"}
        for event in candidate.get("events") or []
        if isinstance(event, dict)
    );

def _clean_board(value: Any) -> dict[str, str]:
    """Keep only occupied board squares from a native-engine snapshot.""";
    board = value if isinstance(value, dict) else {};
    return {
        square: piece
        for square, piece in board.items()
        if isinstance(square, str)
        and len(square) == 2
        and square[0] in "abcdefgh"
        and square[1] in "12345678"
        and isinstance(piece, str)
        and piece
    };

__all__ = ["ChezzGame", "apply_terminal_result", "player_color_for"];
