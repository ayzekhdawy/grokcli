#!/usr/bin/env bash
# Generate Tauri app icons + tray icons from two separate sources.
# Do NOT mix pipelines:
#   App dock / .exe / .icns  ←  AppIcon.appiconset (authored sizes; never resample)
#   Menu bar / system tray  ←  docs/svg/logo.svg  (macOS template + Windows badges)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICONS="$ROOT/src-tauri/icons"
SVG="$ROOT/docs/svg/logo.svg"
PROD_SET="$ICONS/AppIcon.appiconset"
DEV_SET="$ICONS/dev/AppIcon.appiconset"

if [[ ! -d "$PROD_SET" ]]; then
  echo "Missing production appiconset: $PROD_SET" >&2
  exit 1
fi
if [[ ! -f "$SVG" ]]; then
  echo "Missing tray source: docs/svg/logo.svg" >&2
  exit 1
fi

if ! command -v magick >/dev/null 2>&1 && ! command -v convert >/dev/null 2>&1; then
  echo "ImageMagick (magick/convert) required for SVG → tray PNG" >&2
  exit 1
fi
IM=magick
command -v magick >/dev/null 2>&1 || IM=convert

# App icons: pack authored 16/32/64/128/256/512/1024 rasters. No sips -z.
python3 "$ROOT/scripts/pack_appiconset.py" "$PROD_SET" --dest "$ICONS" --ico "$ICONS/icon.ico"
if [[ -d "$DEV_SET" ]]; then
  python3 "$ROOT/scripts/pack_appiconset.py" "$DEV_SET" --dest "$ICONS/dev"
fi

# ── Tray / menu-bar from logo.svg ───────────────────────────────────────────
# tray-icon crate sizes the NSImage to 18pt tall. Embed 36px (@2x) so retina
# is sharp. Pad content ~14% so the mark doesn't fill the bar as a solid blob.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
python3 - <<'PY' "$SVG" "$TMP/logo-black.svg"
import re, sys
from pathlib import Path
t = Path(sys.argv[1]).read_text()
t = t.replace("currentColor", "#000000")
t = re.sub(r'\sclass="[^"]*"', "", t)
Path(sys.argv[2]).write_text(t)
PY

$IM -background none -density 400 "$TMP/logo-black.svg" -resize 512x512 "$TMP/hi.png"

python3 - <<'PY' "$TMP" "$ICONS"
from pathlib import Path
import sys
from PIL import Image

tmp, icons = Path(sys.argv[1]), Path(sys.argv[2])
hi = Image.open(tmp / "hi.png").convert("RGBA")
pix = hi.load()
w, h = hi.size
xs, ys = [], []
for y in range(h):
    for x in range(w):
        if pix[x, y][3] > 8:
            xs.append(x)
            ys.append(y)
if not xs:
    raise SystemExit("SVG raster empty — check logo.svg / currentColor")
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
m = 4
crop = hi.crop((max(0, x0 - m), max(0, y0 - m), min(w, x1 + 1 + m), min(h, y1 + 1 + m)))

def pack(src: Image.Image, size: int, pad_ratio: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = max(1, int(round(size * (1.0 - 2 * pad_ratio))))
    cw, ch = src.size
    scale = min(inner / cw, inner / ch)
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
    _r, _g, _b, a = resized.split()
    a = a.point(lambda v: min(255, int(v * 1.15)) if v > 12 else 0)
    black = Image.new("L", resized.size, 0)
    resized = Image.merge("RGBA", (black, black, black, a))
    ox, oy = (size - nw) // 2, (size - nh) // 2
    canvas.alpha_composite(resized, (ox, oy))
    return canvas

outs = {
    "tray-icon.png": (36, 0.14),
    "tray-icon@2x.png": (36, 0.14),
    "tray-icon-18.png": (18, 0.14),
    "tray-16.png": (16, 0.12),
    "tray-32.png": (32, 0.12),
    "tray-source.png": (128, 0.10),
}
for name, (sz, pad) in outs.items():
    im = pack(crop, sz, pad)
    im.save(icons / name, "PNG")
    n = sum(1 for p in im.getdata() if p[3] > 20)
    print(f"{name}: {sz}x{sz} opaque={n}")
    if sz <= 36 and n < 40:
        raise SystemExit(f"{name} looks too empty (opaque={n})")
PY

# Windows notification area: no template invert. High-contrast badges
# follow the *taskbar* theme (see tray.rs + SystemUsesLightTheme).
python3 "$ROOT/scripts/tray_win_badge.py" "$ICONS/tray-32.png" "$ICONS"

echo "OK — app icons from: $PROD_SET (no resample)"
echo "OK — tray icons from: $SVG (36px @2x for 18pt menu bar)"
echo "OK — Windows tray badges: tray-win-light.png / tray-win-dark.png"
echo "Remember: dock uses icon*.png/icns/ico; tray uses tray-*.png only."
