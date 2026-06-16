from __future__ import annotations;

import copy;
import logging;
from collections import Counter;
from pathlib import Path;
from typing import Any;

from src.platform.backend import ServiceError;

_log = logging.getLogger(__name__);

from ._native import BestMoveAdapter, UserActionsAdapter;
from .contracts import AnimationEvent, EngineBoard, LegalAction, MoveSummary;

class ChezzEngine:
    """Clean runtime boundary around private native Chezz adapters.""";

    def __init__(self, project_root: Path) -> None:

        self._actions = UserActionsAdapter(project_root);
        self._best_move = BestMoveAdapter(project_root);

    def legal_moves(self, engine_board: EngineBoard) -> list[LegalAction]:
        """Return compact legal actions for the current snapshot.""";
        return self._actions.actions_for_snapshot(dict(engine_board));

    @staticmethod
    def snapshot_as_turn(snapshot: EngineBoard, turn: str) -> EngineBoard:
        """Clone a snapshot and force `header.turn` for premove generation.""";
        snap = copy.deepcopy(snapshot) if isinstance(snapshot, dict) else {};
        header = snap.get("header");
        if not isinstance(header, dict):
            header = {};
            snap["header"] = header;
        t = "b" if str(turn).lower().strip() == "b" else "w";
        header["turn"] = t;
        return snap;

    def legal_moves_if_turn(self, snapshot: EngineBoard, turn: str) -> list[LegalAction]:
        """Return legal actions as if `turn` were active.""";
        return self.legal_moves(self.snapshot_as_turn(snapshot, turn));

    def premove_actions_by_color(self, snapshot: EngineBoard) -> dict[str, list[LegalAction]]:
        """Return premove candidates for both colors.""";
        if not isinstance(snapshot, dict):
            return {"w": [], "b": []};
        out: dict[str, list[LegalAction]] = {};
        for color in ("w", "b"):
            try:
                out[color] = self.legal_moves_if_turn(snapshot, color);
            except Exception as exc:
                _log.warning("premove_actions for %s failed: %s", color, exc, exc_info=True);
                raise;
        return out;

    def apply_move(
        self,
        engine_board: EngineBoard,
        from_sq: str | None,
        to_sq: str | None,
        kind: str,
        *,
        square: str | None = None,
        direction: str | None = None,
        catapult: str | None = None,
        payload: str | None = None,
        target: str | None = None,
    ) -> tuple[EngineBoard, list[AnimationEvent], MoveSummary]:
        """Resolve request fields to one native candidate.""";
        candidates = self._actions.candidates_for_snapshot(dict(engine_board));
        match = _find_candidate(
            candidates,
            kind,
            from_sq,
            to_sq,
            square,
            direction,
            catapult,
            payload,
            target,
        );
        if match is None:
            raise ServiceError(400, "not legal");
        return self.apply_candidate(engine_board, match);

    def apply_candidate(
        self,
        engine_board: EngineBoard,
        candidate: dict[str, Any],
    ) -> tuple[EngineBoard, list[AnimationEvent], MoveSummary]:
        """Unpack one matched candidate into snapshot, events, and summary.""";
        snapshot = candidate.get("snapshot");
        if not isinstance(snapshot, dict):
            raise ServiceError(500, "chezz.engine: candidate is missing snapshot");
        events: list[AnimationEvent] = list(candidate.get("events") or []);
        summary = _build_move_summary(engine_board, snapshot, candidate);
        return snapshot, events, summary;

    def engine_move(self, engine_board: EngineBoard) -> dict[str, Any]:
        """Choose the native best move and return its candidate envelope.""";
        target = self._best_move.best_move_snapshot(dict(engine_board));
        target_board = target.get("board") or {};
        for candidate in self._actions.candidates_for_snapshot(dict(engine_board)):
            action_key = str(candidate.get("action_key") or "").strip();
            if not action_key:
                continue;
            applied, _, _ = self.apply_candidate(engine_board, candidate);
            if (applied.get("board") or {}) == target_board:
                return candidate;
        raise ServiceError(500, "chezz.engine: best-move did not match any candidate action_key");

def _find_candidate(
    candidates: list[dict[str, Any]],
    kind: str,
    from_sq: str | None,
    to_sq: str | None,
    square: str | None,
    direction: str | None,
    catapult: str | None,
    payload: str | None,
    target: str | None,
) -> dict[str, Any] | None:
    """Pick the candidate matching normalized kind and coordinates.""";
    norm_kind = str(kind or "").lower();
    norm_dir = str(direction or "").lower();
    for cand in candidates:
        if str(cand.get("kind") or "") != norm_kind:
            continue;
        if norm_kind == "move":
            if (str(cand.get("from") or "") == str(from_sq or "")
                    and str(cand.get("to") or "") == str(to_sq or "")):
                return cand;
        elif norm_kind == "shoot":
            if (str(cand.get("square") or "") == str(square or "")
                    and str(cand.get("direction") or "").lower() == norm_dir):
                return cand;
        elif norm_kind == "fling":
            if (str(cand.get("catapult") or "") == str(catapult or "")
                    and str(cand.get("payload") or "") == str(payload or "")
                    and str(cand.get("target") or "") == str(target or "")):
                return cand;
    return None;

def _build_move_summary(
    engine_board: EngineBoard,
    next_snapshot: EngineBoard,
    candidate: dict[str, Any],
) -> MoveSummary:
    """Diff before/after occupancy maps into MoveSummary lists.""";
    before_map: dict[str, str] = dict((engine_board or {}).get("board") or {});
    after_map: dict[str, str] = dict((next_snapshot or {}).get("board") or {});

    before_counts = Counter(before_map.values());
    after_counts = Counter(after_map.values());
    captured: list[str] = [];
    spawned: list[str] = [];
    for code in set(before_counts) | set(after_counts):
        delta = after_counts[code] - before_counts[code];
        if delta < 0:
            captured.extend([code] * (-delta));
        elif delta > 0:
            spawned.extend([code] * delta);

    transformed: list[str] = [
        after_map[sq]
        for sq in (set(before_map) & set(after_map))
        if before_map[sq] != after_map[sq]
    ];

    kind = str(candidate.get("kind") or "");
    piece = "";
    if kind == "move":
        piece = str(before_map.get(str(candidate.get("from") or "")) or "");
    elif kind == "shoot":
        piece = str(before_map.get(str(candidate.get("square") or "")) or "");
    elif kind == "fling":
        piece = str(before_map.get(str(candidate.get("payload") or "")) or "");

    summary: MoveSummary = {
        "kind": kind,
        "from_": str(
            candidate.get("from")
            or candidate.get("square")
            or candidate.get("catapult")
            or ""
        ),
        "to": str(candidate.get("to") or candidate.get("target") or ""),
        "piece": piece,
        "captured": sorted(captured),
        "spawned": sorted(spawned),
        "transformed": sorted(transformed),
        "destroyed": [],
        "notation": str(candidate.get("action_key") or ""),
    };
    return summary;

__all__ = [
    "ChezzEngine",
];
