from __future__ import annotations;

from dataclasses import dataclass;

@dataclass(frozen=True)
class AuthUser:
    id: str;
    username: str;
    photo_url: str | None;
