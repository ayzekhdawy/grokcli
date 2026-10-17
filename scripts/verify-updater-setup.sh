#!/usr/bin/env bash
# Verify desktop auto-update production prerequisites (local / CI).
# Does not print secret values. Exit 0 when checks that can run pass.
#
# Usage:
#   ./scripts/verify-updater-setup.sh
#   ./scripts/verify-updater-setup.sh --fetch-latest   # also HTTP-get latest.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FETCH_LATEST=0
for arg in "$@"; do
  case "$arg" in
    --fetch-latest) FETCH_LATEST=1 ;;
    -h|--help)
      sed -n '1,12p' "$0"
      exit 0
      ;;
  esac
done

ok=0
warn=0
fail=0

note() { printf '  · %s\n' "$*"; }
pass() { ok=$((ok + 1)); printf 'OK   %s\n' "$*"; }
warn() { warn=$((warn + 1)); printf 'WARN %s\n' "$*"; }
fail() { fail=$((fail + 1)); printf 'FAIL %s\n' "$*"; }

echo "== Grok App updater setup check =="

# 1) Workflow references required secrets
WF=".github/workflows/release.yml"
if [[ -f "$WF" ]]; then
  if grep -q 'GROK_UPDATER_PUBLIC_KEY' "$WF" \
    && grep -q 'TAURI_SIGNING_PRIVATE_KEY' "$WF"; then
    pass "release.yml references updater signing secrets"
  else
    fail "release.yml missing GROK_UPDATER_* / TAURI_SIGNING_* wiring"
  fi
  if grep -q 'assemble-updater-manifest\|generate-latest-json\|grok-desktop-latest' "$WF"; then
    pass "release.yml publishes rolling updater assets"
  else
    warn "release.yml may not publish grok-desktop-latest / latest.json"
  fi
else
  fail "missing $WF"
fi

# 2) Local scripts present
for s in scripts/assemble-updater-manifest.sh scripts/generate-latest-json.sh scripts/build-release-config.mjs; do
  if [[ -f "$s" ]]; then
    pass "present $s"
  else
    fail "missing $s"
  fi
done

# 3) Docs
if [[ -f docs/desktop-auto-update.md ]]; then
  pass "docs/desktop-auto-update.md present"
else
  fail "missing docs/desktop-auto-update.md"
fi

# 4) Env presence (names only — never print values) + common local key files
has_pub=0
has_priv=0
has_ep=0
[[ -n "${GROK_UPDATER_PUBLIC_KEY:-}" ]] && has_pub=1
[[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]] && has_priv=1
[[ -n "${GROK_UPDATER_ENDPOINT:-}" ]] && has_ep=1

if [[ $has_pub -eq 1 && $has_priv -eq 1 ]]; then
  pass "local env has GROK_UPDATER_PUBLIC_KEY + TAURI_SIGNING_PRIVATE_KEY"
elif [[ -f "${HOME}/.tauri/grok-app.key" && -f "${HOME}/.tauri/grok-app.key.pub" ]]; then
  pass "local keypair files present (~/.tauri/grok-app.key[.pub])"
  note "export into env for local release builds, or rely on GitHub Actions secrets"
else
  warn "local env missing signing keys (expected on maintainer machines / CI only)"
  note "Generate: pnpm tauri signer generate -w ~/.tauri/grok-app.key"
fi
if [[ $has_ep -eq 1 ]]; then
  pass "local env has GROK_UPDATER_ENDPOINT"
else
  note "GROK_UPDATER_ENDPOINT optional locally; CI sets it for release builds"
fi

# 5) GitHub Actions secrets (names only — never print values)
REPO="${GITHUB_REPOSITORY:-}"
if [[ -z "$REPO" ]] && command -v gh >/dev/null 2>&1; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
fi
REPO="${REPO:-RongleCat/grok-app}"

if command -v gh >/dev/null 2>&1; then
  if secret_list="$(gh secret list --repo "$REPO" 2>/dev/null)"; then
    need_secrets=(GROK_UPDATER_PUBLIC_KEY TAURI_SIGNING_PRIVATE_KEY)
    missing_s=()
    for s in "${need_secrets[@]}"; do
      if printf '%s\n' "$secret_list" | awk '{print $1}' | grep -qx "$s"; then
        pass "GitHub secret present: $s"
      else
        missing_s+=("$s")
        fail "GitHub secret missing: $s (repo Settings → Secrets → Actions)"
      fi
    done
    if printf '%s\n' "$secret_list" | awk '{print $1}' | grep -qx TAURI_SIGNING_PRIVATE_KEY_PASSWORD; then
      pass "GitHub secret present: TAURI_SIGNING_PRIVATE_KEY_PASSWORD (empty OK)"
    else
      note "TAURI_SIGNING_PRIVATE_KEY_PASSWORD unset (OK if key has no passphrase)"
    fi
    if [[ ${#missing_s[@]} -eq 0 ]]; then
      pass "repo $REPO has both updater signing secrets"
    fi
  else
    warn "gh secret list failed (auth / permissions) — skip remote secret check"
  fi
else
  note "gh not installed; skip GitHub secret check"
fi

# 6) Optional live latest.json
LATEST_URL="https://github.com/${REPO}/releases/download/grok-desktop-latest/latest.json"
if [[ $FETCH_LATEST -eq 1 ]]; then
  if command -v curl >/dev/null 2>&1; then
    code=$(curl -sS -o /tmp/grok-latest.json -w '%{http_code}' -L "$LATEST_URL" || true)
    if [[ "$code" == "200" ]]; then
      if command -v python3 >/dev/null 2>&1; then
        if python3 -c 'import json,sys; d=json.load(open("/tmp/grok-latest.json")); assert "version" in d and "platforms" in d' 2>/dev/null; then
          ver=$(python3 -c 'import json; print(json.load(open("/tmp/grok-latest.json"))["version"])')
          plats=$(python3 -c 'import json; print(",".join(sorted(json.load(open("/tmp/grok-latest.json")).get("platforms",{}).keys())))')
          pass "latest.json OK version=$ver platforms=[$plats]"
        else
          fail "latest.json HTTP 200 but missing version/platforms"
        fi
      else
        pass "latest.json HTTP 200 ($LATEST_URL)"
      fi
    else
      warn "latest.json not fetchable (HTTP $code) — rolling release may not exist yet"
      note "After secrets are set, re-run release workflow for a tag to publish grok-desktop-latest"
    fi
  else
    warn "curl not available; skip --fetch-latest"
  fi
else
  note "skip live latest.json (pass --fetch-latest to check $LATEST_URL)"
fi

echo
echo "Summary: ok=$ok warn=$warn fail=$fail"
if [[ $fail -gt 0 ]]; then
  exit 1
fi
exit 0
