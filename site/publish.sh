#!/usr/bin/env bash
# Publishes the showcase page to the gh-pages branch (GitHub Pages).
# The demo video lives only on gh-pages, so main stays small.
#   bash site/publish.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="$(git -C "$ROOT" remote get-url origin)"
TMP="$(mktemp -d)"
cp -r "$ROOT/site/." "$TMP/"
rm -f "$TMP/publish.sh"
cp "$ROOT/video/out/brainprint_demo_v3.mp4" "$TMP/brainprint_demo.mp4"   # the current 1:39 cut
touch "$TMP/.nojekyll"
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" \
  commit -q -m "Publish BrainPrint showcase page"
git push -q -f "$REMOTE" gh-pages
echo "pushed gh-pages to $REMOTE"
rm -rf "$TMP"
