from __future__ import annotations;

import json;
import re;
from functools import lru_cache;
from pathlib import Path;

PLATFORM_FRONTEND = Path(__file__).resolve().parents[1] / "frontend";
PLATFORM_FRAGMENTS = PLATFORM_FRONTEND / "fragments";
SHELL_PATH = PLATFORM_FRONTEND / "index-shell.html";

ARENA_TITLES = {
    "pool": "Pool Arena",
    "chezz": "Chezz Arena",
};

CHAT_NOTES = {
    "pool": "Chat is scoped to the current game.",
    "chezz": "Chat is scoped to the current game and resets on New Game.",
};

# Inline in <head> so first paint uses the correct game (before theme.css / tailwind load).
CRITICAL_PAGE_STYLE: dict[str, str] = {
    "pool": (
        "html,body{background:linear-gradient(145deg,#4ab3ff 0%,#1d8fff 46%,#0d4c9c 100%);}"
        "#not-found-screen{background:linear-gradient(180deg,#3a4552 0%,#2d3640 52%,#262f38 100%);}"
        ".app-loading-screen,.game-setup-screen,#home-screen,#lobby-screen,#matchmaking-screen{"
        "background:radial-gradient(circle at 14% 20%,rgba(120,200,255,.42),transparent 42%),"
        "radial-gradient(circle at 86% 10%,rgba(56,150,255,.36),transparent 38%),"
        "radial-gradient(circle at 70% 92%,rgba(20,100,220,.3),transparent 45%),"
        "linear-gradient(145deg,#4ab3ff 0%,#1d8fff 46%,#0d4c9c 100%);}"
    ),
    "chezz": (
        "html,body{background:linear-gradient(145deg,#35cc79 0%,#22ad63 44%,#0a5c32 100%);}"
        "#not-found-screen{background:linear-gradient(180deg,#3a4552 0%,#2d3640 52%,#262f38 100%);}"
        ".app-loading-screen,.game-setup-screen,#home-screen,#lobby-screen,#matchmaking-screen{"
        "background:radial-gradient(circle at 14% 20%,rgba(110,231,183,.4),transparent 42%),"
        "radial-gradient(circle at 86% 10%,rgba(52,211,153,.34),transparent 38%),"
        "radial-gradient(circle at 70% 92%,rgba(10,92,55,.28),transparent 45%),"
        "linear-gradient(145deg,#35cc79 0%,#22ad63 44%,#0a5c32 100%);}"
    ),
    "hub": (
        "html,body{background:linear-gradient(180deg,#3a4552 0%,#2d3640 52%,#262f38 100%);}"
        ".app-loading-screen,#home-screen,#game-menu-screen{"
        "background:linear-gradient(180deg,#3a4552 0%,#2d3640 52%,#262f38 100%);}"
    ),
};

DEFAULT_AVATAR_BY_GAME: dict[str, str] = {
    "pool": "/static/shared/avatars/default-user-pool.svg",
    "chezz": "/static/shared/avatars/default-user-chezz.svg",
    "hub": "/static/shared/avatars/default-user-outline.svg",
};

GAME_SHELL_META: dict[str, dict[str, str]] = {
    "pool": {
        "page_title": "Pool — MindMidas",
        "theme_color": "#1d8fff",
        "loading_title": "Pool",
        "account_heading": "Pool Account",
        "account_tagline": "",
        "lobby_heading": "Pool Lobby",
        "mm_subtitle": "Searching for an online Pool opponent",
        "setup_status_default": "Racking the table&hellip;",
        "app_script": "/static/games/app/main.js",
        "css_bust": "shell20260529a",
        "js_bust": "shell20260529a",
        "game_prefix": "pool",
    },
    "chezz": {
        "page_title": "Chezz — MindMidas",
        "theme_color": "#262f38",
        "loading_title": "Chezz",
        "account_heading": "Chezz Account",
        "account_tagline": "",
        "lobby_heading": "Chezz Lobby",
        "mm_subtitle": "Searching for an online Chezz opponent",
        "setup_status_default": "Setting up the board&hellip;",
        "app_script": "/static/games/app/main.js",
        "css_bust": "shell20260529a",
        "js_bust": "shell20260529a",
        "game_prefix": "chezz",
    },
    "hub": {
        "page_title": "Games by MindMidas",
        "theme_color": "#262f38",
        "loading_title": "Games by MindMidas",
        "account_heading": "Games by MindMidas",
        "account_tagline": "Sign in to play Pool or Chezz",
        "lobby_heading": "Lobby",
        "mm_subtitle": "Searching for an opponent",
        "setup_status_default": "Preparing your game&hellip;",
        "app_script": "/static/games/app/main.js",
        "css_bust": "shell20260526bc",
        "js_bust": "shell20260526aq",
        "game_prefix": "pool",
    },
};

def _read(path: Path) -> str:
    """Read a frontend template or fragment.""";
    return path.read_text(encoding="utf-8");

def _apply_chezz_shell_skin(markup: str) -> str:
    """Map shared Pool-themed shell markup to Chezz tokens (class prefix + sky palette).""";
    result = markup.replace("pool-", "chezz-");
    for prefix in ("text", "border", "ring", "from", "to", "via", "shadow", "divide", "decoration", "accent"):
        result = result.replace(f"{prefix}-sky-", f"{prefix}-emerald-");
    result = result.replace("hover:bg-sky-", "hover:bg-emerald-");
    result = result.replace("focus:border-sky-", "focus:border-emerald-");
    result = result.replace("focus:ring-sky-", "focus:ring-emerald-");
    result = result.replace("placeholder:text-sky-", "placeholder:text-emerald-");
    return result;

def _elide_other_game_markup(markup: str, *, game_id: str) -> str:
    """
    Remove HTML subtrees tagged data-game-only for the other game so composed pages
    keep unique element ids (required by game render scripts).
    """;
    if game_id == "hub":
        result = markup;
        for other in ("pool", "chezz"):
            result = _elide_game_only_blocks(result, other);
        return result;
    return _elide_game_only_blocks(markup, "chezz" if game_id == "pool" else "pool");

def _elide_game_only_blocks(markup: str, other: str) -> str:
    """Remove HTML subtrees tagged for a different game.""";
    needle = f'data-game-only="{other}"';
    chunks: list[str] = [];
    i = 0;
    while i < len(markup):
        idx = markup.find(needle, i);
        if idx < 0:
            chunks.append(markup[i:]);
            break;
        start = markup.rfind("<", i, idx);
        if start < 0:
            chunks.append(markup[i:]);
            break;
        chunks.append(markup[i:start]);
        tag_end = markup.find(">", start);
        if tag_end < 0:
            chunks.append(markup[start:]);
            break;
        tag_chunk = markup[start : tag_end + 1];
        if tag_chunk.rstrip().endswith("/>"):
            i = tag_end + 1;
            continue;
        tag_m = re.match(r"<([a-zA-Z][\w:-]*)", tag_chunk);
        if not tag_m:
            i = tag_end + 1;
            continue;
        tag = tag_m.group(1);
        depth = 1;
        pos = tag_end + 1;
        open_pat = re.compile(rf"<{re.escape(tag)}(?:\s|>|/)", re.I);
        close_pat = re.compile(rf"</{re.escape(tag)}\s*>", re.I);
        while depth > 0 and pos < len(markup):
            next_open = open_pat.search(markup, pos);
            next_close = close_pat.search(markup, pos);
            if not next_close:
                pos = len(markup);
                break;
            if next_open and next_open.start() < next_close.start():
                depth += 1;
                pos = next_open.end();
            else:
                depth -= 1;
                pos = next_close.end();
        i = pos;
    return "".join(chunks);

def _apply_game_fragment(markup: str, *, game_id: str) -> str:
    """Apply per-game fragment filtering and skinning.""";
    meta = GAME_SHELL_META.get(game_id, GAME_SHELL_META["pool"]);
    gp = meta["game_prefix"];
    result = markup.replace("{{GP}}", gp);
    result = _elide_other_game_markup(result, game_id=game_id);
    if game_id == "chezz":
        result = _apply_chezz_shell_skin(result);
    return result;

def _shell_markup(game_id: str) -> str:
    """Compose the base shell markup for one game.""";
    meta = GAME_SHELL_META.get(game_id, GAME_SHELL_META["pool"]);
    gp = meta["game_prefix"];
    shell = _read(SHELL_PATH).replace("{{GP}}", gp);
    if game_id == "chezz":
        shell = _apply_chezz_shell_skin(shell);
    if game_id == "hub":
        shell = _elide_other_game_markup(shell, game_id="hub");
    return shell;

def _inject_game_app_chrome(game_app: str, *, game_id: str) -> str:
    """Inject shared mobile HUD, drawer header, and chat chrome.""";
    mobile_menu = _apply_game_fragment(_read(PLATFORM_FRAGMENTS / "game-mobile-hud-menu.html"), game_id=game_id);
    drawer_header = _apply_game_fragment(_read(PLATFORM_FRAGMENTS / "game-side-drawer-header.html"), game_id=game_id);
    drawer_header = drawer_header.replace("{{ARENA_TITLE}}", ARENA_TITLES[game_id]);
    chat_panel = _apply_game_fragment(_read(PLATFORM_FRAGMENTS / "game-chat-panel.html"), game_id=game_id);
    chat_panel = chat_panel.replace("{{CHAT_NOTE}}", CHAT_NOTES[game_id]);
    result = game_app;
    result = result.replace("{{GAME_MOBILE_HUD_MENU}}", mobile_menu);
    result = result.replace("{{GAME_SIDE_DRAWER_HEADER}}", drawer_header);
    result = result.replace("{{GAME_CHAT_PANEL}}", chat_panel);
    return result;

STATIC_GAMES_PREFIX = "/static/games/";

@lru_cache(maxsize=8)
def build_import_map_json(game_web_dir: str, js_bust: str) -> str:
    """Build an import map that cache-busts every game ES module URL.""";
    root = Path(game_web_dir) / "static" / "games";
    if not root.is_dir():
        return '{"imports":{}}';
    imports: dict[str, str] = {};
    for path in sorted(root.rglob("*.js")):
        rel = path.relative_to(root).as_posix();
        url = f"{STATIC_GAMES_PREFIX}{rel}";
        imports[url] = f"{url}?v={js_bust}";
    return json.dumps({"imports": imports}, separators=(",", ":"));

def compose_index_html(*, game_id: str, game_web_dir: Path) -> str:
    """Compose the SPA shell for the requested game.""";
    if game_id not in GAME_SHELL_META:
        game_id = "pool";
    meta = GAME_SHELL_META[game_id];
    shell = _shell_markup(game_id);

    theme_game_id = game_id if game_id in GAME_SHELL_META else "pool";
    tailwind_game_id = "pool" if game_id == "hub" else game_id;
    if game_id == "hub":
        scatter = "";
    else:
        scatter = _apply_game_fragment(_read(PLATFORM_FRAGMENTS / "scatter.html"), game_id=game_id);
    if game_id == "hub":
        game_app = "<!-- hub shell: arena loaded after game selection -->";
        lobby_play = "";
        loading_logo = "";
    else:
        game_app = _inject_game_app_chrome(
            _apply_game_fragment(_read(PLATFORM_FRAGMENTS / "game-app.html"), game_id=game_id),
            game_id=game_id,
        );
        lobby_play = _apply_game_fragment(_read(PLATFORM_FRAGMENTS / "lobby-play-buttons.html"), game_id=game_id);
        loading_logo = _apply_game_fragment(_read(PLATFORM_FRAGMENTS / "loading-logo.html"), game_id=game_id);
    head_styles = _read(PLATFORM_FRAGMENTS / "head-styles.html");
    head_styles = head_styles.replace("{{TAILWIND_GAME}}", tailwind_game_id);
    head_styles = head_styles.replace("{{THEME_GAME}}", theme_game_id);
    head_styles = head_styles.replace("{{CSS_BUST}}", meta["css_bust"]);

    html = shell;
    html = html.replace("{{SCATTER_FRAGMENT}}", scatter);
    html = html.replace("{{GAME_APP_FRAGMENT}}", game_app);
    html = html.replace("{{GAME_STYLES}}", head_styles);
    html = html.replace("{{LOADING_LOGO_FRAGMENT}}", loading_logo);
    html = html.replace("{{LOBBY_PLAY_BUTTONS}}", lobby_play);
    html = html.replace("{{GAME_ID}}", game_id);
    html = html.replace("{{CRITICAL_PAGE_STYLE}}", CRITICAL_PAGE_STYLE[game_id]);
    html = html.replace("{{PAGE_TITLE}}", meta["page_title"]);
    html = html.replace("{{THEME_COLOR}}", meta["theme_color"]);
    html = html.replace("{{LOADING_TITLE}}", meta["loading_title"]);
    html = html.replace("{{ACCOUNT_HEADING}}", meta["account_heading"]);
    html = html.replace("{{ACCOUNT_TAGLINE}}", meta.get("account_tagline") or "");
    html = html.replace("{{LOBBY_HEADING}}", meta["lobby_heading"]);
    html = html.replace("{{MM_SUBTITLE}}", meta["mm_subtitle"]);
    html = html.replace("{{SETUP_STATUS_DEFAULT}}", meta["setup_status_default"]);
    html = html.replace("{{APP_SCRIPT}}", meta["app_script"]);
    html = html.replace("{{CSS_BUST}}", meta["css_bust"]);
    html = html.replace("{{JS_BUST}}", meta["js_bust"]);
    html = html.replace("{{DEFAULT_AVATAR}}", DEFAULT_AVATAR_BY_GAME[game_id]);
    if "{{GAME_SCATTER_FRAGMENT}}" in html:
        html = html.replace("{{GAME_SCATTER_FRAGMENT}}", "");
    return html;

def resolve_static_file(web_dirs: list[Path], url_path: str) -> Path | None:
    """Resolve a regular file without following symlinks outside static roots.""";
    clean = url_path.split("?", 1)[0].split("#", 1)[0].lstrip("/");
    if not clean or ".." in clean.split("/"):
        return None;
    for root in web_dirs:
        root = root.resolve();
        relative = Path(clean);
        source = root / relative;
        if any((root.joinpath(*relative.parts[:index])).is_symlink() for index in range(1, len(relative.parts) + 1)):
            continue;
        candidate = source.resolve();
        try:
            candidate.relative_to(root);
        except ValueError:
            continue;
        if candidate.is_file():
            return candidate;
    return None;
