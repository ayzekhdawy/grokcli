"""Tests for the Windows .ico fill-crop helper (Issue #650)."""

from __future__ import annotations

import unittest
from pathlib import Path

from PIL import Image

from windows_ico_fill import crop_to_fill, fill_ratio, opaque_bbox, write_filled_png


def _padded_mark(canvas: int = 100, mark: int = 80) -> Image.Image:
    """Opaque square inset in a larger transparent canvas (macOS-grid style)."""
    im = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    origin = (canvas - mark) // 2
    blob = Image.new("RGBA", (mark, mark), (20, 180, 80, 255))
    im.paste(blob, (origin, origin), blob)
    return im


class WindowsIcoFillTest(unittest.TestCase):
    def test_bbox_finds_inset_mark(self) -> None:
        im = _padded_mark(100, 80)
        self.assertEqual(opaque_bbox(im), (10, 10, 89, 89))

    def test_padded_master_fill_is_about_80_percent(self) -> None:
        im = _padded_mark(100, 80)
        self.assertAlmostEqual(fill_ratio(im), 0.8, places=2)

    def test_crop_fills_windows_canvas(self) -> None:
        im = _padded_mark(100, 80)
        out = crop_to_fill(im, pad_ratio=0.02)
        # 80px mark + 2% pad each side ≈ 83px canvas → fill ≈ 80/83 ≈ 0.96
        self.assertGreaterEqual(fill_ratio(out), 0.94)
        self.assertLessEqual(fill_ratio(out), 1.0)
        self.assertEqual(out.size[0], out.size[1])

    def test_zero_pad_is_edge_to_edge(self) -> None:
        im = _padded_mark(100, 80)
        out = crop_to_fill(im, pad_ratio=0.0)
        self.assertEqual(out.size, (80, 80))
        self.assertAlmostEqual(fill_ratio(out), 1.0, places=2)

    def test_empty_image_passthrough(self) -> None:
        im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        out = crop_to_fill(im)
        self.assertEqual(out.size, (16, 16))
        self.assertEqual(fill_ratio(out), 0.0)

    def test_write_filled_png_roundtrip(self) -> None:
        import tempfile

        src = _padded_mark(64, 48)
        with tempfile.TemporaryDirectory() as td:
            src_path = Path(td) / "src.png"
            dest = Path(td) / "filled.png"
            src.save(src_path)
            write_filled_png(src_path, dest, pad_ratio=0.02)
            written = Image.open(dest)
            self.assertGreaterEqual(fill_ratio(written), 0.94)

    def test_write_filled_ico_frames_are_filled(self) -> None:
        import tempfile

        from windows_ico_fill import write_filled_ico

        src = _padded_mark(128, 96)
        with tempfile.TemporaryDirectory() as td:
            src_path = Path(td) / "src.png"
            dest = Path(td) / "icon.ico"
            src.save(src_path)
            write_filled_ico(src_path, dest, pad_ratio=0.02)
            ico = Image.open(dest)
            self.assertGreaterEqual(fill_ratio(ico), 0.94)


class GenerateIconsScriptContractTest(unittest.TestCase):
    """The shipped shell script must crop only the .ico path."""

    def test_script_builds_ico_from_filled_raster_not_master(self) -> None:
        script = Path(__file__).with_name("generate-icons.sh").read_text()
        self.assertIn("windows_ico_fill.py", script)
        self.assertIn('"$ICONS/icon.ico"', script)
        # macOS master / icns stay on $MASTER
        self.assertIn('iconutil -c icns "$ICONSET" -o "$ICONS/icon.icns"', script)
        self.assertNotIn('$IM "$MASTER" -define icon:auto-resize', script)

    def test_shipped_icon_ico_is_fill_cropped(self) -> None:
        ico_path = Path(__file__).resolve().parents[1] / "src-tauri" / "icons" / "icon.ico"
        master = Path(__file__).resolve().parents[1] / "src-tauri" / "icons" / "icon-source.png"
        self.assertTrue(ico_path.is_file(), ico_path)
        self.assertTrue(master.is_file(), master)
        ico = Image.open(ico_path)
        src = Image.open(master)
        # Master keeps the macOS dock-grid margin; the shipped ICO must not.
        self.assertLess(fill_ratio(src), 0.90)
        self.assertGreaterEqual(fill_ratio(ico), 0.94)
        ico.close()
        src.close()


if __name__ == "__main__":
    unittest.main()
