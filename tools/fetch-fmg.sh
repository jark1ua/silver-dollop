#!/usr/bin/env bash
# Mirror Azgaar's Fantasy Map Generator v1.109 (last fully-static release)
# from raw.githubusercontent.com so it can be served locally and driven
# headlessly by tools/driver.js.
#
# Usage: ./fetch-fmg.sh <target-dir>
# Then:  cd <target-dir> && python3 -m http.server 8099 --bind 127.0.0.1
set -euo pipefail

TARGET="${1:?usage: fetch-fmg.sh <target-dir>}"
REF="v1.109"
BASE="https://raw.githubusercontent.com/Azgaar/Fantasy-Map-Generator/$REF"

mkdir -p "$TARGET" && cd "$TARGET"

fetch() {
  local path="$1"
  [ -f "$path" ] && return 0
  mkdir -p "$(dirname "$path")"
  local code
  code=$(curl -sS -o "$path" -w "%{http_code}" --max-time 30 "$BASE/$path") || code=000
  if [ "$code" != "200" ]; then
    echo "MISS ($code): $path" >&2
    rm -f "$path"
    return 1
  fi
}

echo "Fetching index.html..."
fetch index.html

echo "Fetching files referenced by index.html..."
grep -oE '(src|href)="[^"]+"' index.html |
  sed -E 's/^(src|href)="//; s/"$//' |
  grep -vE '^(https?:|#|mailto:|data:)' |
  sed -E 's/^\.\///; s/\?.*$//' |
  sort -u |
  while read -r path; do fetch "$path" || true; done

echo "Fetching style presets..."
for s in default ancient gloom pale light watercolor clean atlas cyberpunk monochrome; do
  fetch "styles/$s.json" || true
done

echo "Fetching dynamically imported modules..."
for p in libs/dropbox-sdk.min.js libs/jszip.min.js libs/openwidget.min.js \
  modules/dynamic/auto-update.js modules/dynamic/export-json.js \
  modules/dynamic/heightmap-selection.js modules/dynamic/supporters.js \
  modules/dynamic/installation.js modules/dynamic/overview/charts-overview.js \
  modules/dynamic/editors/cultures-editor.js modules/dynamic/editors/religions-editor.js \
  modules/dynamic/editors/states-editor.js; do
  fetch "$p" || true
done

echo "Done. Serve with: python3 -m http.server 8099 --bind 127.0.0.1"
