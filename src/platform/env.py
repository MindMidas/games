from __future__ import annotations;

import os;
from pathlib import Path;

def load_dotenv(dotenv_path: Path) -> set[str]:
    """Parse a dotenv file and populate os.environ for keys not already set.""";
    loaded_keys: set[str] = set();
    if not dotenv_path.exists():
        return loaded_keys;

    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip();
        if not line or line.startswith("#"):
            continue;
        if line.startswith("export "):
            line = line[len("export ") :].strip();
        if "=" not in line:
            continue;

        key, value = line.split("=", 1);
        key = key.strip();
        if not key:
            continue;
        if key in os.environ:
            continue;  # never override an existing env var

        value = value.strip();
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1];  # strip matching quotes
        os.environ[key] = value;
        loaded_keys.add(key);

    return loaded_keys;
