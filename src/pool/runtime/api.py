from __future__ import annotations;

import math;
from typing import Any;

from src.platform.backend import ServiceError;
from src.platform.backend.http_base import RouteSpec;
from src.pool.runtime.contracts import ShotAccepted;

def _optional_float(raw: Any) -> float | None:
    """Parse an optional finite HTTP number.""";
    if raw is None:
        return None;
    text = str(raw).strip();
    if not text:
        return None;
    try:
        value = float(text);
    except (TypeError, ValueError):
        return None;
    return value if math.isfinite(value) else None;

def _request_float(raw: Any, *, field: str) -> float:
    """Parse one required finite HTTP number or raise a client error.""";
    if isinstance(raw, bool):
        raise ServiceError(400, f"{field} must be a finite number");
    value = _optional_float(raw);
    if value is None:
        raise ServiceError(400, f"{field} must be a finite number");
    return value;

def _optional_request_float(raw: Any, *, field: str) -> float | None:
    """Parse one optional finite HTTP number or raise when malformed.""";
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None;
    return _request_float(raw, field=field);

def _request_bool(raw: Any, *, field: str) -> bool:
    """Parse one explicit HTTP boolean without treating non-empty strings as true.""";
    if isinstance(raw, bool):
        return raw;
    if raw in (0, 1):
        return bool(raw);
    text = str(raw or "").strip().lower();
    if text in ("true", "1"):
        return True;
    if text in ("false", "0", ""):
        return False;
    raise ServiceError(400, f"{field} must be a boolean");

def _require_game_membership(service: Any, user: Any, game_id: str) -> str:
    """Authoritative DB-backed check that ``user`` is a player in ``game_id``.

    The gameplay session cache only runs the per-user membership check on cold
    hydration, so a warm session would otherwise expose another player's game
    (state / replay / live SSE). This guard always hits the DB and cannot be
    bypassed by a pre-warmed session.
    """;
    return str(service.database.require_game_member(user.id, game_id)["id"]);

def _pool_submit_shot(service: Any, user: Any, body: dict[str, Any]) -> ShotAccepted:
    """Submit one authenticated Pool shot.""";
    game_id = str((body or {}).get("game_id") or "");
    _require_game_membership(service, user, game_id);
    return service.runtime("pool").submit_shot(
        user.id,
        game_id=game_id,
        x_vel=_request_float((body or {}).get("x_vel"), field="x_vel"),
        y_vel=_request_float((body or {}).get("y_vel"), field="y_vel"),
        cue_x=_optional_request_float((body or {}).get("cue_x"), field="cue_x"),
        cue_y=_optional_request_float((body or {}).get("cue_y"), field="cue_y"),
        aim=(body or {}).get("aim") if isinstance((body or {}).get("aim"), dict) else None,
    );

def _pool_place_cue(service: Any, user: Any, body: dict[str, Any]) -> ShotAccepted:
    """Place or validate the cue ball for one authenticated player.""";
    game_id = str((body or {}).get("game_id") or "");
    _require_game_membership(service, user, game_id);
    return service.runtime("pool").place_cue(
        user.id,
        game_id=game_id,
        x=_request_float((body or {}).get("x"), field="x"),
        y=_request_float((body or {}).get("y"), field="y"),
        validate_only=_request_bool((body or {}).get("validate_only"), field="validate_only"),
    );

def routes() -> dict[str, RouteSpec]:
    """Return Pool-specific HTTP actions.""";
    return {
        "/api/shot": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, body, _selected: _pool_submit_shot(service, user, body or {}),
        ),
        "/api/place-cue": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, body, _selected: _pool_place_cue(service, user, body or {}),
        ),
    };
