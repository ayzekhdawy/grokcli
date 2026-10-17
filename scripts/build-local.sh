#!/usr/bin/env bash
# Local release-style builds for supported desktop targets.
#
# Usage:
#   ./scripts/build-local.sh                 # current machine (auto target)
#   ./scripts/build-local.sh mac             # current Mac CPU (arm64 / x86_64)
#   ./scripts/build-local.sh mac-arm         # Apple Silicon .app + .dmg
#   ./scripts/build-local.sh mac-intel       # Intel Mac .app + .dmg
#   ./scripts/build-local.sh win             # Windows NSIS (native or cargo-xwin)
#   ./scripts/build-local.sh linux           # Linux AppImage/deb/rpm (Linux host)
#   ./scripts/build-local.sh all-mac         # arm + intel (macOS only)
#   ./scripts/build-local.sh all             # mac-arm + mac-intel + win (macOS)
#   ./scripts/build-local.sh help
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET_ALIAS="${1:-host}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing command: $1" >&2
    exit 1
  }
}

# Homebrew LLVM (clang-cl) for cargo-xwin RC / C toolchain on Apple Silicon.
prepend_homebrew_llvm() {
  if [[ -d /opt/homebrew/opt/llvm/bin ]]; then
    export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
  elif [[ -d /usr/local/opt/llvm/bin ]]; then
    export PATH="/usr/local/opt/llvm/bin:$PATH"
  fi
}

need_cmd pnpm
need_cmd rustc
need_cmd cargo

OS="$(uname -s)"
ARCH="$(uname -m)"

# Map host arch → Rust triple for "build for this machine".
host_mac_triple() {
  case "$ARCH" in
    arm64 | aarch64) echo "aarch64-apple-darwin" ;;
    x86_64) echo "x86_64-apple-darwin" ;;
    *)
      echo "error: unsupported Darwin arch: $ARCH" >&2
      exit 1
      ;;
  esac
}

list_artifacts() {
  local triple="$1"
  local base="src-tauri/target/${triple}/release/bundle"
  echo ""
  echo "-------- Artifacts ($triple) --------"
  if [[ ! -d "$base" ]]; then
    echo "(no bundle dir yet: $base)"
    return 0
  fi
  # Prefer concrete installers over raw trees.
  local found=0
  while IFS= read -r -d '' f; do
    found=1
    ls -lah "$f"
  done < <(find "$base" \( \
    -name '*.dmg' -o -name '*.app' -o -name '*-setup.exe' -o -name '*.AppImage' \
    -o -name '*.deb' -o -name '*.rpm' -o -name '*.msi' \
  \) -print0 2>/dev/null || true)
  if [[ "$found" -eq 0 ]]; then
    echo "Bundle root: $base"
    find "$base" -maxdepth 3 -type f 2>/dev/null | head -40 || true
  fi
  echo "Open folder: $ROOT/$base"
}

print_help() {
  cat <<'EOF'
Grok App — local platform builds

  pnpm build                 Current host default (same as: build-local.sh host)
  pnpm build:mac             This Mac only (Apple Silicon or Intel auto-detect)
  pnpm build:mac-arm         macOS aarch64-apple-darwin (.app + .dmg)
  pnpm build:mac-intel       macOS x86_64-apple-darwin (.app + .dmg)
  pnpm build:mac-all         Both Mac targets
  pnpm build:win             Windows x64 NSIS (cargo-xwin on Mac/Linux)
  pnpm build:linux           Linux x64 (must run on Linux)
  pnpm build:all             mac-arm + mac-intel + win (macOS host)

  ./scripts/build-local.sh [host|mac|mac-arm|mac-intel|win|linux|all-mac|all|help]

Apple Silicon install package (your machine):
  pnpm build:mac
  # → src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/
  # → src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Grok.app

First-time deps: pnpm install && pnpm setup:cross
EOF
}

build_target() {
  local triple="$1"
  echo ""
  echo "======== Building target: $triple ========"
  rustup target add "$triple" >/dev/null 2>&1 || true
  # Frontend is built via beforeBuildCommand in tauri.conf.json
  pnpm exec tauri build --target "$triple"
  list_artifacts "$triple"
}

# Windows: on Darwin/Linux use Tauri + cargo-xwin runner (NSIS installer).
# On Windows host, native MSVC toolchain (no runner).
build_windows() {
  local triple="x86_64-pc-windows-msvc"
  echo ""
  echo "======== Building target: $triple ========"
  rustup target add "$triple" >/dev/null 2>&1 || true

  if [[ "$OS" == "Darwin" ]] || [[ "$OS" == "Linux" ]]; then
    prepend_homebrew_llvm
    need_cmd cargo-xwin
    if ! command -v makensis >/dev/null 2>&1; then
      echo "error: makensis not found (NSIS installer)." >&2
      echo "       macOS: brew install makensis" >&2
      echo "       Then re-run: pnpm setup:cross && ./scripts/build-local.sh win" >&2
      exit 1
    fi
    if ! command -v clang-cl >/dev/null 2>&1; then
      echo "warn: clang-cl not on PATH — install brew llvm and ensure PATH includes it" >&2
      echo "      brew install llvm && export PATH=\"\$(brew --prefix llvm)/bin:\$PATH\"" >&2
    fi
    echo "Using runner: cargo-xwin (cross-compile from $OS)"
    # Official Tauri path: https://v2.tauri.app/distribute/windows-installer/
    pnpm exec tauri build --runner cargo-xwin --target "$triple"
  else
    echo "Using native Windows MSVC toolchain"
    pnpm exec tauri build --target "$triple"
  fi

  list_artifacts "$triple"
}

case "$TARGET_ALIAS" in
  help | -h | --help)
    print_help
    exit 0
    ;;
  host | "")
    if [[ "$OS" == "Darwin" ]]; then
      triple="$(host_mac_triple)"
      echo "======== Building for this Mac ($ARCH → $triple) ========"
      build_target "$triple"
    else
      echo "======== Building host default ========"
      pnpm exec tauri build
      # Host default without --target often lands under target/release/bundle
      if [[ -d src-tauri/target/release/bundle ]]; then
        echo "Artifacts under: src-tauri/target/release/bundle/"
        find src-tauri/target/release/bundle \( -name '*.dmg' -o -name '*.app' -o -name '*.AppImage' -o -name '*.deb' -o -name '*-setup.exe' \) -exec ls -lah {} \; 2>/dev/null || true
      fi
    fi
    ;;
  mac | mac-current | current-mac | this-mac)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: mac builds require macOS" >&2
      exit 1
    fi
    triple="$(host_mac_triple)"
    echo "======== Building for this Mac ($ARCH → $triple) ========"
    build_target "$triple"
    ;;
  mac-arm | mac-arm64 | aarch64 | aarch64-apple-darwin)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: mac-arm builds require macOS" >&2
      exit 1
    fi
    build_target "aarch64-apple-darwin"
    ;;
  mac-intel | mac-x64 | x86_64-apple-darwin)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: mac-intel builds require macOS" >&2
      exit 1
    fi
    build_target "x86_64-apple-darwin"
    ;;
  win | windows | x86_64-pc-windows-msvc)
    build_windows
    ;;
  linux | x86_64-unknown-linux-gnu)
    if [[ "$OS" != "Linux" ]]; then
      echo "error: linux builds require a Linux host (or CI ubuntu-latest)" >&2
      echo "       deps: libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf" >&2
      exit 1
    fi
    build_target "x86_64-unknown-linux-gnu"
    ;;
  all-mac)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: all-mac requires macOS" >&2
      exit 1
    fi
    build_target "aarch64-apple-darwin"
    build_target "x86_64-apple-darwin"
    ;;
  all)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: 'all' (mac + win cross) requires macOS currently" >&2
      exit 1
    fi
    build_target "aarch64-apple-darwin"
    build_target "x86_64-apple-darwin"
    build_windows
    ;;
  *)
    print_help >&2
    echo "" >&2
    echo "error: unknown target: $TARGET_ALIAS" >&2
    exit 1
    ;;
esac
