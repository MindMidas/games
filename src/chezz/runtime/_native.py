from __future__ import annotations;

import ctypes;
import os;
import re;
import sys;
from pathlib import Path;
from typing import Any;

from src.platform.backend import ServiceError;

from src.chezz.runtime.contracts import ENGINE_USERNAME;

_HEADER_RE = re.compile(r"^\s*([wbWB])\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$");
_PIECE_RE = re.compile(r"^\s*([a-hA-H][1-8])\s*:\s*'([wb][PNBRQKZFC])'\s*,?\s*$");
_ENGINE_OUTPUT_SIZE = 4096;

def _host_os_name() -> str:
    """Avoid stdlib ``platform`` - shadowed by ``src.platform`` on PYTHONPATH.""";
    plat = sys.platform.lower();
    if plat.startswith("win"):
        return "windows";
    if plat == "darwin":
        return "darwin";
    return "linux";

def _library_candidate_paths(project_root: Path) -> list[Path]:
    """Return ordered native-library paths for the host OS.""";
    system = _host_os_name();
    names = (
        ["user_actions.dll", "libuser_actions.dll"]
        if system == "windows"
        else ["libuser_actions.dylib", "libuser_actions.so"]
        if system == "darwin"
        else ["libuser_actions.so", "libuser_actions.dylib"]
    );
    engine_dirs = [project_root.resolve() / "engine"];
    nested = project_root.resolve() / "src" / "chezz" / "engine";
    if nested != engine_dirs[0]:
        engine_dirs.append(nested);
    return [engine_dir / name for name in names for engine_dir in engine_dirs];

def _load_library(project_root: Path, dll_dirs: list[Any], *, label: str) -> ctypes.CDLL:
    """Load the shared Chezz native library from one canonical path search.""";
    candidates = _library_candidate_paths(project_root);
    lib_path = next((path for path in candidates if path.exists()), None);
    if lib_path is None:
        raise ServiceError(500, f"{label} library not found. tried: {', '.join(map(str, candidates))}");
    if _host_os_name() == "windows" and hasattr(os, "add_dll_directory"):
        local_app_data = Path(os.environ.get("LOCALAPPDATA", ""));
        extra_dirs = [
            lib_path.parent,
            local_app_data
            / "Microsoft"
            / "WinGet"
            / "Packages"
            / "BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe"
            / "mingw64"
            / "bin",
        ];
        for directory in extra_dirs:
            if directory.exists():
                dll_dirs.append(os.add_dll_directory(str(directory)));
    try:
        return ctypes.CDLL(str(lib_path));
    except OSError as exc:
        raise ServiceError(500, f"Failed to load {label} native library. Path: {lib_path}. Error: {exc}") from exc;

TOTAL_TYPES = 18;

PIECE_INDEX: dict[str, int] = {
    "wP": 0,
    "bP": 1,
    "wN": 2,
    "bN": 3,
    "wB": 4,
    "bB": 5,
    "wR": 6,
    "bR": 7,
    "wQ": 8,
    "bQ": 9,
    "wK": 10,
    "bK": 11,
    "wZ": 12,
    "bZ": 13,
    "wF": 14,
    "bF": 15,
    "wC": 16,
    "bC": 17,
};

UA_KIND_TO_NAME: dict[int, str] = {
    1: "move",
    2: "shoot",
    3: "fling",
};

PIECE_CODE_BY_INDEX: list[str] = [
    "wP",
    "bP",
    "wN",
    "bN",
    "wB",
    "bB",
    "wR",
    "bR",
    "wQ",
    "bQ",
    "wK",
    "bK",
    "wZ",
    "bZ",
    "wF",
    "bF",
    "wC",
    "bC",
];

class CHeader(ctypes.Structure):
    _fields_ = [
        ("turn", ctypes.c_char),
        ("time_taken", ctypes.c_int),
        ("max_time", ctypes.c_int),
        ("num_moves", ctypes.c_int),
    ];

class CChezzboard(ctypes.Structure):
    _fields_ = [
        ("header", CHeader),
        ("pieces", ctypes.c_uint64 * TOTAL_TYPES),
        ("white_pieces", ctypes.c_uint64),
        ("black_pieces", ctypes.c_uint64),
        ("all_pieces", ctypes.c_uint64),
        ("score", ctypes.c_int),
    ];

class CUAAction(ctypes.Structure):
    _fields_ = [
        ("kind", ctypes.c_int),
        ("from_", ctypes.c_int),
        ("to", ctypes.c_int),
        ("square", ctypes.c_int),
        ("payload", ctypes.c_int),
        ("target", ctypes.c_int),
        ("direction", ctypes.c_char * 3),
        ("action_key", ctypes.c_char * 32),
    ];

class CUAEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int),
        ("action", ctypes.c_char * 24),
        ("piece", ctypes.c_char * 3),
        ("from_piece", ctypes.c_char * 3),
        ("to_piece", ctypes.c_char * 3),
        ("direction", ctypes.c_char * 3),
        ("square", ctypes.c_int),
        ("from_square", ctypes.c_int),
        ("to_square", ctypes.c_int),
        ("payload_square", ctypes.c_int),
        ("target_square", ctypes.c_int),
    ];

class CUAValidBoards(ctypes.Structure):
    _fields_ = [
        ("boards", ctypes.POINTER(CChezzboard)),
        ("actions", ctypes.POINTER(CUAAction)),
        ("events", ctypes.POINTER(CUAEvent)),
        ("event_offsets", ctypes.POINTER(ctypes.c_size_t)),
        ("event_counts", ctypes.POINTER(ctypes.c_size_t)),
        ("events_count", ctypes.c_size_t),
        ("events_capacity", ctypes.c_size_t),
        ("count", ctypes.c_size_t),
        ("capacity", ctypes.c_size_t),
    ];

def _square_to_index(square: str) -> int:
    """Convert square notation to an engine index.""";
    text = str(square or "").strip().lower();
    if len(text) != 2 or text[0] < "a" or text[0] > "h" or text[1] < "1" or text[1] > "8":
        raise ServiceError(500, f"Invalid square in snapshot: {square}");
    file_idx = ord(text[0]) - ord("a");
    rank_idx = ord(text[1]) - ord("1");
    return (rank_idx * 8) + file_idx;

def _index_to_square(index: int) -> str:
    """Convert an engine index to square notation.""";
    idx = int(index);
    if idx < 0 or idx > 63:
        return "";
    file_idx = idx % 8;
    rank_idx = idx // 8;
    return f"{chr(ord('a') + file_idx)}{rank_idx + 1}";

def _decode_c_string(raw: Any) -> str:
    """Decode a native C string.""";
    return bytes(raw).split(b"\x00", 1)[0].decode("utf-8", errors="ignore");

class UserActionsAdapter:

    def __init__(self, project_root: Path) -> None:
        """Store project root searched for compiled ``user_actions`` artifacts.""";
        self._project_root = project_root.resolve();
        self._lib: ctypes.CDLL | None = None;
        self._dll_dirs: list[Any] = [];

    def _library(self) -> ctypes.CDLL:
        """Load native ``user_actions`` once and expose ``ua_*`` ctypes hooks.""";
        if self._lib is not None:
            return self._lib;

        lib = _load_library(self._project_root, self._dll_dirs, label="user_actions");
        lib.ua_gen_chezz_boards.argtypes = [ctypes.POINTER(CChezzboard), ctypes.c_int];
        lib.ua_gen_chezz_boards.restype = CUAValidBoards;
        lib.ua_free_chezz_actions.argtypes = [ctypes.POINTER(CUAValidBoards)];
        lib.ua_free_chezz_actions.restype = None;
        self._lib = lib;
        return lib;

    def actions_for_snapshot(self, snapshot: dict[str, Any]) -> list[dict[str, Any]]:
        """Return legal native actions for a snapshot.""";
        candidates = self.candidates_for_snapshot(snapshot);
        return [self._only_action_fields(candidate) for candidate in candidates];

    def candidates_for_snapshot(self, snapshot: dict[str, Any]) -> list[dict[str, Any]]:
        """Return candidate action payloads for a snapshot.""";
        board_struct = self._snapshot_to_board(snapshot);
        color = 1 if str(snapshot.get("header", {}).get("turn") or "w").strip().lower() == "w" else -1;

        lib = self._library();
        result = lib.ua_gen_chezz_boards(ctypes.byref(board_struct), color);
        try:
            candidates: list[dict[str, Any]] = [];
            count = int(result.count);
            for i in range(count):
                raw = result.actions[i];
                action_payload = self._action_payload(raw);
                next_snapshot = self._board_to_snapshot(result.boards[i], template_snapshot=snapshot);
                events = self._event_payloads_for_index(result, i);
                candidate = dict(action_payload);
                candidate["score"] = int(result.boards[i].score);
                candidate["snapshot"] = next_snapshot;
                candidate["events"] = events;
                candidates.append(candidate);
            return candidates;
        finally:
            lib.ua_free_chezz_actions(ctypes.byref(result));

    def _only_action_fields(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Keep only client-visible action fields.""";
        action = {
            key: value
            for key, value in payload.items()
            if key
            in {
                "action_key",
                "kind",
                "from",
                "to",
                "square",
                "direction",
                "catapult",
                "payload",
                "target",
            }
        };
        events = payload.get("events");
        if isinstance(events, list):
            action["preview_events"] = [event for event in events if isinstance(event, dict)];
        snapshot = payload.get("snapshot");
        if isinstance(snapshot, dict):
            action["preview_snapshot"] = snapshot;
        return action;

    def _action_payload(self, raw: CUAAction) -> dict[str, Any]:
        """Convert one native action to a payload.""";
        kind_name = UA_KIND_TO_NAME.get(int(raw.kind), "unknown");
        payload: dict[str, Any] = {
            "action_key": _decode_c_string(raw.action_key),
            "kind": kind_name,
        };
        if kind_name == "move":
            payload["from"] = _index_to_square(raw.from_);
            payload["to"] = _index_to_square(raw.to);
        elif kind_name == "shoot":
            payload["square"] = _index_to_square(raw.square);
            payload["direction"] = _decode_c_string(raw.direction).lower();
        elif kind_name == "fling":
            payload["catapult"] = _index_to_square(raw.square);
            payload["payload"] = _index_to_square(raw.payload);
            payload["target"] = _index_to_square(raw.target);
        return payload;

    def _board_to_snapshot(
        self,
        board: CChezzboard,
        *,
        template_snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        """Convert a native board to a snapshot.""";
        board_map: dict[str, str] = {};
        for piece_index, piece_code in enumerate(PIECE_CODE_BY_INDEX):
            bits = int(board.pieces[piece_index]);
            while bits:
                lsb = bits & -bits;
                square_index = lsb.bit_length() - 1;
                board_map[_index_to_square(square_index)] = piece_code;
                bits ^= lsb;

        base_result = template_snapshot.get("result") if isinstance(template_snapshot, dict) else None;
        base_result = base_result if isinstance(base_result, dict) else {};

        return {
            "game_type": template_snapshot.get("game_type", "chezz"),
            "mode": template_snapshot.get("mode", "pve"),
            "engine_name": template_snapshot.get("engine_name", ENGINE_USERNAME),
            "header": {
                "turn": _decode_c_string(board.header.turn) or "w",
                "time_taken": int(board.header.time_taken),
                "max_time": int(board.header.max_time),
                "num_moves": int(board.header.num_moves),
            },
            "board": board_map,
            "result": {
                "status": str(base_result.get("status") or "active"),
                "winner": base_result.get("winner"),
                "reason": base_result.get("reason"),
            },
            "winner": template_snapshot.get("winner"),
        };

    def _event_payloads_for_index(self, result: CUAValidBoards, index: int) -> list[dict[str, Any]]:
        """Return event payloads for one native action index.""";
        if not bool(result.events) or not bool(result.event_offsets) or not bool(result.event_counts):
            return [];
        offset = int(result.event_offsets[index]);
        count = int(result.event_counts[index]);
        if count <= 0:
            return [];

        payloads: list[dict[str, Any]] = [];
        for event_index in range(offset, offset + count):
            raw = result.events[event_index];
            payload = {
                "type": int(raw.type),
                "action": _decode_c_string(raw.action),
                "piece": _decode_c_string(raw.piece),
                "from_piece": _decode_c_string(raw.from_piece),
                "to_piece": _decode_c_string(raw.to_piece),
                "direction": _decode_c_string(raw.direction),
                "square": _index_to_square(raw.square),
                "from_square": _index_to_square(raw.from_square),
                "to_square": _index_to_square(raw.to_square),
                "payload_square": _index_to_square(raw.payload_square),
                "target_square": _index_to_square(raw.target_square),
            };
            payloads.append(payload);
        return payloads;

    def _snapshot_to_board(self, snapshot: dict[str, Any]) -> CChezzboard:
        """Convert a snapshot to a native board.""";
        board_struct = CChezzboard();
        header = snapshot.get("header") if isinstance(snapshot, dict) else None;
        header = header if isinstance(header, dict) else {};
        board_struct.header.turn = (
            b"b" if str(header.get("turn") or "w").strip().lower() == "b" else b"w"
        );
        board_struct.header.time_taken = int(header.get("time_taken", 0));
        board_struct.header.max_time = int(header.get("max_time", 60000));
        board_struct.header.num_moves = int(header.get("num_moves", 0));

        board_map = snapshot.get("board") if isinstance(snapshot, dict) else None;
        board_map = board_map if isinstance(board_map, dict) else {};

        for square, piece_code in board_map.items():
            piece = str(piece_code or "").strip();
            piece_index = PIECE_INDEX.get(piece);
            if piece_index is None:
                raise ServiceError(500, f"Invalid piece in snapshot: {piece}");
            bit_index = _square_to_index(str(square));
            bit = ctypes.c_uint64(1 << bit_index).value;
            board_struct.pieces[piece_index] |= bit;
            if piece.startswith("w"):
                board_struct.white_pieces |= bit;
            elif piece.startswith("b"):
                board_struct.black_pieces |= bit;
            board_struct.all_pieces |= bit;

        return board_struct;

class BestMoveAdapter:
    """Private ctypes adapter for the native best-move search.""";

    def __init__(self, project_root: Path) -> None:

        self._project_root = project_root.resolve();
        self._lib: ctypes.CDLL | None = None;
        self._dll_dirs: list[Any] = [];

    def _library(self) -> ctypes.CDLL:
        """Return the loaded native library.""";
        if self._lib is None:
            lib = _load_library(self._project_root, self._dll_dirs, label="engine");
            lib.engine_best_move.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_size_t];
            lib.engine_best_move.restype = ctypes.c_int;
            self._lib = lib;
        return self._lib;

    def best_move_snapshot(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        """Run the native best-move search.""";
        input_bytes = self._snapshot_to_stdin(snapshot).encode("utf-8");
        out_buf = ctypes.create_string_buffer(_ENGINE_OUTPUT_SIZE);
        if self._library().engine_best_move(input_bytes, out_buf, _ENGINE_OUTPUT_SIZE) != 0:
            raise ServiceError(500, "Engine search failed: output buffer too small");
        return self._parse_stdout(out_buf.value.decode("utf-8", errors="replace"), snapshot);

    @staticmethod
    def _snapshot_to_stdin(snapshot: dict[str, Any]) -> str:
        """Serialize a snapshot for native stdin.""";
        header = snapshot.get("header") if isinstance(snapshot.get("header"), dict) else {};
        turn = str(header.get("turn") or "w").strip().lower();
        turn = turn if turn in {"w", "b"} else "w";
        board = snapshot.get("board") if isinstance(snapshot.get("board"), dict) else {};
        lines = [
            f"{turn} {int(header.get('time_taken', 0))} {int(header.get('max_time', 60000))} {int(header.get('num_moves', 0))}",
            "{",
        ];
        lines.extend(f"  {str(square).lower()}: '{str(board[square] or '').strip()}'," for square in sorted(board));
        return "\n".join([*lines, "}", ""]);

    @staticmethod
    def _parse_stdout(stdout: str, template: dict[str, Any]) -> dict[str, Any]:
        """Parse stdout.""";
        lines = (stdout or "").splitlines();
        match = next((_HEADER_RE.match(line) for line in lines if _HEADER_RE.match(line)), None);
        if match is None:
            raise ServiceError(500, "Engine output missing board header");
        header_index = next(index for index, line in enumerate(lines) if _HEADER_RE.match(line));
        board: dict[str, str] = {};
        in_board = False;
        for line in lines[header_index + 1:]:
            if "{" in line:
                in_board = True;
                continue;
            if not in_board:
                continue;
            if "}" in line:
                break;
            piece = _PIECE_RE.match(line);
            if piece:
                board[piece.group(1).lower()] = piece.group(2);
        result = template.get("result") if isinstance(template.get("result"), dict) else {};
        return {
            "game_type": template.get("game_type", "chezz"),
            "mode": template.get("mode", "pve"),
            "engine_name": template.get("engine_name", ENGINE_USERNAME),
            "header": {
                "turn": match.group(1).lower(),
                "time_taken": int(match.group(2)),
                "max_time": int(match.group(3)),
                "num_moves": int(match.group(4)),
            },
            "board": board,
            "result": {
                "status": str(result.get("status") or "active"),
                "winner": result.get("winner"),
                "reason": result.get("reason"),
            },
            "winner": template.get("winner"),
        };
