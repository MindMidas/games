import phylib;
import math;
import random;

# Constants from phylib.
BALL_RADIUS   = phylib.PHYLIB_BALL_RADIUS;

BALL_DIAMETER = phylib.PHYLIB_BALL_DIAMETER;
HOLE_RADIUS   = phylib.PHYLIB_HOLE_RADIUS;
TABLE_LENGTH  = phylib.PHYLIB_TABLE_LENGTH;
TABLE_WIDTH   = phylib.PHYLIB_TABLE_WIDTH;
SIM_RATE      = phylib.PHYLIB_SIM_RATE;
VEL_EPSILON   = phylib.PHYLIB_VEL_EPSILON;
DRAG          = phylib.PHYLIB_DRAG;
MAX_TIME      = phylib.PHYLIB_MAX_TIME;
MAX_OBJECTS   = phylib.PHYLIB_MAX_OBJECTS;

FRAME_INTERVAL = 0.01;

# Define global variables for stripe (9-15) and solid (1-7) ball number ranges (8-ball).
STRIPES_RANGE = range(9, 16);
SOLIDS_RANGE = range(1, 8);
EIGHT_BALL = 8;
CUE_BALL = 0;

# Pocket centers, matching phylib.c (corners + side pockets on both rails).
TABLE_HOLES = (
    (0.0, 0.0),
    (0.0, TABLE_LENGTH / 2.0),
    (0.0, TABLE_LENGTH),
    (TABLE_WIDTH, 0.0),
    (TABLE_WIDTH, TABLE_LENGTH / 2.0),
    (TABLE_WIDTH, TABLE_LENGTH),
);

def _table_rail_pad():
    """Wood rail thickness so corner/side pockets (radius HOLE_RADIUS) are not clipped.""";
    return int(math.ceil(HOLE_RADIUS + 14));

# Fallback tones (SVG uses gradients; geometry unchanged).
TABLE_RAIL_WOOD = "#8b5e3a";
TABLE_POCKET_SOCKET = "#f0b429";
TABLE_CUSHION_GREEN = "#3db86e";

def _table_outer_rounded_path(w, l, rail):
    """Rounded table perimeter (matches outer red border). Returns path d and corner radius.""";
    x0, y0 = -rail, -rail;
    x1, y1 = w + rail, l + rail;
    cr = int(round(rail * 0.75));
    d = (
        f'M {x0 + cr} {y0} L {x1 - cr} {y0} Q {x1} {y0} {x1} {y0 + cr}'
        f' L {x1} {y1 - cr} Q {x1} {y1} {x1 - cr} {y1}'
        f' L {x0 + cr} {y1} Q {x0} {y1} {x0} {y1 - cr}'
        f' L {x0} {y0 + cr} Q {x0} {y0} {x0 + cr} {y0} Z'
    );
    return d, cr;

def _rail_corner_wood_path(rail, wood_o, corner_r, fill):
    """Outer wood at table corner with filleted exterior (matches outer border).""";
    cr = max(0, min(int(corner_r), rail - 1, wood_o - 1));
    if cr <= 0:
        return (
            f'<path d="M 0 0 L {rail} 0 L {rail} {wood_o} L {wood_o} {wood_o}'
            f' L 0 {wood_o} L 0 {rail} Z" fill="{fill}"/>'
        );
    return (
        f'<path d="M {cr} 0 L {rail} 0 L {rail} {wood_o} L {wood_o} {wood_o}'
        f' L 0 {wood_o} L 0 {rail} L 0 {cr} A {cr} {cr} 0 0 1 {cr} 0 Z" fill="{fill}"/>'
    );

def _corner_socket_l_svg(leg, thick, fill, corner_r):
    """
    Equal-length 90 degrees L (L); outer table corner filleted to match rounded border.
    """;
    cr = max(0, min(int(corner_r), leg - 1, thick - 1));
    if cr <= 0:
        return (
            f'<path d="M 0 0 L {leg} 0 L {leg} {thick} L {thick} {thick}'
            f' L {thick} {leg} L 0 {leg} Z" fill="{fill}"/>'
        );
    return (
        f'<path d="M {cr} 0 L {leg} 0 L {leg} {thick} L {thick} {thick}'
        f' L {thick} {leg} L 0 {leg} L 0 {cr} A {cr} {cr} 0 0 1 {cr} 0 Z" fill="{fill}"/>'
    );

def _table_side_pocket_sockets_svg(w, l, rail):
    """Side-pocket socket bars (opaque; below green cushion border).""";
    hr = int(round(HOLE_RADIUS));
    side_half = int(round(hr + rail * 0.35));
    side_h = 2 * side_half;
    hl = int(round(l / 2.0));
    fill = TABLE_POCKET_SOCKET;
    return (
        '<g class="pool-pocket-sockets pool-pocket-sockets-side"'
        ' clip-path="url(#table-outer-clip)" pointer-events="none" opacity="1">'
        f'<rect x="-{rail}" y="{hl - side_half}" width="{rail}" height="{side_h}" fill="{fill}"/>'
        f'<rect x="{w}" y="{hl - side_half}" width="{rail}" height="{side_h}" fill="{fill}"/>'
        '</g>'
    );

def _table_corner_pocket_sockets_svg(w, l, rail):
    """Corner L jaws (below green cushion border in paint order).""";
    hr = int(round(HOLE_RADIUS));
    leg = int(round(rail + hr * 1.35));
    thick = rail;
    fill = 'url(#socket-cap-grad)';
    _, corner_r = _table_outer_rounded_path(w, l, rail);
    jaw = _corner_socket_l_svg(leg, thick, fill, corner_r);
    return (
        '<g class="pool-pocket-sockets pool-pocket-sockets-corner"'
        ' clip-path="url(#table-outer-clip)" pointer-events="none" opacity="1">'
        f'<g transform="translate(-{rail},-{rail})">{jaw}</g>'
        f'<g transform="translate({w + rail},-{rail}) scale(-1,1)">{jaw}</g>'
        f'<g transform="translate(-{rail},{l + rail}) scale(1,-1)">{jaw}</g>'
        f'<g transform="translate({w + rail},{l + rail}) scale(-1,-1)">{jaw}</g>'
        '</g>'
    );

def _table_pocket_sockets_svg(w, l, rail):
    """All pocket socket trim (side + corner jaws, below green border).""";
    return _table_side_pocket_sockets_svg(w, l, rail) + _table_corner_pocket_sockets_svg(w, l, rail);

def _wood_plank_svg(x, y, pw, ph, grad_id):
    """Brown rail plank: base wood gradient + repeating grain overlay (SVG pattern technique).""";
    return (
        f'<rect x="{x}" y="{y}" width="{pw}" height="{ph}" fill="url(#{grad_id})"/>'
        f'<rect x="{x}" y="{y}" width="{pw}" height="{ph}" fill="url(#wood-grain)" opacity="0.55"/>'
    );

def _cushion_rect_svg(x, y, pw, ph):
    """Solid opaque cushion face (no gradient / no alpha).""";
    return (
        f'<rect class="pool-cushion-face" x="{x}" y="{y}" width="{pw}" height="{ph}"'
        f' fill="{TABLE_CUSHION_GREEN}" fill-opacity="1" opacity="1"/>'
    );

def _cushion_path_svg(d):
    """Solid opaque cushion path.""";
    return (
        f'<path class="pool-cushion-face" d="{d}"'
        f' fill="{TABLE_CUSHION_GREEN}" fill-opacity="1" opacity="1"/>'
    );

def _rail_corner_wood_layer(rail, wood_o, corner_r):
    """Filleted corner wood with grain overlay.""";
    base = _rail_corner_wood_path(rail, wood_o, corner_r, 'url(#rail-wood-corner)');
    grain = _rail_corner_wood_path(rail, wood_o, corner_r, 'url(#wood-grain)');
    return base + f'<g opacity="0.55">{grain}</g>';

def _table_svg_defs_3d(w, l, rail):
    """Gradients/patterns for rails, cushions, sockets, outer border (geometry unchanged).""";
    outer_path, _ = _table_outer_rounded_path(w, l, rail);
    return (
        f'  <clipPath id="table-outer-clip"><path d="{outer_path}"/></clipPath>'
        '  <pattern id="wood-grain" width="48" height="48" patternUnits="userSpaceOnUse">'
        '    <rect width="48" height="48" fill="#4a2a12"/>'
        '    <path d="M0 10 Q24 6 48 14" fill="none" stroke="#7a4e28" stroke-width="2.2" opacity="0.35"/>'
        '    <path d="M0 28 Q24 32 48 24" fill="none" stroke="#6b3f20" stroke-width="1.6" opacity="0.28"/>'
        '    <path d="M0 40 L48 38" fill="none" stroke="#3d2210" stroke-width="1.2" opacity="0.4"/>'
        '    <path d="M6 0 L8 48" fill="none" stroke="#8f5c32" stroke-width="1.4" opacity="0.18"/>'
        '    <path d="M28 0 L30 48" fill="none" stroke="#5c3818" stroke-width="1.2" opacity="0.15"/>'
        '  </pattern>'
        '  <linearGradient id="rail-wood-h" x1="0" y1="0" x2="0" y2="1">'
        '    <stop offset="0%" stop-color="#c47832"/>'
        '    <stop offset="40%" stop-color="#7a4520"/>'
        '    <stop offset="100%" stop-color="#3a1f0c"/>'
        '  </linearGradient>'
        '  <linearGradient id="rail-wood-h-inv" x1="0" y1="0" x2="0" y2="1">'
        '    <stop offset="0%" stop-color="#3a1f0c"/>'
        '    <stop offset="60%" stop-color="#7a4520"/>'
        '    <stop offset="100%" stop-color="#c47832"/>'
        '  </linearGradient>'
        '  <linearGradient id="rail-wood-v" x1="0" y1="0" x2="1" y2="0">'
        '    <stop offset="0%" stop-color="#c47832"/>'
        '    <stop offset="40%" stop-color="#7a4520"/>'
        '    <stop offset="100%" stop-color="#3a1f0c"/>'
        '  </linearGradient>'
        '  <linearGradient id="rail-wood-v-inv" x1="0" y1="0" x2="1" y2="0">'
        '    <stop offset="0%" stop-color="#3a1f0c"/>'
        '    <stop offset="60%" stop-color="#7a4520"/>'
        '    <stop offset="100%" stop-color="#c47832"/>'
        '  </linearGradient>'
        '  <linearGradient id="rail-wood-corner" x1="0" y1="0" x2="1" y2="1">'
        '    <stop offset="0%" stop-color="#c47832"/>'
        '    <stop offset="45%" stop-color="#7a4520"/>'
        '    <stop offset="100%" stop-color="#3a1f0c"/>'
        '  </linearGradient>'
        '  <linearGradient id="socket-cap-grad" x1="0" y1="0" x2="1" y2="1">'
        '    <stop offset="0%" stop-color="#ffe566"/>'
        '    <stop offset="40%" stop-color="#f0b429"/>'
        '    <stop offset="100%" stop-color="#d99a1a"/>'
        '  </linearGradient>'
        '  <linearGradient id="socket-side-grad-l" x1="0" y1="0" x2="1" y2="0">'
        '    <stop offset="0%" stop-color="#ffe566"/>'
        '    <stop offset="50%" stop-color="#f0b429"/>'
        '    <stop offset="100%" stop-color="#d99a1a"/>'
        '  </linearGradient>'
        '  <linearGradient id="socket-side-grad-r" x1="1" y1="0" x2="0" y2="0">'
        '    <stop offset="0%" stop-color="#ffe566"/>'
        '    <stop offset="50%" stop-color="#f0b429"/>'
        '    <stop offset="100%" stop-color="#d99a1a"/>'
        '  </linearGradient>'
    );

def _table_rails_svg(w, l, rail):
    """Rails: 65% outer wood + 35% inner green cushion mat (same rail band size).""";
    sw = w + 2 * rail;
    wood_o = int(round(rail * 0.65));
    cush = rail - wood_o;
    _, cr = _table_outer_rounded_path(w, l, rail);
    mid_w = sw - 2 * cr;
    mid_h = l - 2 * cr;
    corner_wood = _rail_corner_wood_layer(rail, wood_o, cr);
    parts = [
        '<g class="pool-rails" clip-path="url(#table-outer-clip)" pointer-events="none">',
        '<g class="pool-cushion-mat" fill-opacity="1" opacity="1">',
    ];
    # Top / bottom (inset so corners are separate filleted paths)
    parts.append(_wood_plank_svg(cr - rail, -rail, mid_w, wood_o, 'rail-wood-h'));
    parts.append(_cushion_rect_svg(cr - rail, -cush, mid_w, cush));
    parts.append(_wood_plank_svg(cr - rail, l + cush, mid_w, wood_o, 'rail-wood-h-inv'));
    parts.append(_cushion_rect_svg(cr - rail, l, mid_w, cush));
    # Left / right
    parts.append(_wood_plank_svg(-rail, cr, wood_o, mid_h, 'rail-wood-v'));
    parts.append(_cushion_rect_svg(-cush, cr, cush, mid_h));
    parts.append(_wood_plank_svg(w + cush, cr, wood_o, mid_h, 'rail-wood-v-inv'));
    parts.append(_cushion_rect_svg(w, cr, cush, mid_h));
    # Corners - filleted outer wood + inner cushion L
    parts.append(f'  <g transform="translate(-{rail},-{rail})">{corner_wood}</g>');
    parts.append(f'  <g transform="translate({w + rail},-{rail}) scale(-1,1)">{corner_wood}</g>');
    parts.append(f'  <g transform="translate(-{rail},{l + rail}) scale(1,-1)">{corner_wood}</g>');
    parts.append(f'  <g transform="translate({w + rail},{l + rail}) scale(-1,-1)">{corner_wood}</g>');
    parts.append(_cushion_rect_svg(-rail, -cush, rail, cush));
    parts.append(_cushion_rect_svg(-cush, -rail, cush, rail));
    parts.append(_cushion_rect_svg(w, -cush, rail, cush));
    parts.append(_cushion_rect_svg(w + cush, -rail, cush, rail));
    parts.append(_cushion_rect_svg(-rail, l, rail, cush));
    parts.append(_cushion_rect_svg(-cush, l, cush, rail));
    parts.append(_cushion_rect_svg(w, l, rail, cush));
    parts.append(_cushion_rect_svg(w + cush, l, cush, rail));
    parts.append('</g></g>');
    return ''.join(parts);

def _table_cushion_inner_border_svg(w, l, rail):
    """Straight-rail green cushion above side sockets (not corners).""";
    cush = rail - int(round(rail * 0.65));
    hr = int(round(HOLE_RADIUS));
    corner_stop = max(int(round(hr * 1.35)), cush + 2);
    mid_w = w - 2 * corner_stop;
    mid_h = l - 2 * corner_stop;
    parts = [
        '<g class="pool-cushion-inner-border pool-cushion-inner-border-straight"'
        ' pointer-events="none" fill-opacity="1" opacity="1">',
    ];
    if mid_w > 0:
        parts.append(_cushion_rect_svg(corner_stop, -cush, mid_w, cush));
        parts.append(_cushion_rect_svg(corner_stop, l, mid_w, cush));
    if mid_h > 0:
        parts.append(_cushion_rect_svg(-cush, corner_stop, cush, mid_h));
        parts.append(_cushion_rect_svg(w, corner_stop, cush, mid_h));
    parts.append('</g>');
    return ''.join(parts);

def _table_corner_cushion_inner_border_svg(w, l, rail):
    """
    Standalone L-shaped cushion arms per corner (above yellow, below holes).
    Arms meet only at the hole center - no overlapping square behind the pocket.
    """;
    cush = rail - int(round(rail * 0.65));
    hr = int(round(HOLE_RADIUS));
    corner_stop = max(int(round(hr * 1.35)), cush + 2);
    parts = [
        '<g class="pool-cushion-inner-border pool-cushion-inner-border-corner"'
        ' pointer-events="none" fill-opacity="1" opacity="1">',
    ];
    # TL (0, 0): top arm +x, left arm +y
    parts.append(
        _cushion_path_svg(f'M 0 0 L {corner_stop} 0 L {corner_stop} {-cush} L 0 {-cush} Z')
    );
    parts.append(
        _cushion_path_svg(f'M 0 0 L 0 {corner_stop} L {-cush} {corner_stop} L {-cush} 0 Z')
    );
    # TR (w, 0): top arm -x, right arm +y
    parts.append(
        _cushion_path_svg(f'M {w} 0 L {w - corner_stop} 0 L {w - corner_stop} {-cush} L {w} {-cush} Z')
    );
    parts.append(
        _cushion_path_svg(f'M {w} 0 L {w} {corner_stop} L {w + cush} {corner_stop} L {w + cush} 0 Z')
    );
    # BL (0, l): bottom arm +x, left arm -y
    parts.append(
        _cushion_path_svg(f'M 0 {l} L {corner_stop} {l} L {corner_stop} {l + cush} L 0 {l + cush} Z')
    );
    parts.append(
        _cushion_path_svg(f'M 0 {l} L 0 {l - corner_stop} L {-cush} {l - corner_stop} L {-cush} {l} Z')
    );
    # BR (w, l): bottom arm -x, right arm -y
    parts.append(
        _cushion_path_svg(f'M {w} {l} L {w - corner_stop} {l} L {w - corner_stop} {l + cush} L {w} {l + cush} Z')
    );
    parts.append(
        _cushion_path_svg(f'M {w} {l} L {w} {l - corner_stop} L {w + cush} {l - corner_stop} L {w + cush} {l} Z')
    );
    parts.append('</g>');
    return ''.join(parts);

def _table_outer_border_svg(w, l, rail):
    """Rounded outer perimeter with thin dark-red stroke (sample-style frame).""";
    path, _ = _table_outer_rounded_path(w, l, rail);
    stroke_w = max(3, rail // 22);
    return (
        '<g class="pool-outer-border" pointer-events="none">'
        f'<path d="{path}" fill="none" stroke="#6b1414" stroke-width="{stroke_w}"'
        f' stroke-linejoin="round"/>'
        f'<path d="{path}" fill="none" stroke="#3d0808" stroke-width="{max(1, stroke_w // 2)}"'
        f' stroke-linejoin="round" transform="translate(0,{stroke_w * 0.15})" opacity="0.5"/>'
        '</g>'
    );

def _table_svg_header_footer():
    """Build table frame SVG (rails wide enough for pocket circles).""";
    rail = _table_rail_pad();
    w = int(round(TABLE_WIDTH));
    l = int(round(TABLE_LENGTH));
    # Landscape viewBox (post-rotor display), same convention as the old
    # viewBox="-25 -25 2750 1400": length along X, width along Y.
    vb_w = l + 2 * rail;
    vb_h = w + 2 * rail;
    svg_w = 1375;
    svg_h = int(round(svg_w * vb_h / vb_w));
    header = (
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>'
        ' <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"'
        ' "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">'
        f' <svg id="table-svg" width="{svg_w}" height="{svg_h}"'
        f' viewBox="-{rail} -{rail} {vb_w} {vb_h}" preserveAspectRatio="xMidYMid meet"'
        ' xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
        '<style>'
        '  #table-svg { user-select: none; -webkit-user-select: none; overflow: visible; }'
        '  #table-svg text { user-select: none; -webkit-user-select: none; pointer-events: none; }'
        '  #table-svg .pool-ball { user-select: none; -webkit-user-select: none; }'
        '  #table-svg .pool-ball > * { pointer-events: none; }'
        '  #table-svg .pool-ball-cue .pool-ball-hit { pointer-events: auto; cursor: grab; }'
        '  #table-svg .pool-ball-cue:active .pool-ball-hit { cursor: grabbing; }'
        '  #table-svg .pool-cushion-mat, #table-svg .pool-cushion-inner-border { opacity: 1; }'
        '  #table-svg .pool-cushion-face { fill-opacity: 1; opacity: 1; }'
        '</style>'
        '<defs>'
        '  <radialGradient id="felt-grad" cx="50%" cy="40%" r="65%">'
        '    <stop offset="0%" stop-color="#2c8b4a"/>'
        '    <stop offset="100%" stop-color="#155a2b"/>'
        '  </radialGradient>'
        '  <radialGradient id="pocket-hole" cx="50%" cy="50%" r="50%">'
        '    <stop offset="0%" stop-color="#050505"/>'
        '    <stop offset="65%" stop-color="#121212"/>'
        '    <stop offset="100%" stop-color="#2a2a2a"/>'
        '  </radialGradient>'
        '  <radialGradient id="ball-shade" cx="50%" cy="50%" r="50%">'
        '    <stop offset="60%" stop-color="rgba(0,0,0,0)"/>'
        '    <stop offset="100%" stop-color="rgba(0,0,0,0.35)"/>'
        '  </radialGradient>'
        f'{_table_svg_defs_3d(w, l, rail)}'
        '</defs>'
        # Must use TABLE_WIDTH (1350), not TABLE_LENGTH - matches legacy layout.
        f'<g id="table-rotor" transform="translate(0,{w}) rotate(-90)">'
        f'{_table_rails_svg(w, l, rail)}'
        f'<rect x="0" y="0" width="{w}" height="{l}" fill="url(#felt-grad)"/>'
        f'{_table_side_pocket_sockets_svg(w, l, rail)}'
        f'{_table_cushion_inner_border_svg(w, l, rail)}'
        f'{_table_corner_pocket_sockets_svg(w, l, rail)}'
        f'{_table_corner_cushion_inner_border_svg(w, l, rail)}'
        f'{_table_outer_border_svg(w, l, rail)}'
    );
    footer = '</g>\n</svg>\n';
    return header, footer;

# Ball colours (see https://billiards.colostate.edu/faq/ball/colors/).
# https://billiards.colostate.edu/faq/ball/colors/

BALL_COLOURS = [ 
    "WHITE",
    "#f2be13",   # 1 — yellow (solid)
    "#0e3d8c",   # 2 — blue (solid)
    "#c42230",   # 3 — red (solid)
    "#4c0e70",   # 4 — purple (solid)
    "#e0651c",   # 5 — orange (solid)
    "#0a5c2e",   # 6 — green (solid)
    "#6b1e1a",   # 7 — maroon/brown (solid)
    "#161616",   # 8 — black
    "#f2be13",   # 9 — yellow stripe
    "#0e3d8c",   # 10 — blue stripe
    "#c42230",   # 11 — red stripe
    "#4c0e70",   # 12 — purple stripe
    "#e0651c",   # 13 — orange stripe
    "#0a5c2e",   # 14 — green stripe
    "#6b1e1a",   # 15 — maroon stripe
    ];

# Render a single pool ball as SVG. Solids 1-7 are fully colored, the 8 is
# numbered ball carries a white badge with its number so the rack reads like

def _ball_svg(number, x, y):
    """Render one pool ball as SVG.""";
    r = int(round(BALL_RADIUS));
    cx = int(round(x));
    cy = int(round(y));
    # Cosmetics relative to the ball radius.
    disc_r    = max(6, int(round(r * 0.40)));   # number badge
    text_size = int(round(r * 0.62));            # number text
    band_h    = int(round(r * 1.00));            # stripe height
    gloss_rx  = int(round(r * 0.46));
    gloss_ry  = int(round(r * 0.20));
    gloss_dy  = int(round(r * 0.48));
    shade_r   = r;
    if number == 0:
        return (
            ' <g class="pool-ball pool-ball-cue" data-ball="0" data-cx="%d" data-cy="%d">'
            '<circle class="pool-ball-hit" cx="%d" cy="%d" r="%d" fill="#fafafa" stroke="#cccccc" stroke-width="1"/>'
            '<circle cx="%d" cy="%d" r="%d" fill="url(#ball-shade)"/>'
            '<g transform="rotate(90 %d %d)">'
            '<ellipse cx="%d" cy="%d" rx="%d" ry="%d" fill="#ffffff" opacity="0.55"/>'
            '</g>'
            '</g>\n'
        ) % (cx, cy, cx, cy, r, cx, cy, shade_r, cx, cy, cx, cy - gloss_dy, gloss_rx, gloss_ry);
    color = BALL_COLOURS[number];
    parts = [];
    parts.append('<g class="pool-ball" data-ball="%d" data-cx="%d" data-cy="%d">' % (number, cx, cy));
    if number <= 8:
        parts.append('<circle cx="%d" cy="%d" r="%d" fill="%s"/>' % (cx, cy, r, color));
    else:
        clip_id = "bclip-%d" % number;
        parts.append('<defs><clipPath id="%s"><circle cx="%d" cy="%d" r="%d"/></clipPath></defs>' % (clip_id, cx, cy, r));
        parts.append('<circle cx="%d" cy="%d" r="%d" fill="#fafafa"/>' % (cx, cy, r));
        # Orient the stripe band in DISPLAY space (horizontal on screen) by
        # counter-rotating it to undo the table-wide -90 rotation.
        parts.append(
            '<g transform="rotate(90 %d %d)">'
            '<rect x="%d" y="%d" width="%d" height="%d" fill="%s" clip-path="url(#%s)"/>'
            '</g>'
            % (cx, cy, cx - r, cy - band_h // 2, 2 * r, band_h, color, clip_id)
        );
    # Spherical shading (darken edges).
    parts.append('<circle cx="%d" cy="%d" r="%d" fill="url(#ball-shade)"/>' % (cx, cy, shade_r));
    # Counter-rotate the badge, number and gloss so they stay upright on screen.
    parts.append(
        '<g transform="rotate(90 %d %d)">'
        '<circle cx="%d" cy="%d" r="%d" fill="#fafafa"/>'
        '<text x="%d" y="%d" font-size="%d" text-anchor="middle" dominant-baseline="central" fill="#1a1a1a" font-family="Arial,Helvetica,sans-serif" font-weight="700">%d</text>'
        '<ellipse cx="%d" cy="%d" rx="%d" ry="%d" fill="#ffffff" opacity="0.45"/>'
        '</g>'
        % (cx, cy, cx, cy, disc_r, cx, cy, text_size, number, cx, cy - gloss_dy, gloss_rx, gloss_ry)
    );
    parts.append('</g>');
    return ' ' + "".join(parts) + '\n';

# Helper method to calculate acceleration

def calculate_acceleration( vel_x, vel_y ):
    """Calculate rolling-ball acceleration from velocity.""";
    rb_speed = math.sqrt( float(vel_x)**2 + float(vel_y)**2 );
    
    rb_acc_x = 0.0;
    rb_acc_y = 0.0;

    if rb_speed > VEL_EPSILON:
        if (vel_x != 0.0):
            rb_acc_x = -float(vel_x) * DRAG / rb_speed;
        if (vel_y != 0.0):
            rb_acc_y = -float(vel_y) * DRAG / rb_speed;

    return Coordinate( float(rb_acc_x), float(rb_acc_y) );

class Coordinate( phylib.phylib_coord ):
    """phylib_coord subclass for Python.""";
    pass;

class StillBall( phylib.phylib_object ):
    """Still ball wrapper.""";

    def __init__( self, number, pos ):
        """Create still ball: number and position (x, y).""";
        # Create generic phylib_object
        phylib.phylib_object.__init__( self,
                                       phylib.PHYLIB_STILL_BALL, 
                                       number, 
                                       pos, None, None, 
                                       0.0, 0.0 );
      
        self.__class__ = StillBall;

    def svg( self ):
        """Render this object as SVG.""";
        return _ball_svg(self.obj.still_ball.number, self.obj.still_ball.pos.x, self.obj.still_ball.pos.y);

class RollingBall( phylib.phylib_object ):
    """Rolling ball wrapper.""";

    def __init__( self, number, pos, vel, acc ):
        """Create rolling ball: number, position, velocity, acceleration.""";
        # Create generic phylib_object
        phylib.phylib_object.__init__( self,
                                       phylib.PHYLIB_ROLLING_BALL, 
                                       number, 
                                       pos, vel, acc, 
                                       0.0, 0.0 );
      
        self.__class__ = RollingBall;

    def svg( self ):
        """Render this object as SVG.""";
        return _ball_svg(self.obj.rolling_ball.number, self.obj.rolling_ball.pos.x, self.obj.rolling_ball.pos.y);

class Hole( phylib.phylib_object ):
    """Pocket hole wrapper.""";

    def __init__( self, pos ):
        """Create hole at position (x, y).""";
        # Create generic phylib_object
        phylib.phylib_object.__init__( self,
                                       phylib.PHYLIB_HOLE, 
                                       0, 
                                       pos, None, None, 
                                       0.0, 0.0 );
      
        self.__class__ = Hole;

    def svg( self ):
        """Render this object as SVG.""";
        x = int(round(self.obj.hole.pos.x));
        y = int(round(self.obj.hole.pos.y));
        r = int(round(HOLE_RADIUS));
        return (
            ' <g class="pool-pocket" pointer-events="none">'
            f'<circle cx="{x}" cy="{y}" r="{r}" fill="#000"/>'
            f'<circle cx="{x}" cy="{y}" r="{max(r - 5, 1)}" fill="url(#pocket-hole)"/>'
            f'<circle cx="{x}" cy="{y}" r="{max(r - 8, 1)}" fill="none" stroke="#2a2a2a" stroke-width="5"/>'
            f'<circle cx="{x}" cy="{y}" r="{max(r - 4, 1)}" fill="none" stroke="#4a4a4a" stroke-width="1.2" opacity="0.45"/>'
            '</g>\n'
        );

class HCushion( phylib.phylib_object ):
    """Horizontal cushion wrapper.""";

    def __init__( self, y ):
        """Create horizontal cushion at y.""";
        # Create generic phylib_object
        phylib.phylib_object.__init__( self,
                                       phylib.PHYLIB_HCUSHION, 
                                       0, 
                                       None, None, None, 
                                       0.0, y);
      
        self.__class__ = HCushion;

    def svg( self ):
        """Render this object as SVG.""";
        return "";

class VCushion( phylib.phylib_object ):
    """Vertical cushion wrapper.""";

    def __init__( self, x ):
        """Create vertical cushion at x.""";
        # Create generic phylib_object
        phylib.phylib_object.__init__( self,
                                       phylib.PHYLIB_VCUSHION, 
                                       0, 
                                       None, None, None, 
                                       x, 0.0);
      
        self.__class__ = VCushion;

    def svg( self ):
        """Render this object as SVG.""";
        return "";

class Table( phylib.phylib_table ):
    """Pool table (balls, cushions, holes).""";

    def __init__( self ):
        """Create empty table.""";
        phylib.phylib_table.__init__( self );
        self.current = -1;

    def __iadd__( self, other ):
        """Add object to table (table += obj).""";
        self.add_object( other );
        return self;

    def __iter__( self ):
        """Iterate over table objects.""";
        self.current = -1;
        return self;

    def __next__( self ):
        """Return next object or raise StopIteration.""";
        self.current += 1;  # increment the index to the next object
        if self.current < MAX_OBJECTS:   # check if there are no more objects
            return self[ self.current ]; # return the latest object
        self.current = -1;    # reset the index counter
        raise StopIteration;  # raise StopIteration to tell for loop to stop

    def __getitem__( self, index ):
        """Return object at index as the correct Python wrapper class.""";
        result = self.get_object( index ); 
        if result==None:
            return None;
        if result.type == phylib.PHYLIB_STILL_BALL:
            result.__class__ = StillBall;
        if result.type == phylib.PHYLIB_ROLLING_BALL:
            result.__class__ = RollingBall;
        if result.type == phylib.PHYLIB_HOLE:
            result.__class__ = Hole;
        if result.type == phylib.PHYLIB_HCUSHION:
            result.__class__ = HCushion;
        if result.type == phylib.PHYLIB_VCUSHION:
            result.__class__ = VCushion;
        return result;

    def __str__( self ):
        """Debug string of table time and objects.""";
        result = "";    # create empty string
        result += "time = %6.2f;\n" % self.time;    # append time
        for i,obj in enumerate(self): # loop over all objects and number them
            result += "  [%02d] = %s\n" % (i,obj);  # append object description
        return result;  # return the string

    def segment( self ):
        """Advance simulation one segment; return Table or None.""";
        result = phylib.phylib_table.segment( self );
        if result:
            result.__class__ = Table;
            result.current = -1;
        return result;

    def svg( self ):
        """Render this object as SVG.""";
        header, footer = _table_svg_header_footer();
        svg_str = header;
        for obj in self:
            if obj is None:
                continue;
            if isinstance(obj, (HCushion, VCushion)):
                continue;
            svg_str += obj.svg();
        svg_str += footer;

        return svg_str;

    def roll( self, t ):
        """Return the table state after rolling for a duration.""";
        new = Table();
        for ball in self:
            if isinstance( ball, RollingBall ):
                # create a new ball with the same number as the old ball
                new_ball = RollingBall( ball.obj.rolling_ball.number,
                                        Coordinate(0, 0),
                                        Coordinate(0, 0),
                                        Coordinate(0, 0) );
                # compute where it rolls to
                phylib.phylib_roll( new_ball, ball, t );

                # add ball to table
                new += new_ball;

            if isinstance( ball, StillBall ):
                # create a new ball with the same number and pos as the old ball
                new_ball = StillBall( ball.obj.still_ball.number,
                                      Coordinate( ball.obj.still_ball.pos.x, 
                                                 ball.obj.still_ball.pos.y ) );
                # add ball to table
                new += new_ball;
        return new;

    def cue_ball( self, vel_x, vel_y ):
        """
        Set up the Cue ball with the given x & y velocity.
        """;

        # Helper function to find the cue ball

        def find_cue_ball():
            """Find the cue ball on the table.""";
            for obj in self:
                if (isinstance(obj, StillBall) and obj.obj.still_ball.number == 0):
                    return obj;
            return None;
        
        # Call helper to find the cue ball
        cue_ball = find_cue_ball();

        # If the Cue Ball was found
        if cue_ball:
            # Retrieve the x & y values of cue ball's pos -> store them in temporary variables
            pos_x = cue_ball.obj.still_ball.pos.x;
            pos_y = cue_ball.obj.still_ball.pos.y;

            # Set the type attribute of the cue ball
            cue_ball.type = phylib.PHYLIB_ROLLING_BALL;

            # Recalculate acc parameters
            acc = calculate_acceleration( vel_x, vel_y );

            # Set all attributes of the cue ball
            cue_ball.obj.rolling_ball.pos.x = pos_x;
            cue_ball.obj.rolling_ball.pos.y = pos_y;
            cue_ball.obj.rolling_ball.vel.x = vel_x;
            cue_ball.obj.rolling_ball.vel.y = vel_y;
            cue_ball.obj.rolling_ball.acc.x = acc.x;
            cue_ball.obj.rolling_ball.acc.y = acc.y;
            cue_ball.obj.rolling_ball.number = 0;

# Trajectory sampling (10 ms steps, engine coordinates).

def _copy_as_table(t):
    """Copy a phylib table into a Pool table wrapper.""";
    raw = t.copy();
    raw.__class__ = Table;
    raw.current = -1;
    return raw;

def _append_trajectory_sample(samples, tbl, t):
    """Append one sampled trajectory frame.""";
    balls = {};
    for obj in tbl:
        if isinstance(obj, StillBall):
            n = str(int(obj.obj.still_ball.number));
            balls[n] = {"x": float(obj.obj.still_ball.pos.x), "y": float(obj.obj.still_ball.pos.y)};
        elif isinstance(obj, RollingBall):
            n = str(int(obj.obj.rolling_ball.number));
            balls[n] = {"x": float(obj.obj.rolling_ball.pos.x), "y": float(obj.obj.rolling_ball.pos.y)};
    samples.append({"t": float(t), "balls": balls});

def simulate_shot(start_table, xvel, yvel):
    """Run phylib segments; return end table, sunk balls, and trajectory dict.""";
    table = _copy_as_table(start_table);
    table.time = 0.0;
    table.cue_ball(xvel, yvel);
    samples = [];
    sunken_balls = [];
    end_table = None;
    while table:
        seg_start = table;
        start_time = table.time;
        table = table.segment();
        if table is None:
            rt = FRAME_INTERVAL;
            if start_time != 0.0001:
                seg_start.time += rt;
            new_table = seg_start.roll(rt);
            new_table.time = seg_start.time + rt;
            _append_trajectory_sample(samples, new_table, new_table.time);
            end_table = new_table;
            break;
        segment_len = math.floor((table.time - start_time) / FRAME_INTERVAL);
        for i in range(0, segment_len + 1):
            rt = i * FRAME_INTERVAL;
            new_table = seg_start.roll(rt);
            new_table.time = start_time + rt;
            _append_trajectory_sample(samples, new_table, new_table.time);
        segment_sunken = Game._diff_sunken(seg_start, table);
        sunken_balls.extend(segment_sunken);
        end_table = table;
    duration = float(samples[-1]["t"]) if samples else 0.0;
    trajectory = {"version": 1, "duration": duration, "samples": samples};
    return end_table, sunken_balls, trajectory;

class Game:

    @classmethod
    def from_snapshot(cls, snap: dict, *, app_game_id: str | None = None):
        """Load game state from a board_json snapshot.""";
        g = cls.__new__(cls);
        g.app_game_id = app_game_id;
        g.game_id = None;
        g.game_name = str(snap.get("game_name") or "Pool");
        g.player1_name = str(snap.get("p1_name") or "Player 1");
        g.player2_name = str(snap.get("p2_name") or "Player 2");
        g.player1_id = snap.get("player1_id") or "pass:p1";
        g.player2_id = snap.get("player2_id") or "pass:p2";
        g.current_player_id = snap.get("current_player_id") or g.player1_id;
        g.game_started = 1 if snap.get("game_started") else 0;
        g.game_over = 1 if snap.get("game_over") else 0;
        w = snap.get("winner") or "";
        if w == g.player1_name:
            g.winner = g.player1_id;
        elif w == g.player2_name:
            g.winner = g.player2_id;
        else:
            g.winner = None;
        g.winner_message = str(snap.get("winner_message") or "");

        def _norm_group(label):
            """Normalize a Pool group label.""";
            s = str(label or "").strip().lower();
            if s in ("high", "stripes", "stripe"):
                return "stripes";
            if s in ("low", "solids", "solid"):
                return "solids";
            return None;

        g.player1_playing = _norm_group(snap.get("p1_playing"));
        g.player2_playing = _norm_group(snap.get("p2_playing"));
        g.player1_score = int(snap.get("p1_score") or 0);
        g.player2_score = int(snap.get("p2_score") or 0);
        g.player1_photo_url = snap.get("p1_photo_url");
        g.player2_photo_url = snap.get("p2_photo_url");
        g.ball_in_hand_for = snap.get("ball_in_hand_for_player_id") or None;
        g._cached_table = None;
        return g;

    def __init__(
        self,
        game_id=None,
        game_name=None,
        player1_name=None,
        player2_name=None,
        current_player_id=None,
        game_started=None,
        player1_id=None,
        player2_id=None,
        player1_playing=None,
        player2_playing=None,
        player1_score=None,
        player2_score=None,
        game_over=None,
        winner=None,
        winner_message=None,
        app_game_id=None,
    ):
        """Initialize pool game metadata, seat ids, and default score fields.""";
        self.app_game_id = app_game_id;
        self.game_id = None;
        if not isinstance(game_name, str) or not isinstance(player1_name, str) or not isinstance(player2_name, str):
            raise TypeError("game_name, player1_name, player2_name must be str");
        self.game_name = game_name;
        self.player1_name = player1_name;
        self.player2_name = player2_name;
        self.player1_id = player1_id if player1_id is not None else "pass:p1";
        self.player2_id = player2_id if player2_id is not None else "pass:p2";
        if current_player_id is not None:
            self.current_player_id = current_player_id;
        else:
            self.current_player_id = random.choice([self.player1_id, self.player2_id]);
        self.game_started = int(game_started or 0);
        self.game_over = int(game_over or 0);
        self.winner = winner;
        self.winner_message = winner_message or "";
        self.player1_playing = player1_playing;
        self.player2_playing = player2_playing;
        self.player1_score = int(player1_score or 0);
        self.player2_score = int(player2_score or 0);
        self.player1_photo_url = None;
        self.player2_photo_url = None;
        self.ball_in_hand_for = None;
        self._cached_table = None;

    @staticmethod
    def _diff_sunken(old_table, new_table):
        """Return ball numbers present before the shot but missing after.""";
        sunken_balls = [];
        if old_table is None or new_table is None:
            return sunken_balls;
        for old_ball in old_table:
            if isinstance(old_ball, (StillBall, RollingBall)):
                exists = False;
                if isinstance(old_ball, StillBall):
                    old_ball_number = old_ball.obj.still_ball.number;
                else:
                    old_ball_number = old_ball.obj.rolling_ball.number;
                for new_ball in new_table:
                    if isinstance(new_ball, (StillBall, RollingBall)):
                        if isinstance(new_ball, StillBall):
                            new_ball_number = new_ball.obj.still_ball.number;
                        else:
                            new_ball_number = new_ball.obj.rolling_ball.number;
                        if old_ball_number == new_ball_number:
                            exists = True;
                            break;
                if not exists:
                    sunken_balls.append(old_ball_number);
        return sunken_balls;

    def apply_shot(self, table, xvel, yvel):
        """Apply shot.""";
        if int(self.game_started or 0) == 0:
            self.game_started = 1;
        # Any shot commits prior ball-in-hand placement (receiver may have moved
        # the cue several times before shooting).
        self.ball_in_hand_for = None;
        shooter_id = self.current_player_id;
        end_table, sunken_balls, trajectory = simulate_shot(table, xvel, yvel);
        if end_table is None:
            end_table = _copy_as_table(table);
        self._assign_player_groups(sunken_balls, self.player1_id, self.player2_id, self.current_player_id);
        self._update_game_status(
            self.current_player_id,
            self.player1_id,
            self.player2_id,
            sunken_balls,
            end_table,
        );
        end_table = self.get_next_table_for_shot(table, end_table);
        self._cached_table = end_table;
        # Ball-in-hand: if the shooter scratched (sank the cue), the *receiver*
        # gets to place the cue anywhere. Don't set it if the game just ended
        # so we never block the game-over banner with a place-cue prompt.
        if CUE_BALL in sunken_balls and int(self.game_over or 0) == 0:
            receiver_id = (
                self.player2_id if shooter_id == self.player1_id else self.player1_id
            );
            self.ball_in_hand_for = receiver_id;
        else:
            self.ball_in_hand_for = None;
        return trajectory, end_table;

    def _cue_wall_margin(self) -> float:
        """Return cue-ball wall clearance.""";
        return float(BALL_RADIUS) + 1.0;

    def _cue_hole_margin(self) -> float:
        """Return cue-ball hole clearance.""";
        return float(HOLE_RADIUS) + float(BALL_RADIUS) + 1.0;

    def _cue_ball_min_sep(self) -> float:
        """Return minimum cue-ball object spacing.""";
        return float(BALL_DIAMETER) + 1.0;

    def _iter_table_balls(self, table):
        """Iterate over balls on the table.""";
        for ball in table or []:
            if isinstance(ball, StillBall):
                yield int(ball.obj.still_ball.number), ball.obj.still_ball.pos;
            elif isinstance(ball, RollingBall):
                yield int(ball.obj.rolling_ball.number), ball.obj.rolling_ball.pos;

    def _is_valid_cue_xy(self, table, x, y, *, ignore_cue: bool = False) -> bool:
        """True when (x, y) is a legal cue-ball center on this table layout.""";
        x = float(x);
        y = float(y);
        wall_margin = self._cue_wall_margin();
        if not (wall_margin <= x <= float(TABLE_WIDTH) - wall_margin):
            return False;
        if not (wall_margin <= y <= float(TABLE_LENGTH) - wall_margin):
            return False;
        hole_margin = self._cue_hole_margin();
        for hx, hy in TABLE_HOLES:
            dx = float(hx) - x;
            dy = float(hy) - y;
            if (dx * dx + dy * dy) ** 0.5 < hole_margin:
                return False;
        min_sep = self._cue_ball_min_sep();
        for num, pos in self._iter_table_balls(table):
            if ignore_cue and num == CUE_BALL:
                continue;
            dx = float(pos.x) - x;
            dy = float(pos.y) - y;
            if (dx * dx + dy * dy) ** 0.5 < min_sep:
                return False;
        return True;

    def _min_clearance_to_objects(self, table, x, y, *, ignore_cue: bool = False) -> float:
        """Smallest center-to-center gap minus required separation (larger is more open).""";
        min_sep = self._cue_ball_min_sep();
        best = float("inf");
        for num, pos in self._iter_table_balls(table):
            if ignore_cue and num == CUE_BALL:
                continue;
            dx = float(pos.x) - x;
            dy = float(pos.y) - y;
            gap = math.hypot(dx, dy) - min_sep;
            if gap < best:
                best = gap;
        return best;

    def _find_open_cue_placement(self, table) -> Coordinate | None:
        """Pick an open table spot for ball-in-hand after a scratch.""";
        wall_margin = self._cue_wall_margin();
        step = self._cue_ball_min_sep();
        best_xy = None;
        best_gap = -float("inf");
        y = wall_margin;
        y_max = float(TABLE_LENGTH) - wall_margin;
        x_max = float(TABLE_WIDTH) - wall_margin;
        while y <= y_max:
            x = wall_margin;
            while x <= x_max:
                if self._is_valid_cue_xy(table, x, y):
                    gap = self._min_clearance_to_objects(table, x, y);
                    if gap > best_gap:
                        best_gap = gap;
                        best_xy = (x, y);
                x += step;
            y += step;
        if best_xy is None:
            fine = step * 0.5;
            y = wall_margin;
            while y <= y_max and best_xy is None:
                x = wall_margin;
                while x <= x_max:
                    if self._is_valid_cue_xy(table, x, y):
                        gap = self._min_clearance_to_objects(table, x, y);
                        if gap > best_gap:
                            best_gap = gap;
                            best_xy = (x, y);
                    x += fine;
                y += fine;
        if best_xy is None:
            return None;
        return Coordinate(best_xy[0], best_xy[1]);

    def place_cue(self, table, x, y):
        """Place cue ball at (x, y). Raises ValueError if too close to wall, pocket, or ball.""";
        x = float(x);
        y = float(y);
        if not self._is_valid_cue_xy(table, x, y, ignore_cue=True):
            wall_margin = self._cue_wall_margin();
            if not (wall_margin <= x <= float(TABLE_WIDTH) - wall_margin):
                raise ValueError("Cue ball is too close to the cushion");
            if not (wall_margin <= y <= float(TABLE_LENGTH) - wall_margin):
                raise ValueError("Cue ball is too close to the cushion");
            hole_margin = self._cue_hole_margin();
            for hx, hy in TABLE_HOLES:
                dx = float(hx) - x;
                dy = float(hy) - y;
                if (dx * dx + dy * dy) ** 0.5 < hole_margin:
                    raise ValueError("Cue ball is too close to a pocket");
            raise ValueError("Cue ball would overlap another ball");
        cue_index = None;
        for idx, ball in enumerate(table):
            if isinstance(ball, StillBall):
                num = ball.obj.still_ball.number;
            elif isinstance(ball, RollingBall):
                num = ball.obj.rolling_ball.number;
            else:
                continue;
            if num == CUE_BALL:
                cue_index = idx;
                break;
        if cue_index is None:
            table += StillBall(CUE_BALL, Coordinate(x, y));
        else:
            cue_ball = table[cue_index];
            if isinstance(cue_ball, RollingBall):
                cue_ball.type = phylib.PHYLIB_STILL_BALL;
                cue_ball.obj.still_ball.number = CUE_BALL;
                cue_ball.obj.still_ball.pos.x = x;
                cue_ball.obj.still_ball.pos.y = y;
            else:
                cue_ball.obj.still_ball.pos.x = x;
                cue_ball.obj.still_ball.pos.y = y;
        self._cached_table = table;
        return table;

    def _assign_player_groups(self, sunken_balls, player1_id, player2_id, current_player_id):
        """Assign solids or stripes after a shot.""";
        if self.player1_playing is not None or self.player2_playing is not None:
            return;
        if len(sunken_balls) == 0:
            return;
        first_sunk = sunken_balls[0];
        if first_sunk == CUE_BALL:
            if len(sunken_balls) > 1:
                first_sunk = sunken_balls[1];
            else:
                return;
        other_id = player2_id if current_player_id == player1_id else player1_id;
        if first_sunk in SOLIDS_RANGE:
            self._set_group_for_id(current_player_id, "solids", player1_id, player2_id);
            self._set_group_for_id(other_id, "stripes", player1_id, player2_id);
        elif first_sunk in STRIPES_RANGE:
            self._set_group_for_id(current_player_id, "stripes", player1_id, player2_id);
            self._set_group_for_id(other_id, "solids", player1_id, player2_id);

    def _set_group_for_id(self, pid, group, player1_id, player2_id):
        """Set the Pool group for one player id.""";
        if pid == player1_id:
            self.player1_playing = group;
        elif pid == player2_id:
            self.player2_playing = group;

    def _get_cue_ball_pos(self, tbl):
        """Return the cue ball position.""";
        for ball in tbl:
            if isinstance(ball, StillBall) and ball.obj.still_ball.number == CUE_BALL:
                return Coordinate(ball.obj.still_ball.pos.x, ball.obj.still_ball.pos.y);
            if isinstance(ball, RollingBall) and ball.obj.rolling_ball.number == CUE_BALL:
                return Coordinate(ball.obj.rolling_ball.pos.x, ball.obj.rolling_ball.pos.y);
        return None;

    def get_next_table_for_shot(self, first_table, last_table):
        """Choose the next table state after a shot.""";
        cue_ball_pos = self._get_cue_ball_pos(last_table);
        if cue_ball_pos is None:
            if self.ball_in_hand_for:
                open_pos = self._find_open_cue_placement(last_table);
                if open_pos is not None:
                    last_table += StillBall(CUE_BALL, open_pos);
            else:
                cue_ball_pos = self._get_cue_ball_pos(first_table);
                if cue_ball_pos is not None:
                    last_table += StillBall(CUE_BALL, cue_ball_pos);
        elif self.ball_in_hand_for:
            cx = float(cue_ball_pos.x);
            cy = float(cue_ball_pos.y);
            if not self._is_valid_cue_xy(last_table, cx, cy, ignore_cue=True):
                open_pos = self._find_open_cue_placement(last_table);
                if open_pos is not None:
                    self.place_cue(last_table, open_pos.x, open_pos.y);
        return last_table;

    def _opponent_id(self, player_id, player1_id, player2_id):
        """Return the other player id.""";
        return player2_id if player_id == player1_id else player1_id;

    def _shooter_group(self, current_player_id, player1_id, player2_id):
        """Return the shooter group.""";
        if current_player_id == player1_id:
            return self.player1_playing;
        if current_player_id == player2_id:
            return self.player2_playing;
        return None;

    def _ball_number_on_table_obj(self, ball):
        """Return the ball number for a table object.""";
        if isinstance(ball, StillBall):
            return int(ball.obj.still_ball.number);
        if isinstance(ball, RollingBall):
            return int(ball.obj.rolling_ball.number);
        return None;

    def _group_remaining_on_table(self, table, group):
        """Return whether a group still has balls on the table.""";
        if group not in ("solids", "stripes"):
            return -1;
        ball_range = SOLIDS_RANGE if group == "solids" else STRIPES_RANGE;
        remaining = 0;
        for ball in table or []:
            num = self._ball_number_on_table_obj(ball);
            if num is not None and num in ball_range:
                remaining += 1;
        return remaining;

    def _shooter_cleared_group(self, current_player_id, player1_id, player2_id, table):
        """True when every ball of the shooter's group is off the table (legal 8-ball win).""";
        group = self._shooter_group(current_player_id, player1_id, player2_id);
        if group not in ("solids", "stripes") or table is None:
            return False;
        return self._group_remaining_on_table(table, group) == 0;

    def _legal_group_pocketed_this_shot(self, current_player_id, player1_id, player2_id, sunken_balls):
        """Return whether the shot pocketed a legal group ball.""";
        group = self._shooter_group(current_player_id, player1_id, player2_id);
        if group not in ("solids", "stripes"):
            return 0;
        legal = 0;
        for ball in sunken_balls:
            if ball == CUE_BALL or ball == EIGHT_BALL:
                continue;
            if group == "solids" and ball in SOLIDS_RANGE:
                legal += 1;
            elif group == "stripes" and ball in STRIPES_RANGE:
                legal += 1;
        return legal;

    def _score_increments_for_shooter(self, current_player_id, player1_id, player2_id, sunken_balls):
        """Count only object balls from the shooter's group (wrong balls stay down, no score).""";
        group = self._shooter_group(current_player_id, player1_id, player2_id);
        if group not in ("solids", "stripes"):
            return 0, 0;
        legal = 0;
        for ball in sunken_balls:
            if ball == CUE_BALL or ball == EIGHT_BALL:
                continue;
            if group == "solids" and ball in SOLIDS_RANGE:
                legal += 1;
            elif group == "stripes" and ball in STRIPES_RANGE:
                legal += 1;
        if current_player_id == player1_id:
            return legal, 0;
        return 0, legal;

    def _update_game_status(self, current_player_id, player1_id, player2_id, sunken_balls, end_table=None):
        """Update game status after a shot.""";
        opponent_id = self._opponent_id(current_player_id, player1_id, player2_id);
        scratched = CUE_BALL in sunken_balls;

        if len(sunken_balls) == 0:
            self.current_player_id = opponent_id;
            return;
        if len(sunken_balls) == 1 and sunken_balls[0] == CUE_BALL:
            self.current_player_id = opponent_id;
            return;

        p1_score = int(self.player1_score or 0);
        p2_score = int(self.player2_score or 0);
        current_player_score = p1_score if player1_id == current_player_id else p2_score;

        if EIGHT_BALL in sunken_balls:
            current_player_name = self.player1_name if player1_id == current_player_id else self.player2_name;
            if scratched:
                msg = "eight_ball_scratch";
                self._set_game_over(msg, opponent_id);
                return;
            cleared = self._shooter_cleared_group(
                current_player_id, player1_id, player2_id, end_table
            );
            if not cleared:
                legal_now = self._legal_group_pocketed_this_shot(
                    current_player_id, player1_id, player2_id, sunken_balls
                );
                cleared = (current_player_score + legal_now) >= 7;
            if cleared:
                msg = "eight_ball_win";
                self._set_game_over(msg, current_player_id);
            else:
                msg = "eight_ball_early";
                self._set_game_over(msg, opponent_id);
            return;

        p1_inc, p2_inc = self._score_increments_for_shooter(
            current_player_id, player1_id, player2_id, sunken_balls
        );
        if p1_inc or p2_inc:
            self.player1_score = p1_score + p1_inc;
            self.player2_score = p2_score + p2_inc;

        if scratched:
            self.current_player_id = opponent_id;
            return;

        p1_playing = self.player1_playing;
        p2_playing = self.player2_playing;
        if p1_playing is None or p2_playing is None:
            return;
        shooter_legal = p1_inc if current_player_id == player1_id else p2_inc;
        if shooter_legal == 0:
            self.current_player_id = opponent_id;
            return;

    def _set_game_over(self, message, winner_id):
        """Set the terminal Pool result.""";
        self.game_over = 1;
        self.winner_message = message;
        self.winner = winner_id;

    def surrender(self, winner_id, message):
        """Apply surrender.""";
        self._set_game_over(message, winner_id);
