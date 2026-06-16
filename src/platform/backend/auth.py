from __future__ import annotations;

import hashlib;
import hmac;
import secrets;
import uuid;
from datetime import UTC, datetime, timedelta;
from typing import Any;

from src.platform.security_config import is_allowed_photo_url;

from .contracts import RuntimeDatabase;
from .errors import ServiceError;
from .models import AuthUser;
from .constants import PASSWORD_MIN_LEN, USERNAME_RE;

# Hard upper bound on accepted password length. The minimum is enforced by
# fed into PBKDF2 (240k iterations) and amplifying CPU cost per auth request.
MAX_PASSWORD_LEN = 1024;
REGISTRATION_CONFLICT_MESSAGE = "Unable to create account with those details";

def _reject_oversized_password(password: str | None) -> None:
    """Reject unbounded passwords before any hashing work is done.""";
    if len(str(password or "")) > MAX_PASSWORD_LEN:
        raise ServiceError(400, "Password is too long");

def _reject_disallowed_photo(photo_url: str | None) -> None:
    """Validate an optional avatar URL against the shared server-side allowlist.""";
    text = str(photo_url or "").strip();
    if not text:
        return;
    if not is_allowed_photo_url(text):
        raise ServiceError(400, "Photo URL is not allowed");

def _escape_ilike_exact_pattern(value: str) -> str:
    """Escape ilike exact pattern.""";
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    );

class AuthService:
    """Account, profile, session, and leaderboard operations.""";

    def __init__(self, database: RuntimeDatabase, auth_pepper: str, *, session_ttl_days: int, online_presence_seconds: int) -> None:

        self.database = database;
        self._auth_pepper = auth_pepper;
        self._session_ttl_days = session_ttl_days;
        self._online_presence_seconds = online_presence_seconds;

    def _normalize_username(self, value: str) -> str:
        """Normalize username.""";
        username = str(value or "").strip();
        if not USERNAME_RE.match(username):
            raise ServiceError(400, "Username must be 3-20 chars: letters, numbers, underscore");
        return username;

    def _normalize_password(self, value: str, allow_short: bool = False) -> str:
        """Normalize password.""";
        password = str(value or "");
        if not password:
            raise ServiceError(400, "Password is required");
        if not allow_short and len(password) < PASSWORD_MIN_LEN:
            raise ServiceError(400, f"Password must be at least {PASSWORD_MIN_LEN} characters");
        return password;

    def _normalize_photo(self, value: str | None) -> str | None:
        """Normalize photo.""";
        photo = str(value or "").strip();
        if not photo:
            return None;
        if len(photo) > 500:
            raise ServiceError(400, "Photo URL is too long");
        if not is_allowed_photo_url(photo):
            raise ServiceError(400, "Photo URL is not allowed");
        return photo;

    def _public_user(self, row: dict[str, Any]) -> dict[str, Any]:
        """Return a public user payload.""";
        return {"id": row["id"], "username": row["username"], "photo_url": row.get("photo_url")};

    def _iso_datetime(self, value: datetime) -> str:
        """Format a datetime for JSON.""";
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z");

    def _parse_iso_datetime(self, value: str) -> datetime:
        """Parse an ISO datetime.""";
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC);

    def _find_user_by_username_ci(self, username: str) -> dict[str, Any] | None:
        """Find a user by case-insensitive username.""";
        escaped = _escape_ilike_exact_pattern(username);
        rows = self.database.select(
            "app_users",
            filters={"username": ("ilike", escaped)},
            limit=25,
        );
        key = username.lower();
        matches = [
            r
            for r in rows
            if isinstance(r, dict) and str(r.get("username", "")).lower() == key
        ];
        if len(matches) == 1:
            return matches[0];
        return None;

    def register(self,
                 username: str,
                 password: str,
                 photo_url: str | None) -> dict[str, Any]:
        """Register a new user.""";
        _reject_oversized_password(password);
        _reject_disallowed_photo(photo_url);
        normalized_username = self._normalize_username(username);
        normalized_password = self._normalize_password(password);
        normalized_photo = self._normalize_photo(photo_url);

        existing = self.database.select_one("app_users", filters={"username": normalized_username});
        if existing is not None:
            raise ServiceError(409, REGISTRATION_CONFLICT_MESSAGE);
        existing_ci = self._find_user_by_username_ci(normalized_username);
        if existing_ci is not None:
            raise ServiceError(409, REGISTRATION_CONFLICT_MESSAGE);

        salt = secrets.token_hex(16);
        password_hash = self._hash_password(normalized_password, salt);
        user_id = str(uuid.uuid4());

        try:
            self.database.insert(
                "app_users",
                {
                    "id": user_id,
                    "username": normalized_username,
                    "password_hash": password_hash,
                    "password_salt": salt,
                    "photo_url": normalized_photo,
                },
            );
        except ServiceError as exc:
            if exc.status == 409:
                raise ServiceError(409, REGISTRATION_CONFLICT_MESSAGE) from exc;
            raise;

        token, session = self._create_session(user_id);
        return {
            "user": self._public_user(
                {
                    "id": user_id,
                    "username": normalized_username,
                    "photo_url": normalized_photo,
                }
            ),
            "_session_token": token,
            "session_expires_at": session["expires_at"],
        };

    def login(self, username: str, password: str) -> dict[str, Any]:
        """Log in a user.""";
        _reject_oversized_password(password);
        normalized_username = self._normalize_username(username);
        normalized_password = self._normalize_password(password, allow_short=True);

        user = self.database.select_one("app_users", filters={"username": normalized_username});
        if user is None:
            user = self._find_user_by_username_ci(normalized_username);
        if user is None:
            raise ServiceError(401, "Invalid username or password");

        expected_hash = self._hash_password(normalized_password, user["password_salt"]);
        if not hmac.compare_digest(expected_hash, user["password_hash"]):
            raise ServiceError(401, "Invalid username or password");

        token, session = self._create_session(user["id"]);
        return {
            "user": self._public_user(user),
            "_session_token": token,
            "session_expires_at": session["expires_at"],
        };

    def update_profile(self,
                       user_id: str,
                       username: str,
                       photo_url: str | None) -> dict[str, Any]:
        """Update a user profile.""";
        current = self.database.select_one("app_users", filters={"id": user_id});
        if current is None:
            raise ServiceError(404, "User not found");

        _reject_disallowed_photo(photo_url);
        normalized_username = self._normalize_username(username);
        normalized_photo = self._normalize_photo(photo_url);

        existing = self.database.select_one("app_users", filters={"username": normalized_username});
        if existing is not None and existing.get("id") != user_id:
            raise ServiceError(409, "Username is already taken");

        updated_rows = self.database.update(
            "app_users",
            {
                "username": normalized_username,
                "photo_url": normalized_photo,
            },
            filters={"id": user_id},
        );
        updated_user = (
            updated_rows[0]
            if updated_rows
            else {"id": user_id, "username": normalized_username, "photo_url": normalized_photo}
        );

        # Profiles are never copied into other tables; username/photo are joined from app_users on read.
        return {"user": self._public_user(updated_user)};

    def profile_stats(self, user_id: str, game_type: str) -> dict[str, Any]:
        """Return profile stats.""";
        rec = self.database.rpc(
            "app_user_record",
            {"p_user_id": user_id, "p_game_type": game_type},
        );
        if isinstance(rec, list):
            row = rec[0] if rec else None;
        elif isinstance(rec, dict):
            row = rec;
        else:
            row = None;
        if not isinstance(row, dict):
            return {
                "wins": 0,
                "draws": 0,
                "losses": 0,
            };
        return {
            "wins": max(0, int(row.get("wins", 0) or 0)),
            "draws": max(0, int(row.get("draws", 0) or 0)),
            "losses": max(0, int(row.get("losses", 0) or 0)),
        };

    def leaderboard(self, game_type: str) -> list[dict[str, Any]]:
        """Fetch leaderboard rows via RPC for this installation's game_type key.""";
        rows = self.database.rpc("app_leaderboard", {"p_game_type": game_type});
        if not isinstance(rows, list):
            return [];
        records: list[dict[str, Any]] = [];
        for row in rows:
            if not isinstance(row, dict):
                continue;
            user_id = str(row.get("user_id") or "").strip();
            if not user_id:
                continue;
            if user_id == "engine" and game_type == "pool":
                continue;
            records.append(
                {
                    "user_id": user_id,
                    "username": row.get("username") or "",
                    "photo_url": row.get("photo_url"),
                    "wins": max(0, int(row.get("wins", 0) or 0)),
                    "draws": max(0, int(row.get("draws", 0) or 0)),
                    "losses": max(0, int(row.get("losses", 0) or 0)),
                },
            );
        return records;

    def logout(self, session_token: str | None) -> dict[str, Any]:
        """Revoke one session token when present.""";
        if not session_token:
            return {"ok": True};

        token_hash = self._hash_session_token(session_token);
        self.database.delete(
            "app_sessions",
            filters={"token_hash": token_hash},
            returning="minimal",
        );
        return {"ok": True};

    def me(self, session_token: str | None) -> dict[str, Any]:
        """Return me.""";
        user = self._require_user(session_token);
        return {"user": {"id": user.id, "username": user.username, "photo_url": user.photo_url}};

    def authenticate(self, session_token: str | None) -> AuthUser:
        """Authenticate a session token.""";
        return self._require_user(session_token);

    def _require_user(self, session_token: str | None) -> AuthUser:
        """Require user.""";
        if not session_token:
            raise ServiceError(401, "Authentication required");

        token_hash = self._hash_session_token(session_token);
        session = self.database.select_one("app_sessions", filters={"token_hash": token_hash});
        if session is None:
            raise ServiceError(401, "Invalid session");

        expires_at = self._parse_iso_datetime(session["expires_at"]);
        if expires_at <= datetime.now(UTC):
            self.database.delete(
                "app_sessions",
                filters={"id": session["id"]},
                returning="minimal",
            );
            raise ServiceError(401, "Session expired");

        user = self.database.select_one("app_users", filters={"id": session["user_id"]});
        if user is None:
            raise ServiceError(401, "User not found");

        return AuthUser(
            id=user["id"],
            username=user["username"],
            photo_url=user.get("photo_url"),
        );

    def _create_session(self, user_id: str) -> tuple[str, dict[str, Any]]:
        """Create session.""";
        self.database.delete(
            "app_sessions",
            filters={"user_id": user_id},
            returning="minimal",
        );

        token = secrets.token_urlsafe(32);
        session = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "token_hash": self._hash_session_token(token),
            "expires_at": self._iso_datetime(
                datetime.now(UTC) + timedelta(days=self._session_ttl_days)
            ),
        };
        self.database.insert("app_sessions", session);
        return token, session;

    def _hash_password(self, password: str, salt: str) -> str:
        """Hash password.""";
        material = f"{salt}:{self._auth_pepper}".encode("utf-8");
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), material, 240_000);
        return digest.hex();

    def _hash_session_token(self, token: str) -> str:
        """Hash session token.""";
        return hashlib.sha256(f"{token}:{self._auth_pepper}".encode("utf-8")).hexdigest();

    def user_profile(self, user_id: str) -> dict[str, Any]:
        """Load one public player profile.""";
        row = self.database.select_one("app_users", columns="id,username,photo_url", filters={"id": user_id});
        if not row:
            raise ServiceError(404, "Player not found");
        return row;

    def bot_profile(self, game_type: str) -> dict[str, Any]:
        """Return the Chezz engine profile.""";
        from src.chezz.runtime.contracts import ENGINE_USER_ID, ENGINE_USERNAME;
        if game_type != "chezz":
            raise ServiceError(404, "Not found");
        row = self.user_profile(ENGINE_USER_ID);
        return {"user": {"id": row["id"], "username": row.get("username") or ENGINE_USERNAME, "photo_url": row.get("photo_url")}};

__all__ = ["AuthService", "MAX_PASSWORD_LEN"];
