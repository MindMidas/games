from __future__ import annotations;

import json;
import logging;
import mimetypes;
import os;
from dataclasses import dataclass;
from http.cookies import SimpleCookie;
from http.server import SimpleHTTPRequestHandler;
from pathlib import Path;
from typing import Any, Callable;
from urllib.parse import parse_qs, urlparse;

from src.platform.rate_limit import (
    AUTH_LIMITER,
    GET_LIMITER,
    INVITE_LIMITER,
    MM_LIMITER,
    POST_LIMITER,
    SSE_CONNECTIONS,
    SSE_LIMITER,
    rate_limit_enabled,
);
from src.platform.security_config import is_allowed_host, is_trusted_proxy;
from src.platform.backend import ServiceError;
from src.platform.backend.static_shell import (
    compose_index_html,
    resolve_static_file,
);

MAX_JSON_BODY_BYTES = 16 * 1024;
SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
REQUEST_SOCKET_TIMEOUT_SECONDS = 30;
SECURE_SESSION_COOKIE_NAME = "__Host-games_session";
LOGGER = logging.getLogger(__name__);

def _service_error_payload(exc: ServiceError) -> dict[str, Any]:
    """Serialize service errors for API responses.""";
    payload: dict[str, Any] = {"error": exc.message};
    if exc.extra:
        payload.update(exc.extra);
    return payload;
CSP_POLICY = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'; "
    "object-src 'none'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data: https:; "
    "connect-src 'self'; "
    "form-action 'self'"
);
PERMISSIONS_POLICY = (
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()"
);

_CLIENT_SOCKET_GONE = (
    BrokenPipeError,
    ConnectionResetError,
    ConnectionAbortedError,
);  # client aborted fetch mid-response

_SPA_SHELL_EXACT = frozenset({"/", "/lobby", "/matchmaking", "/404", "/not-found"});

def _should_serve_spa_index(path: str) -> bool:
    """Return True when GET should serve the composed SPA (client router handles the screen).""";
    normalized = path.rstrip("/") or "/";
    if normalized in _SPA_SHELL_EXACT:
        return True;
    if normalized.startswith("/game/"):
        return True;
    if normalized.startswith("/api/") or normalized.startswith("/static/"):
        return False;
    leaf = normalized.rsplit("/", 1)[-1];
    if "." in leaf:
        return False;
    return len(normalized) > 1;

class ApiError(Exception):

    def __init__(self, status: int, message: str) -> None:

        super().__init__(message);
        self.status = status;
        self.message = message;

@dataclass(frozen=True)
class RouteSpec:
    requires_auth: bool;
    handler: Callable[[Any, Any | None, dict[str, Any], str], dict[str, Any]];
    stream_handler: Callable[[Any, Any, Any | None, dict[str, Any], str], None] | None = None;

def _build_handler(*,
                   service: Any,
                   web_dir: Path,
                   platform_web_dir: Path,
                   game_id: str,
                   server_version: str,
                   session_cookie_name: str,
                   get_routes: dict[str, RouteSpec],
                   post_routes: dict[str, RouteSpec]):
    """Build the concrete HTTP handler with pinned service dependencies.""";
    http_server_version = server_version;
    web_dirs = [web_dir.resolve(), platform_web_dir.resolve()];

    class Handler(SimpleHTTPRequestHandler):
        server_version = http_server_version;
        sys_version = "";

        def __init__(self, *args, **kwargs):

            try:
                super().__init__(*args, directory=str(web_dir), **kwargs);
            except _CLIENT_SOCKET_GONE:
                return;  # partial request line before disconnect

        def setup(self) -> None:
            """Apply a finite socket timeout before parsing request headers.""";
            super().setup();
            self.connection.settimeout(REQUEST_SOCKET_TIMEOUT_SECONDS);

        def _send_static_cache_headers(self, file_path: Path) -> None:
            """Discourage stale ES module graphs for game JS/CSS assets.""";
            if file_path.suffix.lower() in {".js", ".mjs", ".css"}:
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate");
                self.send_header("Pragma", "no-cache");

        def _serve_file(self, file_path: Path) -> None:
            """Serve a file from disk with standard static headers.""";
            with open(file_path, "rb") as handle:
                stat = os.fstat(handle.fileno());
                self.send_response(200);
                ctype = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream";
                self.send_header("Content-Type", ctype);
                self.send_header("Content-Length", str(stat.st_size));
                self.send_header("Last-Modified", self.date_time_string(stat.st_mtime));
                self._send_static_cache_headers(file_path);
                self.end_headers();
                self.copyfile(handle, self.wfile);

        def _serve_file_head(self, file_path: Path) -> None:
            """Send file headers only (for HEAD requests).""";
            with open(file_path, "rb") as handle:
                stat = os.fstat(handle.fileno());
                self.send_response(200);
                ctype = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream";
                self.send_header("Content-Type", ctype);
                self.send_header("Content-Length", str(stat.st_size));
                self.send_header("Last-Modified", self.date_time_string(stat.st_mtime));
                self._send_static_cache_headers(file_path);
                self.end_headers();

        def _serve_composed_index(self) -> None:
            """Serve composed SPA HTML for shell routes and ``index.html``.""";
            body = compose_index_html(game_id=game_id, game_web_dir=web_dir).encode("utf-8");
            self.send_response(200);
            self.send_header("Content-Type", "text/html; charset=utf-8");
            self.send_header("Content-Length", str(len(body)));
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate");
            self.send_header("Pragma", "no-cache");
            self.send_header("X-MM-Game-Id", game_id);
            self.end_headers();
            self.wfile.write(body);

        def _serve_composed_index_head(self) -> None:
            """Send composed SPA headers only (for HEAD requests).""";
            body = compose_index_html(game_id=game_id, game_web_dir=web_dir).encode("utf-8");
            self.send_response(200);
            self.send_header("Content-Type", "text/html; charset=utf-8");
            self.send_header("Content-Length", str(len(body)));
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate");
            self.send_header("Pragma", "no-cache");
            self.send_header("X-MM-Game-Id", game_id);
            self.end_headers();

        def _serve_import_map(self) -> None:
            """Serve ES module import map (external file - CSP allows script-src 'self').""";
            from src.platform.backend.static_shell import (
                GAME_SHELL_META,
                build_import_map_json,
            );
            meta = GAME_SHELL_META.get(game_id) or GAME_SHELL_META["pool"];
            body = build_import_map_json(str(web_dir.resolve()), meta["js_bust"]).encode("utf-8");
            self.send_response(200);
            self.send_header("Content-Type", "application/importmap+json; charset=utf-8");
            self.send_header("Content-Length", str(len(body)));
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate");
            self.send_header("Pragma", "no-cache");
            self.end_headers();
            self.wfile.write(body);

        def _serve_static(self, rel_path: str) -> None:
            """Resolve static assets from game frontend first, then platform frontend.""";
            if rel_path in {"", "index.html"}:
                self._serve_composed_index();
                return;
            clean = rel_path.split("?", 1)[0].split("#", 1)[0];
            if clean == "static/games/import-map.json":
                self._serve_import_map();
                return;
            resolved = resolve_static_file(web_dirs, rel_path);
            if resolved is None:
                self.send_error(404, "Not Found");
                return;
            self._serve_file(resolved);

        def _serve_static_head(self, rel_path: str) -> None:
            """Serve HEAD for static assets (no body).""";
            if rel_path in {"", "index.html"}:
                self._serve_composed_index_head();
                return;
            clean = rel_path.split("?", 1)[0].split("#", 1)[0];
            if clean == "static/games/import-map.json":
                from src.platform.backend.static_shell import (
                    GAME_SHELL_META,
                    build_import_map_json,
                );
                meta = GAME_SHELL_META.get(game_id) or GAME_SHELL_META["pool"];
                body = build_import_map_json(str(web_dir.resolve()), meta["js_bust"]).encode("utf-8");
                self.send_response(200);
                self.send_header("Content-Type", "application/importmap+json; charset=utf-8");
                self.send_header("Content-Length", str(len(body)));
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate");
                self.send_header("Pragma", "no-cache");
                self.end_headers();
                return;
            resolved = resolve_static_file(web_dirs, rel_path);
            if resolved is None:
                self.send_error(404, "Not Found");
                return;
            self._serve_file_head(resolved);

        def end_headers(self) -> None:
            """Append hardened browser headers before completing the response prelude.""";
            self.send_header("X-Content-Type-Options", "nosniff");
            self.send_header("X-Frame-Options", "DENY");
            self.send_header("Referrer-Policy", "same-origin");
            self.send_header("Cross-Origin-Resource-Policy", "same-origin");
            self.send_header("Cross-Origin-Opener-Policy", "same-origin");
            self.send_header("Permissions-Policy", PERMISSIONS_POLICY);
            self.send_header("Content-Security-Policy", CSP_POLICY);
            if self._request_is_secure():
                self.send_header(
                    "Strict-Transport-Security",
                    "max-age=31536000; includeSubDomains",
                );
            super().end_headers();

        def do_GET(self) -> None:
            """Dispatch GET traffic across health checks, auth probes, APIs, and static files.""";
            parsed = urlparse(self.path);
            raw_path = parsed.path;
            path = raw_path.rstrip("/") or "/";
            query = parse_qs(parsed.query);

            try:
                self._enforce_allowed_host();
                if path == "/api/health":
                    self._json_response(200, {"ok": True});
                    return;
                if path == "/api/ready":
                    self._json_response(200, service.readiness());
                    return;

                if path == "/api/auth/me":
                    self._enforce_get_rate_limit(path);
                    payload = service.auth.me(self._session_token());
                    self._json_response(200, payload);
                    return;

                if path == "/api/auth/session":
                    self._enforce_get_rate_limit(path);
                    token = self._session_token();
                    try:
                        payload = service.auth.me(token);
                        self._json_response(
                            200,
                            {"authenticated": True, "user": payload["user"]},
                        );
                    except ServiceError as exc:
                        if exc.status == 401:
                            self._json_response(
                                200,
                                {"authenticated": False, "user": None},
                            );
                        else:
                            raise;
                    return;

                route = get_routes.get(path);
                if route is not None:
                    self._enforce_get_rate_limit(path);
                    user = self._require_user() if route.requires_auth else None;
                    if route.stream_handler is not None:
                        connection_key = f"sse-connection:{self._client_ip()}";
                        if rate_limit_enabled() and not SSE_CONNECTIONS.acquire(connection_key):
                            raise ApiError(429, "Too many realtime connections.");
                        try:
                            route.stream_handler(self, service, user, query, self._selected_game_type());
                        finally:
                            if rate_limit_enabled():
                                SSE_CONNECTIONS.release(connection_key);
                        return;
                    self._json_response(200, route.handler(service, user, query, self._selected_game_type()));
                    return;

                if _should_serve_spa_index(path):
                    self._serve_composed_index();
                    return;
                rel_path = raw_path.lstrip("/");
                if rel_path == "index.html":
                    self._serve_composed_index();
                    return;
                self._serve_static(rel_path);
            except ValueError:
                self._json_response(400, {"error": "Invalid query parameter"});
            except ServiceError as exc:
                self._json_response(exc.status, _service_error_payload(exc));
            except ApiError as exc:
                self._json_response(exc.status, {"error": exc.message});
            except _CLIENT_SOCKET_GONE:
                return;
            except Exception:
                LOGGER.exception("Unhandled GET request failure for %s", path);
                self._json_response(500, {"error": "Internal server error"});

        def do_HEAD(self) -> None:
            """Dispatch HEAD traffic (mirrors GET routing but omits the body).""";
            parsed = urlparse(self.path);
            raw_path = parsed.path;
            path = raw_path.rstrip("/") or "/";

            try:
                self._enforce_allowed_host();
                if _should_serve_spa_index(path):
                    self._serve_composed_index_head();
                    return;
                rel_path = raw_path.lstrip("/");
                if rel_path == "index.html":
                    self._serve_composed_index_head();
                    return;
                self._serve_static_head(rel_path);
            except ApiError as exc:
                self.send_error(exc.status, exc.message);
            except _CLIENT_SOCKET_GONE:
                return;
            except Exception:
                LOGGER.exception("Unhandled HEAD request failure for %s", path);
                self.send_error(500, "Internal server error");

        def do_POST(self) -> None:
            """Parse JSON bodies for POST APIs with CSRF-oriented origin enforcement.""";
            raw_path = urlparse(self.path).path;
            path = raw_path.rstrip("/") or "/";
            try:
                self._enforce_allowed_host();
                self._enforce_same_origin_post();
                self._enforce_rate_limit(path);
                payload = self._json_payload();
                response = self._dispatch_post(path, payload);
                status = response.get("_status", 200);
                headers = response.get("_headers", []);
                body = response.get("_body", response);
                self._json_response(status, body, extra_headers=headers);
            except json.JSONDecodeError:
                self._json_response(400, {"error": "Invalid JSON body"});
            except ValueError:
                self._json_response(400, {"error": "Invalid request value"});
            except ServiceError as exc:
                self._json_response(exc.status, _service_error_payload(exc));
            except ApiError as exc:
                self._json_response(exc.status, {"error": exc.message});
            except _CLIENT_SOCKET_GONE:
                return;
            except Exception:
                LOGGER.exception("Unhandled POST request failure for %s", path);
                self._json_response(500, {"error": "Internal server error"});

        def list_directory(self, path):
            """Disable directory listings.""";
            self.send_error(404, "Not Found");
            return None;

        def _dispatch_post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
            """Dispatch authenticated and unauthenticated POST endpoints.""";
            if path == "/api/auth/register":
                result = service.auth.register(
                    payload.get("username", ""),
                    payload.get("password", ""),
                    payload.get("photo_url"),
                );
                token = result.pop("_session_token", None) or result.pop("session_token", None);
                if not token:
                    raise ApiError(500, "Session token missing");
                return {
                    "_headers": [("Set-Cookie", self._build_session_cookie(token))],
                    "_body": result,
                };

            if path == "/api/auth/login":
                result = service.auth.login(
                    payload.get("username", ""),
                    payload.get("password", ""),
                );
                token = result.pop("_session_token", None) or result.pop("session_token", None);
                if not token:
                    raise ApiError(500, "Session token missing");
                return {
                    "_headers": [("Set-Cookie", self._build_session_cookie(token))],
                    "_body": result,
                };

            if path == "/api/auth/logout":
                service.auth.logout(self._session_token());
                return {
                    "_headers": [
                        ("Set-Cookie", value)
                        for value in self._clear_session_cookies()
                    ],
                    "_body": {"ok": True},
                };

            route = post_routes.get(path);
            if route is None:
                raise ApiError(404, f"Unknown endpoint: {path!r}");

            user = self._require_user() if route.requires_auth else None;
            return route.handler(service, user, payload, self._selected_game_type());

        def _selected_game_type(self) -> str:
            """Return the selected game for shared lobby routes.""";
            return "pool";

        def _require_user(self):
            """Resolve the cookie token into an authenticated user.""";
            token = self._session_token();
            return service.auth.authenticate(token);

        def _session_token(self) -> str | None:
            """Return the configured session cookie value, if present.""";
            raw_cookie = self.headers.get("Cookie", "");
            if not raw_cookie:
                return None;

            cookie = SimpleCookie();
            cookie.load(raw_cookie);
            morsel = cookie.get(SECURE_SESSION_COOKIE_NAME) or cookie.get(session_cookie_name);
            if morsel is None:
                return None;
            return morsel.value or None;

        def _build_session_cookie(self, token: str) -> str:
            """Build the authenticated session cookie.""";
            cookie = SimpleCookie();
            name = SECURE_SESSION_COOKIE_NAME if self._request_is_secure() else session_cookie_name;
            cookie[name] = token;
            cookie[name]["path"] = "/";
            cookie[name]["max-age"] = str(SESSION_MAX_AGE_SECONDS);
            cookie[name]["httponly"] = True;
            cookie[name]["samesite"] = "Lax";
            if name == SECURE_SESSION_COOKIE_NAME:
                cookie[name]["secure"] = True;
            return cookie.output(header="").strip();

        def _clear_session_cookie(self, name: str) -> str:
            """Build one immediately-expiring session cookie.""";
            cookie = SimpleCookie();
            cookie[name] = "";
            cookie[name]["path"] = "/";
            cookie[name]["max-age"] = "0";
            cookie[name]["httponly"] = True;
            cookie[name]["samesite"] = "Lax";
            if name == SECURE_SESSION_COOKIE_NAME:
                cookie[name]["secure"] = True;
            return cookie.output(header="").strip();

        def _clear_session_cookies(self) -> list[str]:
            """Expire both the secure production cookie and local development cookie.""";
            return [
                self._clear_session_cookie(SECURE_SESSION_COOKIE_NAME),
                self._clear_session_cookie(session_cookie_name),
            ];

        def _request_is_secure(self) -> bool:
            """Infer HTTPS termination from trusted forwarded headers.""";
            forwarded_proto = self.headers.get("X-Forwarded-Proto", "");
            if forwarded_proto and self._peer_is_trusted_proxy():
                return forwarded_proto.split(",")[0].strip().lower() == "https";
            return False;

        def _expected_origin(self) -> str | None:
            """Return the same-origin value expected for browser POSTs.""";
            host = (self.headers.get("Host") or "").strip();
            if not host:
                return None;
            scheme = "https" if self._request_is_secure() else "http";
            return f"{scheme}://{host}";

        def _client_ip(self) -> str:
            """Return the direct peer or trusted proxy's forwarded client address.""";
            forwarded = (self.headers.get("X-Forwarded-For") or "").strip();
            if forwarded and self._peer_is_trusted_proxy():
                return forwarded.split(",")[0].strip() or "unknown";
            host = self.client_address[0] if self.client_address else "";
            return str(host or "unknown");

        def _peer_is_trusted_proxy(self) -> bool:
            """Return whether this socket peer may supply forwarded headers.""";
            host = self.client_address[0] if self.client_address else "";
            return is_trusted_proxy(str(host or ""));

        def _enforce_allowed_host(self) -> None:
            """Reject Host headers outside the configured production domain list.""";
            if not is_allowed_host(self.headers.get("Host", "")):
                raise ApiError(421, "Misdirected request");

        def _enforce_rate_limit(self, path: str) -> None:
            """Apply endpoint-specific POST rate limits.""";
            if not rate_limit_enabled():
                return;
            ip = self._client_ip();
            if path in ("/api/auth/login", "/api/auth/register"):
                if not AUTH_LIMITER.allow(f"auth:{ip}"):
                    raise ApiError(429, "Too many requests. Try again later.");
                return;
            if path == "/api/matchmaking/join":
                if not MM_LIMITER.allow(f"mm:{ip}"):
                    raise ApiError(429, "Too many requests. Try again later.");
                return;
            if path == "/api/invite/join":
                if not INVITE_LIMITER.allow(f"invite:{ip}"):
                    raise ApiError(429, "Too many invite attempts. Try again later.");
                return;
            if not POST_LIMITER.allow(f"post:{ip}"):
                raise ApiError(429, "Too many requests. Try again later.");

        def _enforce_get_rate_limit(self, path: str) -> None:
            """Limit API reads and stricter realtime reconnect attempts.""";
            if not rate_limit_enabled():
                return;
            ip = self._client_ip();
            if path == "/api/realtime/stream":
                if not SSE_LIMITER.allow(f"sse:{ip}"):
                    raise ApiError(429, "Too many realtime connection attempts.");
                return;
            if not GET_LIMITER.allow(f"get:{ip}"):
                raise ApiError(429, "Too many requests. Try again later.");

        def _enforce_same_origin_post(self) -> None:
            """Reject cross-origin browser POSTs before parsing JSON.""";
            expected = self._expected_origin();
            if not expected:
                raise ApiError(400, "Missing Host header");
            origin = (self.headers.get("Origin") or "").strip();
            if origin:
                if origin.rstrip("/") != expected.rstrip("/"):
                    raise ApiError(403, "Cross-origin POST blocked");
                return;
            referer = (self.headers.get("Referer") or "").strip();
            if referer:
                base = expected.rstrip("/");
                if referer.rstrip("/") == base or referer.startswith(base + "/"):
                    return;
                raise ApiError(403, "Cross-origin POST blocked");
            raise ApiError(403, "Missing Origin header");

        def _json_payload(self) -> dict[str, Any]:
            """Read a bounded JSON request body.""";
            content_length = int(self.headers.get("Content-Length", "0"));
            if content_length == 0:
                return {};
            if content_length < 0:
                raise ApiError(400, "Invalid content length");
            if content_length > MAX_JSON_BODY_BYTES:
                raise ApiError(413, "JSON payload too large");

            content_type = self.headers.get("Content-Type", "");
            if content_type and "application/json" not in content_type:
                raise ApiError(415, "Content-Type must be application/json");

            raw = self.rfile.read(content_length).decode("utf-8");
            payload = json.loads(raw);
            if not isinstance(payload, dict):
                raise ApiError(400, "JSON body must be an object");
            return payload;

        def _json_response(self,
                           status: int,
                           payload: dict[str, Any],
                           extra_headers: list[tuple[str, str]] | None = None) -> None:
            """Write one JSON response.""";
            data = json.dumps(payload).encode("utf-8");
            self.send_response(status);
            self.send_header("Content-Type", "application/json; charset=utf-8");
            self.send_header("Content-Length", str(len(data)));
            self.send_header("Cache-Control", "no-store");
            for key, value in extra_headers or []:
                self.send_header(key, value);
            self.end_headers();
            self.wfile.write(data);

    return Handler;
