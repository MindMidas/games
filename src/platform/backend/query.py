from __future__ import annotations;

def query_str(query: dict[str, list[str]], key: str) -> str | None:
    """Return one stripped query parameter, or None when absent.""";
    value = query.get(key, [None])[0];
    if value is None:
        return None;
    text = str(value).strip();
    return text or None;

def query_int(query: dict[str, list[str]], key: str) -> int | None:
    """Return one integer query parameter, or None when absent/invalid.""";
    value = query.get(key, [None])[0];
    if value is None:
        return None;
    text = str(value).strip();
    if not text:
        return None;
    try:
        return int(text);
    except (ValueError, TypeError):
        return None;
