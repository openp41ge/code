#!/usr/bin/env bash
#
# openp41ge code installer — downloads a signed + notarized build from GitHub
# Releases, verifies it, and installs the .app.
#
# Usage:
#   curl -fsSL https://github.com/openp41ge/code/releases/latest/download/install.sh | bash
#   curl -fsSL https://github.com/openp41ge/code/releases/download/v0.1.0-alpha.1/install.sh \
#     | bash -s -- --channel alpha               # (`latest` skips prereleases)
#   ./install.sh                                 # latest stable release
#   ./install.sh --channel alpha                 # latest alpha prerelease
#   ./install.sh --version 0.1.0-alpha.1         # a specific version
#   ./install.sh --arch arm64 --dry-run          # show plan only
#
# Verification (defence in depth, both are optional in presence):
#   1. SHA256 checksum against the SHA256SUMS published in the same release.
#   2. GitHub build provenance attestation (via `gh`, when installed) which
#      binds the artifact to the repository + commit that produced it.
set -euo pipefail

REPO="${OPENP41GE_REPO:-openp41ge/code}"
CHANNEL="stable"
VERSION=""
ARCH=""
DRY_RUN=0

# Printed inline (not read back from "$0"), so it also works when piped to bash.
usage() {
  cat <<'USAGE'
Usage: install.sh [options]
  --channel, -c <stable|alpha|beta|rc>  latest release on a channel (default: stable)
  --version, -v <semver>                a specific version, e.g. 0.1.0-alpha.1
  --arch, -a <arm64|x64|universal>      build to install (default: this Mac's)
  --repo <owner/name>                   release repo (default: openp41ge/code)
  --dry-run                             show the selected build, download nothing
  -h, --help                            show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel|-c) CHANNEL="$2"; shift 2 ;;
    --version|-v|--tag) VERSION="$2"; shift 2 ;;
    --arch|-a)    ARCH="$2";      shift 2 ;;
    --repo)       REPO="$2";      shift 2 ;;
    --dry-run)    DRY_RUN=1;      shift ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$ARCH" ]]; then
  case "$(uname -m)" in
    arm64)  ARCH="arm64" ;;
    x86_64) ARCH="x64" ;;
    *)      ARCH="universal" ;;
  esac
fi

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "This installer supports macOS only."
command -v curl    >/dev/null 2>&1 || die "missing required tool: curl"
command -v python3 >/dev/null 2>&1 || die "missing required tool: python3"
command -v ditto   >/dev/null 2>&1 || die "missing required tool: ditto"

# The app was "openp41ge.app" up to 0.1.0-alpha.4; an in-app update keeps
# the bundle's file name, so either name means it is installed.
# macOS (App Management) refuses to change or delete another developer's app
# from a terminal, even with sudo ("Operation not permitted"), so the
# installer only installs where nothing is installed yet.
for INSTALLED in "/Applications/openp41ge code.app" "/Applications/openp41ge.app"; do
  if [[ -e "$INSTALLED" && "$DRY_RUN" != "1" ]]; then
    die "openp41ge code is already installed at $INSTALLED.
  To update, use the update in the app itself.
  To reinstall, quit it, drag it from Applications to the Trash, and run the installer again."
  fi
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

API="https://api.github.com/repos/$REPO"

# ---- Resolve the release ------------------------------------------------
if [[ -n "$VERSION" ]]; then
  TAG="v${VERSION#v}"
  say "Resolving release $TAG"
  curl -fsSL -H 'Accept: application/vnd.github+json' \
    "$API/releases/tags/$TAG" -o "$TMP/release.json" || die "No release for tag $TAG"
else
  case "$CHANNEL" in
    stable)
      say "Resolving latest stable release"
      curl -fsSL -H 'Accept: application/vnd.github+json' \
        "$API/releases/latest" -o "$TMP/release.json" || die "No stable release yet"
      ;;
    alpha|beta|rc)
      say "Resolving latest $CHANNEL prerelease"
      curl -fsSL -H 'Accept: application/vnd.github+json' \
        "$API/releases?per_page=20" -o "$TMP/releases.json"
      python3 - "$CHANNEL" "$TMP/releases.json" "$TMP/release.json" <<'PY' || die "No $CHANNEL prerelease found"
import json, sys
channel, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
rs = json.load(open(src))
sel = next((r for r in rs if "-%s" % channel in r.get("tag_name", "")), None)
if sel is None:
    sys.exit(1)
json.dump(sel, open(dst, "w"))
PY
      ;;
    *) die "Unknown channel: $CHANNEL" ;;
  esac
fi

# ---- Select the artifact + checksum URL --------------------------------
read -r ASSET_NAME ASSET_URL SHA_URL <<<"$(
  python3 - "$ARCH" "$TMP/release.json" <<'PY'
import json, sys
arch = sys.argv[1]
data = json.load(open(sys.argv[2]))
assets = data.get("assets", [])
def rank(name):
    order = ["universal"] if arch == "universal" else ["universal", arch]
    for i, p in enumerate(order):
        if "-%s." % p in name:
            return i
    return len(order)
cands = [a for a in assets if a["name"].endswith(".zip")]
cands.sort(key=lambda a: rank(a["name"]))
if not cands:
    print("__none__")
else:
    a = cands[0]
    sha = next((x["browser_download_url"] for x in assets if x["name"] == "SHA256SUMS"), "")
    print("%s\t%s\t%s" % (a["name"], a["browser_download_url"], sha))
PY
)"
[[ "$ASSET_NAME" != "__none__" ]] || die "No .zip asset for arch '$ARCH' in this release"

say "Selected: $ASSET_NAME (arch: $ARCH)"
[[ -n "$SHA_URL" ]] || die "Release has no SHA256SUMS asset — refusing to install unverified build"

if [[ "$DRY_RUN" == "1" ]]; then
  say "Dry run — not downloading. Asset: $ASSET_NAME"
  exit 0
fi

# ---- Download ----------------------------------------------------------
say "Downloading $ASSET_NAME"
curl -fL --progress-bar -o "$TMP/$ASSET_NAME" "$ASSET_URL"
say "Downloading SHA256SUMS"
curl -fsSL -o "$TMP/SHA256SUMS" "$SHA_URL"

# ---- Verify SHA256 -----------------------------------------------------
EXPECTED="$(awk -v n="$ASSET_NAME" '$2 == n {print $1}' "$TMP/SHA256SUMS")"
[[ -n "$EXPECTED" ]] || die "SHA256SUMS has no entry for $ASSET_NAME — refusing"
ACTUAL="$(shasum -a 256 "$TMP/$ASSET_NAME" | awk '{print $1}')"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  die "Checksum mismatch for $ASSET_NAME (expected $EXPECTED, got $ACTUAL)"
fi
say "SHA256 verified: $EXPECTED"

# ---- Verify GitHub provenance (when gh is available) --------------------
if command -v gh >/dev/null 2>&1; then
  say "Verifying build provenance attestation with gh..."
  if ! gh attestation verify "$TMP/$ASSET_NAME" --repo "$REPO" \
       --predicate-type "https://slsa.dev/provenance/v1" >/dev/null 2>&1; then
    die "Provenance attestation verification FAILED for $ASSET_NAME"
  fi
  say "Provenance verified"
else
  say "gh not found — skipping provenance attestation (checksum verified instead)"
fi

# ---- Install -----------------------------------------------------------
say "Extracting $ASSET_NAME"
ditto -x -k "$TMP/$ASSET_NAME" "$TMP/extracted"
APP_DIR="$(find "$TMP/extracted" -maxdepth 1 -name "*.app" -type d | head -1)"
[[ -n "$APP_DIR" ]] || die "No .app found in $ASSET_NAME"

DEST="/Applications/$(basename "$APP_DIR")"

say "Installing to $DEST"
sudo ditto "$APP_DIR" "$DEST"
# curl does not set the quarantine flag, but clear it defensively so the
# notarized bundle is never blocked by Gatekeeper.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

say "Done."
say "Launch: open \"$DEST\""
