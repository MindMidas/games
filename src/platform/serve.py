#!/usr/bin/env python3

from __future__ import annotations;

import argparse;
import logging;
import os;
import sys;
from pathlib import Path;

WORKSPACE_ROOT = Path(__file__).resolve().parents[2];
SRC_ROOT = WORKSPACE_ROOT / "src";
POOL_ENGINE = SRC_ROOT / "pool" / "engine";
CHEZZ_ENGINE = SRC_ROOT / "chezz" / "engine";

if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT));
if str(POOL_ENGINE) not in sys.path:
    sys.path.insert(0, str(POOL_ENGINE));
if str(CHEZZ_ENGINE) not in sys.path:
    sys.path.insert(0, str(CHEZZ_ENGINE));

from src.platform.env import load_dotenv;
from src.platform.backend.app import GamesApp;
from src.platform.backend.http import run_games_server;
from src.platform.security_config import validate_bind_safety, validate_production_security;

def main() -> None:
    """Parse CLI args, load env, and start the games HTTP server.""";
    load_dotenv(WORKSPACE_ROOT / ".env");
    default_host = os.environ.get("HOST", "127.0.0.1");
    default_port = int(os.environ.get("PORT", os.environ.get("GAMES_PORT", "8080")));
    parser = argparse.ArgumentParser(description="Mind Midas Games (Pool + Chezz)");
    parser.add_argument("--host", default=default_host);
    parser.add_argument("--port", default=default_port, type=int);
    args = parser.parse_args();

    logging.basicConfig(
        level=getattr(logging, os.environ.get("GAMES_LOG_LEVEL", "INFO").upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    );
    validate_production_security();
    validate_bind_safety(args.host);

    try:
        import phylib; # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            "Pool engine not built. Run: make -C src/pool/engine",
        ) from exc;

    try:
        service = GamesApp(SRC_ROOT);
    except RuntimeError as exc:
        raise SystemExit(f"Startup failed: {exc}") from exc;

    run_games_server(
        args.host,
        args.port,
        service,
        web_dir=SRC_ROOT / "platform" / "frontend",
    );

if __name__ == "__main__":
    main();
