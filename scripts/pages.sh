#!/usr/bin/env bash
# docs/ içindeki uygulamayı gh-pages dalına yayınla (GitHub Pages: https://emraync.github.io/dj-analiz/)
# Kullanım: npm run release && bash scripts/pages.sh
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
git -C "$ROOT" fetch origin gh-pages 2>/dev/null || true
if git -C "$ROOT" rev-parse --verify -q origin/gh-pages >/dev/null; then
  git -C "$ROOT" worktree add -B gh-pages "$TMP" origin/gh-pages
else
  git -C "$ROOT" worktree add --detach "$TMP"
  git -C "$TMP" checkout --orphan gh-pages
  git -C "$TMP" rm -rfq . || true
fi
find "$TMP" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
for f in index.html sw.js manifest.webmanifest icon.svg icon-180.png icon-192.png icon-512.png .nojekyll; do cp "$ROOT/docs/$f" "$TMP/"; done
git -C "$TMP" add -A
git -C "$TMP" commit -q -m "SahneCAD $(node -p "require('$ROOT/package.json').version") yayın" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MQi678JUHJXXcZFrMD2MqS" || echo "değişiklik yok"
git -C "$TMP" push -u origin gh-pages
git -C "$ROOT" worktree remove --force "$TMP"
