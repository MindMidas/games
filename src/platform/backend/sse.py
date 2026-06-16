from __future__ import annotations;

import json;
from collections.abc import Callable;
from typing import Any;

from src.platform.backend import ServiceError;

_STREAM_WRITE_CLIENT_GONE = (
    BrokenPipeError,
    ConnectionResetError,
    ConnectionAbortedError,
);

def send_sse_event(handler: Any, event_name: str, payload: dict) -> None:
    """Send an SSE event.""";
    data = json.dumps(payload, separators=(",", ":"), default=str);
    chunk = f"event: {event_name}\ndata: {data}\n\n".encode();
    handler.wfile.write(chunk);
    handler.wfile.flush();

def run_realtime_sse_stream(
    handler: Any,
    *,
    subscribe_fn: Callable[[str, int, float], dict[str, Any]],
    user_id: str,
    game_id: str,
    since_seq: int | None,
) -> None:
    """Long-poll SSE: cursor + batched updates + per-chat frames.""";
    locked_game_id = str(game_id or "").strip();
    if not locked_game_id:
        try:
            send_sse_event(handler, "error", {"ok": False, "error": "game_id is required"});
        except _STREAM_WRITE_CLIENT_GONE:
            pass;
        return;

    handler.send_response(200);
    handler.send_header("Content-Type", "text/event-stream");
    handler.send_header("Cache-Control", "no-cache");
    handler.send_header("Connection", "keep-alive");
    handler.send_header("X-Accel-Buffering", "no");
    handler.end_headers();

    cursor = -1 if since_seq is None else int(since_seq);

    try:
        while True:
            payload = subscribe_fn(locked_game_id, cursor, 12.0);
            try:
                cursor = int(payload.get("last_seq", cursor));
            except (TypeError, ValueError):
                pass;

            send_sse_event(
                handler,
                "cursor",
                {
                    "ok": True,
                    "game_id": payload.get("game_id"),
                    "last_seq": payload.get("last_seq"),
                },
            );

            events = payload.get("events") or [];
            if isinstance(events, list) and events:
                send_sse_event(
                    handler,
                    "updates",
                    {
                        "ok": True,
                        "game_id": payload.get("game_id"),
                        "last_seq": payload.get("last_seq"),
                        "updates": events,
                    },
                );
                for ev in events:
                    if not isinstance(ev, dict):
                        continue;
                    if str(ev.get("type") or "") != "chat_message":
                        continue;
                    msg = ev.get("message");
                    if not isinstance(msg, dict):
                        continue;
                    send_sse_event(
                        handler,
                        "chat",
                        {
                            "ok": True,
                            "game_id": payload.get("game_id"),
                            "last_seq": payload.get("last_seq"),
                            "seq": ev.get("seq"),
                            "message": msg,
                        },
                    );
            else:
                handler.wfile.write(b": keepalive\n\n");
                handler.wfile.flush();
    except _STREAM_WRITE_CLIENT_GONE:
        return;
    except (ServiceError, RuntimeError, ValueError):
        try:
            send_sse_event(handler, "error", {"ok": False, "error": "Realtime stream failed"});
        except _STREAM_WRITE_CLIENT_GONE:
            pass;
