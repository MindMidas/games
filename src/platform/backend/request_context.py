from __future__ import annotations;

import re;
from typing import Any;
from urllib.parse import parse_qs;

VALID_GAME_TYPES = frozenset({"pool", "chezz"});
SHELL_GAME_IDS = frozenset({"pool", "chezz", "hub"});
_UUID_GROUP = r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
_GAME_PATH_TYPED_RE = re.compile(
    rf"^/game/(pool|chezz)/({_UUID_GROUP})$",
    re.I,
);

def _game_from_cookie(headers: Any) -> str:
    """Return the selected game stored in the shell cookie.""";
    if headers is None or not hasattr(headers, "get"):
        return "";
    cookie = str(headers.get("Cookie") or "");
    for chunk in cookie.split(";"):
        key, _, value = chunk.strip().partition("=");
        if key == "mm_selected_game":
            game_type = value.strip().lower();
            if game_type in VALID_GAME_TYPES:
                return game_type;
    return "";

def resolve_game_type_from_headers(headers: Any) -> str:
    """Resolve selected game from request header, cookie, then Pool fallback.""";
    if headers is None:
        return "pool";
    header_game_type = str(headers.get("X-MM-Game") or headers.get("x-mm-game") or "").strip().lower();
    if header_game_type in VALID_GAME_TYPES:
        return header_game_type;
    cookie_game_type = _game_from_cookie(headers);
    if cookie_game_type:
        return cookie_game_type;
    return "pool";

def parse_game_path(path: str) -> tuple[str | None, str | None]:
    """Parse `/game/{pool|chezz}/{uuid}` into `(game_type, game_id)`.""";
    normalized_path = str(path or "").rstrip("/") or "/";
    typed = _GAME_PATH_TYPED_RE.match(normalized_path);
    if typed:
        game_type = str(typed.group(1) or "").strip().lower();
        game_id = str(typed.group(2) or "").strip();
        if game_type in VALID_GAME_TYPES and game_id:
            return game_type, game_id;
        return None, None;
    return None, None;

def game_id_from_path(path: str) -> str | None:
    """Extract UUID from a game URL path.""";
    _game_type, game_id = parse_game_path(path);
    return game_id;

def resolve_shell_game_id(
    *,
    path: str,
    query: str,
    headers: Any,
) -> str:
    """Pick composed HTML shell: hub for login/menu, otherwise pool/chezz.""";
    normalized_path = str(path or "").rstrip("/") or "/";
    if normalized_path in ("/", "/menu"):
        return "hub";

    path_game_type, _game_id = parse_game_path(normalized_path);
    if path_game_type in VALID_GAME_TYPES:
        return path_game_type;

    qs = parse_qs(str(query or ""), keep_blank_values=False);
    game_q = (qs.get("game") or [""])[0].strip().lower();
    if game_q in VALID_GAME_TYPES:
        return game_q;

    cookie_game_type = _game_from_cookie(headers);
    if cookie_game_type:
        return cookie_game_type;

    hdr = str(headers.get("X-MM-Game") or headers.get("x-mm-game") or "").strip().lower() if headers else "";
    if hdr in VALID_GAME_TYPES:
        return hdr;

    return "pool";
