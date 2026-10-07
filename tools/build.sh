#!/bin/sh
# Сборка zip для Chrome Web Store: dist/babushkin-jam.zip.
# Папка extension/ — версия для разработки: голубая иконка и имя «babushkin-jam (local)».
# В zip уходит прод: красные иконки из assets/icons-prod и имя без «(local)».
# Запуск из корня репозитория: sh tools/build.sh
set -e

NAME=babushkin-jam
OUT="dist/$NAME.zip"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cp -R extension/. "$TMP/"
cp assets/icons-prod/*.png "$TMP/icons/"
node -e "
  const fs = require('fs');
  const file = process.argv[1];
  const m = JSON.parse(fs.readFileSync(file));
  m.name = process.argv[2];
  m.action.default_title = process.argv[2];
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
" "$TMP/manifest.json" "$NAME"

mkdir -p dist
rm -f "$OUT"
(cd "$TMP" && zip -qr - . -x '.*' '*/.*') > "$OUT"
echo "$OUT: $(node -p "require('./extension/manifest.json').version")"
