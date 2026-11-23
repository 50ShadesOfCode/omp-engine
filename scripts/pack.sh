#!/bin/sh
# Packs the plugin sources into omp-engine-<version>.cindy.
#
# The file list comes from ghost.json (entry, node entries, settings page and
# readme files), plus the local modules and page scripts those files require. A manifest change
# cannot silently leave a file out of the package.
set -eu
cd "$(dirname "$0")/.."

version=$(node -p "require('./ghost.json').version")
out="omp-engine-$version.cindy"
list=$(mktemp)
trap 'rm -f "$list"' EXIT

node -e '
const manifest = require("./ghost.json");
const files = new Set(["ghost.json"]);
const add = (file) => {
  if (typeof file === "string" && file) files.add(file);
};
add(manifest.entry);
if (manifest.node) {
  add(manifest.node.entry);
  for (const entry of manifest.node.entries || []) add(entry);
}
add(manifest.settingsHtml);
for (const readme of Object.values(manifest.readme || {})) add(readme);
for (const extra of ["lib/find-omp.cjs", "settings.js"]) add(extra);
for (const file of files) console.log(file);
' > "$list"

while IFS= read -r file; do
  [ -f "$file" ] || { echo "missing $file" >&2; exit 1; }
done < "$list"

rm -f omp-engine-*.cindy
while IFS= read -r file; do
  zip -q -X "$out" "$file"
done < "$list"
unzip -tq "$out" >/dev/null

printf 'packed %s (%s bytes):\n' "$out" "$(wc -c < "$out" | tr -d ' ')"
sed 's/^/  /' "$list"
