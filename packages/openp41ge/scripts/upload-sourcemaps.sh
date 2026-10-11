#!/usr/bin/env bash
# Uploads the renderer (dist/) and main-process (dist-electron/) source maps
# to Sentry, tagged with the release version so packaged-app crashes resolve
# to source. Run from the release pipeline after `nx build openp41ge`.
#
# Required env:
#   VERSION            The release version (must equal app.getVersion()).
#   SENTRY_AUTH_TOKEN  Sentry auth token (org:read + release:write).
#
# Optional env:
#   CHANNEL    If set, also tags the upload with `--dist <CHANNEL>`. Only set
#              this if the app also reports `dist` in Sentry.init — otherwise
#              the upload won't match the app's events. (We do NOT set dist,
#              so leave it unset by default.)
#   URL_PREFIX PrefixSent to `--url-prefix`. Needed only if Sentry can't match
#              the app's file:// URLs; verify against a real event after the
#              first source-mapped release before enabling.
set -euo pipefail

: "${VERSION:?VERSION is required}"

# Skip (don't block the release) if no auth token is configured yet — source
# maps only improve stack readability; a missing token shouldn't fail a release.
if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  echo "SENTRY_AUTH_TOKEN not set — skipping source map upload."
  exit 0
fi

# Resolve to packages/openp41ge (script lives in packages/openp41ge/scripts).
cd "$(dirname "$0")/.."

ARGS=(sourcemaps upload --release "$VERSION")
if [ -n "${CHANNEL:-}" ]; then
  ARGS+=(--dist "$CHANNEL")
fi
if [ -n "${URL_PREFIX:-}" ]; then
  ARGS+=(--url-prefix "$URL_PREFIX")
fi

# --rewrite is on by default: sentry-cli rewrites the source paths in the maps
# so they match the built bundles.
#
# Upload only the maps for the SHIPPED bundles:
#   - dist/**/*.map              all renderer chunks (dist/** is shipped)
#   - dist-electron/electron/main.js.map  the bundled main process
# (esbuild chains the tsc source map, so main.js.map sources resolve to the
# original .ts files; the per-module tsc .js.map files in dist-electron are
# intermediate and not shipped, so they're excluded to avoid orphan artifacts.)
echo "Uploading source maps for release ${VERSION}"
npx sentry-cli "${ARGS[@]}" \
  'dist/**/*.map' \
  'dist-electron/electron/main.js.map'
echo "Done."
