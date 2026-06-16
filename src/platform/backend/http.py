from __future__ import annotations;

import signal;
import threading;
from pathlib import Path;
from typing import Any;
from urllib.parse import urlparse;

from src.platform.backend.request_context import (
    resolve_game_type_from_headers,
    resolve_shell_game_id,
);
from src.platform.backend.app import GamesApp;
from src.platform.backend.http_base import (
    RouteSpec,
    _build_handler,
);
from src.platform.backend.static_shell import PLATFORM_FRONTEND;
from src.pool.runtime import api as pool_handlers;
from src.chezz.runtime import api as chezz_handlers;
from src.platform.backend.query import query_int as _query_int_shared, query_str as _query_str_shared;
from src.platform.backend.sse import run_realtime_sse_stream;

def _social_game_id(service: GamesApp, user_id: str, game_id: str | None, game_type: str) -> str:
    """Use the explicit game id or the selected runtime's resumable game.""";
    return str(game_id or "").strip() or service.runtime(game_type).active_game(user_id);

def _base_get_routes() -> dict[str, RouteSpec]:
    """Return shared authenticated read routes.""";
    return {
        "/api/profile/stats": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, _query, game_type: service.auth.profile_stats(user.id, game_type),
        ),
        "/api/players/online": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, query, game_type: service.matchmaking.players_online(
                user,
                game_type,
                touch_presence=query.get("touch_presence", ["1"])[0] != "0",
            ),
        ),
        "/api/bot/profile": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, _query, game_type: service.auth.bot_profile(game_type),
        ),
        "/api/matchmaking/status": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, _query, game_type: service.matchmaking.matchmaking_status(user.id, game_type),
        ),
        "/api/chat": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, query, game_type: service.social.chat_messages(
                user.id,
                int(query.get("since_id", [None])[0]) if query.get("since_id", [None])[0] else None,
                game_id=_social_game_id(service, user.id, str(query.get("game_id", [None])[0] or "").strip() or None, game_type),
            ),
        ),
        "/api/chat/queue": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, query, _selected: service.social.queue_status_for_client(
                user.id,
                str(query.get("game_id", [None])[0] or "").strip() or None,
            ),
        ),
    };

def _base_post_routes() -> dict[str, RouteSpec]:
    """Return shared authenticated write routes.""";
    return {
        "/api/profile/update": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, body, _selected: service.auth.update_profile(user.id, body.get("username", ""), body.get("photo_url")),
        ),
        "/api/chat": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, body, game_type: service.social.post_chat_message(
                user,
                body.get("message", ""),
                game_id=_social_game_id(service, user.id, str((body or {}).get("game_id") or "").strip() or None, game_type),
            ),
        ),
        "/api/presence/ping": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, _body, game_type: service.matchmaking.ping_presence(user, game_type),
        ),
        "/api/matchmaking/join": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, _body, game_type: service.matchmaking.matchmaking_join(user, game_type),
        ),
        "/api/matchmaking/cancel": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, _body, game_type: service.matchmaking.matchmaking_cancel(user.id, game_type),
        ),
    };

def _shared_get_routes() -> dict[str, RouteSpec]:
    """Return shared GET routes.""";
    return {
        "/api/active-pvp-game": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, _query, game_type: service.matchmaking.active_pvp_game(user.id, game_type),
        ),
        "/api/leaderboard": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, _query, game_type: {"leaderboard": service.auth.leaderboard(game_type)},
        ),
        "/api/invite/status": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, _query, game_type: service.matchmaking.invite_status(user.id, game_type),
        ),
        "/api/runtime/metrics": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, _query, _selected: service.runtime_metrics(user.id),
        ),
    };

def _shared_post_routes() -> dict[str, RouteSpec]:
    """Return shared POST routes.""";
    return {
        "/api/new-game": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, body, game_type: service.matchmaking.new_game(
                user.id,
                game_type,
                (body or {}).get("mode"),
                body or {},
            ),
        ),
        "/api/game/surrender": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, body, _selected: service.social.surrender(
                user.id,
                game_id=str((body or {}).get("game_id") or ""),
                cause=str((body or {}).get("cause") or "").strip() or None,
            ),
        ),
        "/api/game/draw-offer": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, body, game_type: service.social.offer_draw(
                user,
                game_id=_social_game_id(service, user.id, str((body or {}).get("game_id") or "") or None, game_type),
            ),
        ),
        "/api/game/draw-respond": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, body, game_type: service.social.respond_draw(
                user,
                game_id=_social_game_id(service, user.id, str((body or {}).get("game_id") or "") or None, game_type),
                offer_id=int((body or {}).get("offer_id") or 0),
                accept=bool((body or {}).get("accept"))
                if "accept" in (body or {})
                else str((body or {}).get("decision") or "").lower() == "accept",
            ),
        ),
        "/api/game/rematch-offer": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, body, _selected: service.social.offer_rematch(
                user,
                game_id=str((body or {}).get("game_id") or "") or None,
            ),
        ),
        "/api/game/rematch-respond": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, body, _selected: service.social.respond_rematch(
                user,
                game_id=str((body or {}).get("game_id") or "") or None,
                offer_id=int((body or {}).get("offer_id") or 0),
                accept=bool((body or {}).get("accept"))
                if "accept" in (body or {})
                else str((body or {}).get("decision") or "").lower() == "accept",
            ),
        ),
        "/api/invite/create": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, _body, game_type: service.matchmaking.invite_create(user.id, game_type),
        ),
        "/api/invite/join": RouteSpec(
            requires_auth=True,
            handler=lambda service, user, body, game_type: service.matchmaking.invite_join(
                user.id,
                game_type,
                (body or {}).get("code") or "",
            ),
        ),
    };

def _state_handler(service: Any, user: Any, query: dict[str, list[str]], _selected: str) -> dict[str, Any]:
    """Return game state after one DB-backed membership check.""";
    game_id = _query_str_shared(query, "game_id") or "";
    row = service.database.require_game_member(user.id, game_id);
    return service.runtime(str(row["game_type"])).load_state(user.id, str(row["id"]));

def _replay_handler(service: Any, user: Any, query: dict[str, list[str]], _selected: str) -> dict[str, Any]:
    """Return replay after one DB-backed membership check.""";
    game_id = _query_str_shared(query, "game_id") or "";
    row = service.database.require_game_member(user.id, game_id);
    return service.runtime(str(row["game_type"])).replay(
        user.id,
        str(row["id"]),
        _query_str_shared(query, "include_events") == "1",
    );

def _realtime_stream_handler(handler: Any, service: Any, user: Any, query: dict[str, list[str]], _selected: str) -> None:
    """Route SSE to Pool or Chezz gameplay subscribe (do not let one game overwrite the other).""";
    game_id = _query_str_shared(query, "game_id") or "";
    row = service.database.require_game_member(user.id, game_id);
    runtime = service.runtime(str(row["game_type"]));
    since_seq = _query_int_shared(query, "since_seq");
    run_realtime_sse_stream(
        handler,
        subscribe_fn=lambda game_id, cursor, wait: runtime.subscribe(user.id, game_id, cursor, wait),
        user_id=str(user.id),
        game_id=str(row["id"]),
        since_seq=since_seq,
    );

def _merge_get_routes() -> dict[str, RouteSpec]:
  """Merge GET routes.""";
  return {
    **_base_get_routes(),
    **_shared_get_routes(),
    **{
        "/api/state": RouteSpec(requires_auth=True, handler=_state_handler),
        "/api/replay": RouteSpec(requires_auth=True, handler=_replay_handler),
        "/api/realtime/stream": RouteSpec(
            requires_auth=True,
            handler=lambda _service, _user, _query, _selected: {"ok": True},
            stream_handler=_realtime_stream_handler,
        ),
      },
  };

def _merge_post_routes() -> dict[str, RouteSpec]:
    """Merge POST routes.""";
    return {
        **_base_post_routes(),
        **_shared_post_routes(),
        **pool_handlers.routes(),
        **chezz_handlers.routes(),
    };

def run_games_server(
    host: str,
    port: int,
    service: GamesApp,
    *,
    web_dir: Path | None = None,
) -> None:
    """Run the games server.""";
    platform_dir = web_dir or PLATFORM_FRONTEND;
    get_routes = _merge_get_routes();
    post_routes = _merge_post_routes();

    base_handler = _build_handler(
        service=service,
        web_dir=platform_dir,
        platform_web_dir=platform_dir,
        game_id="pool",
        server_version="GamesHTTP/1.0",
        session_cookie_name="games_session",
        get_routes=get_routes,
        post_routes=post_routes,
    );

    class GamesHandler(base_handler):

        def _selected_game_type(self) -> str:
            """Resolve lobby game selection from request headers and cookies.""";
            return resolve_game_type_from_headers(self.headers);

        def _serve_composed_index(self) -> None:
            """Serve the composed SPA shell for the selected game.""";
            parsed = urlparse(self.path);
            shell_game_id = resolve_shell_game_id(
                path=parsed.path,
                query=parsed.query,
                headers=self.headers,
            );
            from src.platform.backend.static_shell import compose_index_html;

            body = compose_index_html(
                game_id=shell_game_id,
                game_web_dir=platform_dir,
            ).encode("utf-8");
            self.send_response(200);
            self.send_header("Content-Type", "text/html; charset=utf-8");
            self.send_header("Content-Length", str(len(body)));
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate");
            self.send_header("Pragma", "no-cache");
            self.send_header("X-MM-Game-Id", shell_game_id);
            self.end_headers();
            self.wfile.write(body);

        def _serve_composed_index_head(self) -> None:
            """Serve headers for the composed SPA shell.""";
            parsed = urlparse(self.path);
            shell_game_id = resolve_shell_game_id(
                path=parsed.path,
                query=parsed.query,
                headers=self.headers,
            );
            from src.platform.backend.static_shell import compose_index_html;

            body = compose_index_html(game_id=shell_game_id, game_web_dir=platform_dir).encode("utf-8");
            self.send_response(200);
            self.send_header("Content-Type", "text/html; charset=utf-8");
            self.send_header("Content-Length", str(len(body)));
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate");
            self.send_header("Pragma", "no-cache");
            self.send_header("X-MM-Game-Id", shell_game_id);
            self.end_headers();

    from http.server import ThreadingHTTPServer;

    class GamesHttpServer(ThreadingHTTPServer):
        """Stop request threads promptly during server shutdown.""";

        daemon_threads = True;
        allow_reuse_address = True;

    server = GamesHttpServer((host, port), GamesHandler);
    print(f"Serving Mind Midas Games at http://{host}:{port}");
    previous_handlers: dict[int, Any] = {};

    def stop_server(_signum: int, _frame: Any) -> None:
        """Request graceful shutdown without blocking inside a signal handler.""";
        threading.Thread(target=server.shutdown, daemon=True).start();

    if threading.current_thread() is threading.main_thread():
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous_handlers[signum] = signal.signal(signum, stop_server);
    try:
        server.serve_forever();
    finally:
        for signum, previous in previous_handlers.items():
            signal.signal(signum, previous);
        server.server_close();
        service.close();
