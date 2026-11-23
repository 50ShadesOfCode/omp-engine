#!/bin/sh
# Packs the plugin sources into omp-engine-<version>.cindy.
#
# The file list mirrors ghost.json: `entry`, every `node.entries` item and the
# sources those files require. Keep it in sync when the manifest changes.
set -eu
cd "$(dirname "$0")/.."

version=$(node -p "require('./ghost.json').version")
out="omp-engine-$version.cindy"

for file in ghost.json main.js node/worker.cjs omp-acp.js; do
  [ -f "$file" ] || { echo "missing $file" >&2; exit 1; }
done

rm -f omp-engine-*.cindy
zip -q -X "$out" ghost.json main.js node/worker.cjs omp-acp.js
unzip -tq "$out" >/dev/null

printf 'packed %s (%s bytes)\n' "$out" "$(wc -c < "$out" | tr -d ' ')"
