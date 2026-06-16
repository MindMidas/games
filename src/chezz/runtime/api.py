from __future__ import annotations;

import re;
from typing import Any;

from .contracts import MAX_ACTION_KEY_LENGTH, MAX_CLIENT_MOVE_ID_LENGTH, MoveRequest, SseEvent;
from src.platform.backend import ServiceError;
from src.platform.backend.http_base import RouteSpec;

_SQUARE_RE = re.compile(r"^[a-h][1-8]$", re.IGNORECASE);
_SHOOT_DIRECTIONS = frozenset({"tr", "tl", "br", "bl"});

def _require_game_membership(service: Any, user: Any, game_id: str) -> str:
    """Authoritative DB-backed check that ``user`` is a player in ``game_id``.

    The gameplay session cache (``get_or_hydrate``) only runs the per-user
    membership check on cold hydration. Once a session is warm, ``load_state`` /
    ``legal_moves`` / ``subscribe`` would otherwise return another player's game
    to any authenticated caller. This guard always hits the DB, so it cannot be
    bypassed by a pre-warmed session.
    """;
    return str(service.database.require_game_member(user.id, game_id)["id"]);

def _validate_square(value: str, *, field: str) -> str:
    """Validate one Chezz board square.""";
    sq = str(value or "").strip().lower();
    if not _SQUARE_RE.match(sq):
        raise ServiceError(400, f"Invalid square for {field}");
    return sq;

def _validate_shoot_direction(value: str) -> str:
    """Validate one cannon shot direction.""";
    direction = str(value or "").strip().lower();
    if direction not in _SHOOT_DIRECTIONS:
        raise ServiceError(400, "Invalid cannon shot direction");
    return direction;

def _parse_action_key(action_key: str) -> MoveRequest:
    """Parse one client action key into a session move request.""";
    if not action_key or not isinstance(action_key, str):
        raise ServiceError(400, "action_key is required");
    if len(action_key) > MAX_ACTION_KEY_LENGTH:
        raise ServiceError(400, "action_key is too long");
    kind, _, rest = action_key.partition(":");
    kind = kind.lower().strip();
    if kind == "move":
        f, _, t = rest.partition(">");
        return {
            "kind": "move",
            "from_": _validate_square(f, field="from"),
            "to": _validate_square(t, field="to"),
            "meta": {},
        };
    if kind == "shoot":
        sq, _, direction = rest.partition(":");
        square = _validate_square(sq, field="square");
        shot_direction = _validate_shoot_direction(direction);
        return {
            "kind": "shoot",
            "from_": square,
            "to": square,
            "meta": {"square": square, "direction": shot_direction},
        };
    if kind == "fling":
        catapult, _, payload_target = rest.partition(":");
        payload, _, target = payload_target.partition(">");
        cat = _validate_square(catapult, field="catapult");
        pay = _validate_square(payload, field="payload") if payload.strip() else cat;
        return {
            "kind": "fling",
            "from_": pay,
            "to": _validate_square(target, field="target"),
            "meta": {
                "catapult": cat,
                "payload": pay,
                "target": _validate_square(target, field="target"),
            },
        };
    raise ServiceError(400, f"Unknown action_key kind: {kind!r}");

def _build_move_request(body: dict[str, Any]) -> MoveRequest:
    """Validate the player move payload.""";
    game_id = str((body or {}).get("game_id") or "").strip();
    if not game_id:
        raise ServiceError(400, "game_id is required");
    action_key = str((body or {}).get("action_key") or "").strip();
    parsed = _parse_action_key(action_key);
    try:
        expected_seq = int(body.get("expected_seq", -1));
    except (TypeError, ValueError) as exc:
        raise ServiceError(400, "expected_seq must be an integer") from exc;
    client_move_id = str(body.get("client_move_id") or "").strip();
    if not client_move_id:
        raise ServiceError(400, "client_move_id is required");
    if len(client_move_id) > MAX_CLIENT_MOVE_ID_LENGTH:
        raise ServiceError(400, "client_move_id is too long");
    return {
        "game_id": game_id,
        "from_": parsed["from_"],
        "to": parsed["to"],
        "kind": parsed["kind"],
        "meta": parsed["meta"],
        "client_move_id": client_move_id,
        "expected_seq": expected_seq,
    };

def _submit_player_move(service: Any, user: Any, body: dict[str, Any]) -> SseEvent:
    """Submit one authenticated player move.""";
    move_request = _build_move_request(body or {});
    _require_game_membership(service, user, move_request["game_id"]);
    return service.runtime("chezz").submit_move(user.id, move_request=move_request);

def _play_engine_move(service: Any, user: Any, body: dict[str, Any]) -> SseEvent:
    """Submit one authenticated engine-turn request.""";
    game_id = str((body or {}).get("game_id") or "");
    _require_game_membership(service, user, game_id);
    return service.runtime("chezz").play_engine_move(user.id, game_id=game_id);

def _submit_move(service: Any, user: Any, body: dict[str, Any]) -> SseEvent:
    """Submit one player or engine move through the unified endpoint.""";
    if str((body or {}).get("actor") or "").strip().lower() == "engine":
        return _play_engine_move(service, user, body or {});
    return _submit_player_move(service, user, body or {});

def routes() -> dict[str, RouteSpec]:
    """Return Chezz-specific HTTP actions.""";
    return {
        "/api/move": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, body, _selected: _submit_move(service, user, body or {}),
        ),
    };
