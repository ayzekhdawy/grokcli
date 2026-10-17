#!/usr/bin/env python3
"""Refresh circular-avatar contributor galleries in README files.

Source of truth: GitHub Contributors API for RongleCat/grok-app.
Replaces the block between <!-- CONTRIBUTORS:START --> and <!-- CONTRIBUTORS:END -->
in README.md / README_EN.md / README_ZH.md / README_RU.md.

Rules (docs/llm-wiki/release.md):
  - One presentation only: circular avatars (no table, no contrib.rocks strip).
  - Every release must re-run this script so the gallery stays complete.

Usage:
  python3 scripts/update-contributors.py
  python3 scripts/update-contributors.py --dry-run
  GITHUB_TOKEN=… python3 scripts/update-contributors.py   # higher rate limit
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = "RongleCat/grok-app"
API = f"https://api.github.com/repos/{REPO}/contributors?per_page=100"
MARKER_START = "<!-- CONTRIBUTORS:START -->"
MARKER_END = "<!-- CONTRIBUTORS:END -->"

# Avatar size in the gallery (px). GitHub serves square; we crop via border-radius.
AVATAR_PX = 72
AVATAR_SRC_SIZE = 96

README_FILES = (
    "README.md",
    "README_EN.md",
    "README_ZH.md",
    "README_RU.md",
)

# Skip automation / bot accounts (not human contributors).
BOT_LOGINS = {
    "dependabot[bot]",
    "dependabot",
    "github-actions[bot]",
    "github-actions",
    "renovate[bot]",
    "renovate",
    "imgbot[bot]",
    "imgbot",
}


def fetch_contributors() -> list[dict]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "grok-app-update-contributors",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(API, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:400]
        raise SystemExit(f"GitHub API HTTP {e.code}: {body}") from e
    except urllib.error.URLError as e:
        raise SystemExit(f"GitHub API network error: {e}") from e

    if not isinstance(data, list):
        raise SystemExit(f"unexpected API payload: {type(data)}")

    out: list[dict] = []
    for row in data:
        login = (row.get("login") or "").strip()
        if not login:
            continue
        if login in BOT_LOGINS or login.endswith("[bot]"):
            continue
        if row.get("type") == "Bot":
            continue
        out.append(
            {
                "login": login,
                "contributions": int(row.get("contributions") or 0),
                "html_url": row.get("html_url") or f"https://github.com/{login}",
            }
        )
    # API is already contributions-desc; keep stable sort.
    out.sort(key=lambda c: (-c["contributions"], c["login"].lower()))
    return out


def avatar_img(login: str) -> str:
    # Circular crop via inline style (GitHub README HTML allows border-radius).
    src = f"https://github.com/{login}.png?size={AVATAR_SRC_SIZE}"
    return (
        f'<a href="https://github.com/{login}" title="{login}">'
        f'<img src="{src}" width="{AVATAR_PX}" height="{AVATAR_PX}" '
        f'alt="{login}" style="border-radius:50%" /></a>'
    )


def render_gallery(contributors: list[dict], *, lang: str) -> str:
    today = date.today().isoformat()
    if lang == "zh":
        thanks = (
            f"感谢所有为 Grok App 做出贡献的人！"
            f"以下为 GitHub 仓库全部人类贡献者（按 commits 降序，{today} 更新）。"
        )
        graph = "完整贡献图"
    elif lang == "ru":
        thanks = (
            f"Спасибо всем, кто внёс вклад в Grok App. "
            f"Все участники GitHub — люди (по числу коммитов, обновлено {today})."
        )
        graph = "Полный граф участников"
    else:
        thanks = (
            f"Thanks to everyone who has contributed to Grok App. "
            f"All human GitHub contributors (by commit count, updated {today})."
        )
        graph = "Full contributors graph"

    # Wrap avatars with non-breaking spaces for readable spacing on GitHub.
    parts = [avatar_img(c["login"]) for c in contributors]
    # 4 spaces between for light separation without tables.
    joined = "\n  ".join(parts)

    lines = [
        MARKER_START,
        thanks,
        "",
        '<p align="center">',
        f"  {joined}",
        "</p>",
        "",
        f"[{graph} →](https://github.com/{REPO}/graphs/contributors)",
        MARKER_END,
    ]
    return "\n".join(lines) + "\n"


def lang_for_path(path: Path) -> str:
    name = path.name.lower()
    if name in ("readme_zh.md", "readme.zh.md"):
        return "zh"
    if name in ("readme_ru.md", "readme.ru.md"):
        return "ru"
    return "en"


def patch_file(path: Path, block: str, *, dry_run: bool) -> bool:
    if not path.is_file():
        print(f"skip missing: {path.relative_to(ROOT)}", file=sys.stderr)
        return False
    text = path.read_text(encoding="utf-8")
    if MARKER_START not in text or MARKER_END not in text:
        raise SystemExit(
            f"{path.relative_to(ROOT)}: missing {MARKER_START} / {MARKER_END} markers. "
            "Add them once around the contributors gallery."
        )
    pattern = re.compile(
        re.escape(MARKER_START) + r".*?" + re.escape(MARKER_END),
        re.DOTALL,
    )
    new_text, n = pattern.subn(block.rstrip("\n"), text, count=1)
    if n != 1:
        raise SystemExit(f"{path.relative_to(ROOT)}: failed to replace contributors block")
    if new_text == text:
        print(f"unchanged: {path.relative_to(ROOT)}")
        return False
    if dry_run:
        print(f"would update: {path.relative_to(ROOT)}")
        return True
    path.write_text(new_text, encoding="utf-8")
    print(f"updated: {path.relative_to(ROOT)}")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="fetch and show what would change without writing",
    )
    args = ap.parse_args()

    contributors = fetch_contributors()
    if not contributors:
        raise SystemExit("no contributors returned from GitHub API")

    print(f"contributors: {len(contributors)}")
    for c in contributors:
        print(f"  {c['contributions']:4d}  {c['login']}")

    changed = False
    for rel in README_FILES:
        path = ROOT / rel
        lang = lang_for_path(path)
        block = render_gallery(contributors, lang=lang)
        if patch_file(path, block, dry_run=args.dry_run):
            changed = True

    if args.dry_run:
        return 0
    if not changed:
        print("all README contributor galleries already up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
