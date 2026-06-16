from __future__ import annotations;

import http.client;
import json;
import os;
import queue;
import select as _select;
import ssl;

from dataclasses import dataclass;
from typing import Any;
from urllib.parse import urlencode, urlparse;

class SupabaseError(RuntimeError):

    def __init__(self, status: int, message: str) -> None:
        """Initialize the Supabase error with HTTP status and message.""";
        super().__init__(message);
        self.status = status;
        self.message = message;

@dataclass(frozen=True)
class SupabaseConfig:
    url: str;
    service_role_key: str;

    @classmethod
    def from_env(cls) -> "SupabaseConfig | None":
        """Load Supabase config from environment variables.""";
        url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/");
        service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip();
        if not url or not service_role_key:
            return None;
        parsed = urlparse(url);
        if parsed.scheme != "https" or not parsed.hostname:
            raise RuntimeError("SUPABASE_URL must be a valid HTTPS URL.");
        return cls(url=url, service_role_key=service_role_key);

class SupabaseStore:
    _POOL_SIZE = 8;
    _CHECKOUT_TIMEOUT = 10.0;  # pool wait budget
    _CONN_TIMEOUT = 5.0;  # per-request socket deadline

    def __init__(self, config: SupabaseConfig) -> None:
        """Prime a bounded queue of keep-alive HTTP connections to Supabase.""";
        self._config = config;
        parsed = urlparse(config.url);
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("Supabase connections require HTTPS.");
        self._host = parsed.hostname or "";
        self._port = parsed.port or 443;
        self._base_path = parsed.path.rstrip("/");
        self._pool: queue.Queue[
            http.client.HTTPConnection | http.client.HTTPSConnection
        ] = queue.Queue(maxsize=self._POOL_SIZE);
        for _ in range(self._POOL_SIZE):
            self._pool.put_nowait(self._make_conn());

    @property
    def base_url(self) -> str:
        """Return the Supabase base URL.""";
        return self._config.url;

    def _make_conn(self) -> http.client.HTTPSConnection | http.client.HTTPConnection:
        """Allocate a verified TLS connection honoring store timeouts.""";
        ctx = ssl.create_default_context();
        return http.client.HTTPSConnection(
            self._host,
            self._port,
            timeout=self._CONN_TIMEOUT,
            context=ctx,
        );

    def _is_conn_alive(self, conn: http.client.HTTPConnection | http.client.HTTPSConnection) -> bool:
        """Return whether a pooled connection is still usable.""";
        sock = getattr(conn, "sock", None);
        if sock is None:
            return True;  # lazy connect path
        try:
            fd = sock.fileno();
        except OSError:
            return False;
        if fd < 0:
            return False;
        try:
            r, _, x = _select.select([sock], [], [sock], 0);
            return not r and not x;  # readable/error set implies stale socket
        except OSError:
            return False;

    def select(self,
               table: str,
               *,
               columns: str = "*",
               filters: dict[str, tuple[str, Any] | Any] | None = None,
               order: str | None = None,
               limit: int | None = None) -> list[dict[str, Any]]:
        """Select rows from one Supabase table.""";
        params: dict[str, str] = {"select": columns};
        if order:
            params["order"] = order;
        if limit is not None:
            params["limit"] = str(limit);
        self._apply_filters(params, filters);
        response = self._request("GET", f"/rest/v1/{table}", query=params);
        if not isinstance(response, list):
            raise SupabaseError(502, "Unexpected response from Supabase");
        return response;

    def select_one(self,
                   table: str,
                   *,
                   columns: str = "*",
                   filters: dict[str, tuple[str, Any] | Any] | None = None,
                   order: str | None = None) -> dict[str, Any] | None:
        """Select the first row from one Supabase table.""";
        rows = self.select(table, columns=columns, filters=filters, order=order, limit=1);
        if not rows:
            return None;
        return rows[0];

    def insert(self,
               table: str,
               data: dict[str, Any] | list[dict[str, Any]],
               *,
               returning: str = "representation") -> list[dict[str, Any]]:
        """Insert rows into one Supabase table.""";
        headers = {"Prefer": f"return={returning}"};
        response = self._request(
            "POST",
            f"/rest/v1/{table}",
            body=data,
            headers=headers,
        );
        if returning == "minimal":
            return [];
        if not isinstance(response, list):
            raise SupabaseError(502, "Unexpected insert response from Supabase");
        return response;

    def update(self,
               table: str,
               data: dict[str, Any],
               *,
               filters: dict[str, tuple[str, Any] | Any] | None = None,
               returning: str = "representation") -> list[dict[str, Any]]:
        """Update rows in one Supabase table.""";
        params: dict[str, str] = {};
        self._apply_filters(params, filters);
        headers = {"Prefer": f"return={returning}"};
        response = self._request(
            "PATCH",
            f"/rest/v1/{table}",
            query=params,
            body=data,
            headers=headers,
        );
        if returning == "minimal":
            return [];
        if not isinstance(response, list):
            raise SupabaseError(502, "Unexpected update response from Supabase");
        return response;

    def delete(self,
               table: str,
               *,
               filters: dict[str, tuple[str, Any] | Any] | None = None,
               returning: str = "representation") -> list[dict[str, Any]]:
        """Delete rows from one Supabase table.""";
        params: dict[str, str] = {};
        self._apply_filters(params, filters);
        headers = {"Prefer": f"return={returning}"};
        response = self._request(
            "DELETE",
            f"/rest/v1/{table}",
            query=params,
            headers=headers,
        );
        if returning == "minimal":
            return [];
        if not isinstance(response, list):
            raise SupabaseError(502, "Unexpected delete response from Supabase");
        return response;

    def rpc(self, function_name: str, params: dict[str, Any] | None = None) -> Any:
        """Call one Supabase RPC.""";
        if not function_name:
            raise ValueError("function_name is required");
        return self._request(
            "POST",
            f"/rest/v1/rpc/{function_name}",
            body=params or {},
        );

    def _apply_filters(self,
                       params: dict[str, str],
                       filters: dict[str, tuple[str, Any] | Any] | None) -> None:
        """Apply filters.""";
        for key, raw_value in (filters or {}).items():
            if isinstance(raw_value, tuple):
                if len(raw_value) != 2:
                    raise ValueError(f"Invalid filter tuple for {key}");
                op, value = raw_value;
            else:
                op, value = "eq", raw_value;
            encoded = self._encode_in_filter_value(value) if op == "in" else self._encode_filter_value(value);
            params[key] = f"{op}.{encoded}";

    def _encode_in_filter_value(self, values: Any) -> str:
        """Encode a PostgREST ``in.(...)`` operand from a finite value collection.""";
        if not isinstance(values, (list, tuple, set, frozenset)) or not values:
            raise ValueError("in filter requires at least one value");
        encoded: list[str] = [];
        for value in values:
            text = self._encode_filter_value(value);
            if any(char in text for char in ',()"\\'):
                text = f'"{text.replace(chr(92), chr(92) * 2).replace(chr(34), chr(92) + chr(34))}"';
            encoded.append(text);
        return f"({','.join(encoded)})";

    def _encode_filter_value(self, value: Any) -> str:
        """Encode one PostgREST filter value.""";
        if value is None:
            return "null";
        if isinstance(value, bool):
            return "true" if value else "false";
        return str(value);

    def _request(self,
                 method: str,
                 path: str,
                 *,
                 query: dict[str, str] | None = None,
                 body: dict[str, Any] | list[dict[str, Any]] | None = None,
                 headers: dict[str, str] | None = None) -> Any:
        """Send one Supabase HTTP request.""";
        full_path = f"{self._base_path}{path}";
        if query:
            full_path = f"{full_path}?{urlencode(query, doseq=True)}";

        request_headers = {
            "apikey": self._config.service_role_key,
            "Authorization": f"Bearer {self._config.service_role_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Connection": "keep-alive",
        };
        if headers:
            request_headers.update(headers);

        payload = b"";
        if body is not None:
            payload = json.dumps(body).encode("utf-8");
            request_headers["Content-Length"] = str(len(payload));

        try:
            conn = self._pool.get(timeout=self._CHECKOUT_TIMEOUT);
        except queue.Empty:
            raise SupabaseError(503, "Supabase connection pool exhausted; try again shortly.");

        if not self._is_conn_alive(conn):
            try:
                conn.close();
            except Exception:
                pass;
            conn = self._make_conn();

        holder: list[
            http.client.HTTPConnection | http.client.HTTPSConnection
        ] = [conn];  # swap target on transport retry
        try:
            return self._send(holder, method, full_path, request_headers, payload);
        finally:
            self._pool.put_nowait(holder[0]);

    def _send(self,
              holder: list[http.client.HTTPConnection | http.client.HTTPSConnection],
              method: str,
              path: str,
              headers: dict[str, str],
              payload: bytes,
              *,
              _retry: bool = True) -> Any:

        conn = holder[0];
        try:
            conn.request(method, path, body=payload or None, headers=headers);
            resp = conn.getresponse();
            raw = resp.read().decode("utf-8");
            status = resp.status;
        except Exception as exc:
            try:
                conn.close();
            except Exception:
                pass;
            if _retry:
                holder[0] = self._make_conn();
                return self._send(holder, method, path, headers, payload, _retry=False);
            raise SupabaseError(503, f"Unable to reach Supabase: {exc}") from exc;

        if status >= 400:
            message = (
                self._extract_error_message(raw) or f"Supabase request failed: HTTP {status}"
            );
            raise SupabaseError(status, message);

        if not raw:
            return None;
        return json.loads(raw);

    def _extract_error_message(self, raw: str) -> str | None:
        """Extract an error message.""";
        text = (raw or "").strip();
        if not text:
            return None;
        try:
            payload = json.loads(text);
        except json.JSONDecodeError:
            return text;
        if isinstance(payload, dict):
            for key in ("message", "error_description", "error", "hint", "details"):
                value = payload.get(key);
                if value:
                    return str(value);
        return text;
