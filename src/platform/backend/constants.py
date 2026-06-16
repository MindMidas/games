from __future__ import annotations;

import re;

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$");
PASSWORD_MIN_LEN = 8;
DEFAULT_SESSION_TTL_DAYS = 7;
DEFAULT_ONLINE_PRESENCE_SECONDS = 40;
