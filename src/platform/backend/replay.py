from __future__ import annotations;

import json;
from typing import Any;

def coerce_snapshot(value: Any) -> dict[str, Any] | None:
    """Normalize a snapshot field that may be a dict or JSON string.""";
    if isinstance(value, dict):
        return value;
    if isinstance(value, str):
        text = value.strip();
        if not text:
            return None;
        try:
            parsed = json.loads(text);
        except json.JSONDecodeError:
            return None;
        return parsed if isinstance(parsed, dict) else None;
    return None;
