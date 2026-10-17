"""Crop a macOS-padded app icon so Windows .ico glyphs fill the canvas.

macOS master artwork (icon-source.png) keeps ~8% transparent margin for the
dock grid. Windows taskbar / Start draws the whole .ico frame, so that margin
makes Grok look a size smaller than neighboring apps.

This module only produces a fill-cropped raster. generate-icons.sh still
builds .icns / PNG sizes from the untouched master.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image


def opaque_bbox(im: Image.Image, alpha_min: int = 128) -> tuple[int, int, int, int] | None:
    """Inclusive bbox of pixels with alpha > alpha_min. None if fully empty."""
    src = im.convert("RGBA")
    pix = src.load()
    w, h = src.size
    xs: list[int] = []
    ys: list[int] = []
    for y in range(h):
        for x in range(w):
            if pix[x, y][3] > alpha_min:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def fill_ratio(im: Image.Image, alpha_min: int = 128) -> float:
    """Opaque-content width / canvas width (square-ish; uses the larger axis)."""
    box = opaque_bbox(im, alpha_min)
    if box is None:
        return 0.0
    x0, y0, x1, y1 = box
    cw, ch = im.size
    if cw <= 0 or ch <= 0:
        return 0.0
    return min((x1 - x0 + 1) / cw, (y1 - y0 + 1) / ch)


def crop_to_fill(
    im: Image.Image,
    *,
    pad_ratio: float = 0.02,
    alpha_min: int = 128,
) -> Image.Image:
    """Return a square RGBA image whose opaque mark nearly fills the canvas.

    `pad_ratio` is leftover transparent margin on each side (Windows wants
    almost none; 2% avoids clipping anti-aliased edges).
    """
    src = im.convert("RGBA")
    box = opaque_bbox(src, alpha_min)
    if box is None:
        return src
    x0, y0, x1, y1 = box
    content = src.crop((x0, y0, x1 + 1, y1 + 1))
    cw, ch = content.size
    side = max(cw, ch)
    pad = max(0, int(round(side * pad_ratio)))
    canvas_side = max(1, side + pad * 2)
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    ox = (canvas_side - cw) // 2
    oy = (canvas_side - ch) // 2
    canvas.paste(content, (ox, oy), content)
    return canvas


ICO_SIZES = (256, 128, 64, 48, 32, 24, 16)


def write_filled_png(src: Path, dest: Path, *, pad_ratio: float = 0.02) -> Path:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out = crop_to_fill(Image.open(src), pad_ratio=pad_ratio)
    out.save(dest)
    return dest


def write_filled_ico(
    src: Path,
    dest: Path,
    *,
    pad_ratio: float = 0.02,
    sizes: tuple[int, ...] = ICO_SIZES,
) -> Path:
    """Write a multi-size .ico from a fill-cropped raster (no ImageMagick)."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    filled = crop_to_fill(Image.open(src), pad_ratio=pad_ratio)
    # Resize from the filled square so every ICO frame stays edge-filled.
    frames = [
        filled.resize((n, n), Image.Resampling.LANCZOS) for n in sizes
    ]
    frames[0].save(
        dest,
        format="ICO",
        sizes=[(n, n) for n in sizes],
        append_images=frames[1:],
    )
    return dest


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("src", type=Path)
    p.add_argument("dest", type=Path)
    p.add_argument("--pad-ratio", type=float, default=0.02)
    p.add_argument(
        "--format",
        choices=("png", "ico", "auto"),
        default="auto",
        help="auto: dest suffix (.ico vs .png)",
    )
    args = p.parse_args()
    fmt = args.format
    if fmt == "auto":
        fmt = "ico" if args.dest.suffix.lower() == ".ico" else "png"
    if fmt == "ico":
        write_filled_ico(args.src, args.dest, pad_ratio=args.pad_ratio)
    else:
        write_filled_png(args.src, args.dest, pad_ratio=args.pad_ratio)
