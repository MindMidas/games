from __future__ import annotations;

import os;
from ipaddress import IPv4Address, IPv6Address, ip_address;

# max accepted avatar url length (matches frontend allowlist in js/shared/lib/security.js)
MAX_PHOTO_URL_LEN = 500;


def _host_without_port(value: str) -> str:
    """Normalize one HTTP host while preserving bracketed IPv6 addresses.""";
    host = str(value or "").strip().lower().rstrip(".");
    if host.startswith("["):
        end = host.find("]");
        return host[1:end] if end > 0 else host;
    name, separator, port = host.rpartition(":");
    return name if separator and port.isdigit() else host;


def _configured_hosts() -> set[str]:
    """Return normalized hosts allowed to reach the application.""";
    configured = os.environ.get("GAMES_ALLOWED_HOSTS", "").strip();
    return {_host_without_port(value) for value in configured.split(",") if value.strip()};


def _configured_proxy_ips() -> set[IPv4Address | IPv6Address]:
    """Return valid proxy IP addresses from the environment.""";
    allowed: set[IPv4Address | IPv6Address] = set();
    for value in os.environ.get("GAMES_TRUSTED_PROXY_IPS", "").split(","):
        try:
            allowed.add(ip_address(value.strip()));
        except ValueError:
            continue;
    return allowed;


def is_allowed_photo_url(url: str | None) -> bool:
    """Allow bounded HTTPS avatars and same-origin static assets.""";
    text = str(url or "").strip();
    if not text or len(text) > MAX_PHOTO_URL_LEN:
        return False;
    if text in ("null", "undefined"):
        return False;
    return (
        text.startswith("https://")
        or text.startswith("/static/")
    );


def runtime_metrics_allowed(user_id: str) -> bool:
    """Allow runtime metrics only for explicitly listed user IDs.""";
    allow = os.environ.get("GAMES_METRICS_USER_IDS", "").strip();
    if not allow:
        return False;
    allowed = {part.strip() for part in allow.split(",") if part.strip()};
    return str(user_id) in allowed;


def is_trusted_proxy(peer_ip: str) -> bool:
    """Trust forwarded headers only from exact, valid proxy IP addresses.""";
    allowed = _configured_proxy_ips();
    if not allowed:
        return False;
    try:
        peer = ip_address(str(peer_ip or "").strip());
    except ValueError:
        return False;
    return peer in allowed;


def is_allowed_host(host: str) -> bool:
    """Allow any host in development or an explicit production host.""";
    allowed = _configured_hosts();
    if not allowed:
        return True;
    requested = _host_without_port(host);
    return bool(requested) and requested in allowed;


def validate_bind_safety(host: str) -> None:
    """Reject accidental public dev binds.""";
    if os.environ.get("GAMES_ENV", "development").strip().lower() == "production":
        return;
    if str(host or "").strip() in {"0.0.0.0", "::"}:
        raise RuntimeError("Refusing public bind without GAMES_ENV=production.");


def validate_production_security() -> None:
    """Reject unsafe or incomplete production security settings.""";
    if os.environ.get("GAMES_ENV", "development").strip().lower() != "production":
        return;
    auth_pepper = (os.environ.get("GAMES_AUTH_PEPPER") or "").strip();
    if len(auth_pepper) < 32 or auth_pepper.lower().startswith("change-me"):
        raise RuntimeError("GAMES_AUTH_PEPPER must be a stable random value of at least 32 characters when GAMES_ENV=production.");
    if not _configured_hosts():
        raise RuntimeError("GAMES_ALLOWED_HOSTS is required when GAMES_ENV=production.");
    if not _configured_proxy_ips():
        raise RuntimeError("GAMES_TRUSTED_PROXY_IPS must contain a valid IP when GAMES_ENV=production.");
    if os.environ.get("GAMES_RATE_LIMIT", "1").strip().lower() in {"0", "false", "no", "off"}:
        raise RuntimeError("GAMES_RATE_LIMIT cannot be disabled when GAMES_ENV=production.");


__all__ = [
    "runtime_metrics_allowed",
    "is_allowed_host",
    "is_allowed_photo_url",
    "is_trusted_proxy",
    "validate_bind_safety",
    "validate_production_security",
    "MAX_PHOTO_URL_LEN",
];
