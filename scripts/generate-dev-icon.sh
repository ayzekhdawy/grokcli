#!/usr/bin/env bash
# White dock icon for `pnpm dev` only. Packs icons/dev/AppIcon.appiconset
# at authored pixel sizes — never invert or resample the black master.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SET="$ROOT/src-tauri/icons/dev/AppIcon.appiconset"
OUT="$ROOT/src-tauri/icons/dev"
[[ -d "$SET" ]] || { echo "missing $SET" >&2; exit 1; }
python3 "$ROOT/scripts/pack_appiconset.py" "$SET" --dest "$OUT"
echo "wrote $OUT/icon.icns"
