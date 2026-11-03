#!/bin/sh
# Сборка zip для Chrome Web Store и друзей: dist/builds/babushkin-jam-extension-<версия>.zip.
# Локальная версия (dist/extension/, см. tools/build-extension.js) — с голубой иконкой и именем «babushkin-jam (local)».
# В zip уходит прод: красные иконки из assets/icons-prod и имя без «(local)».
# Запуск из корня репозитория: sh tools/build.sh
set -e

NAME=babushkin-jam
VERSION=$(node -p "require('./extension/manifest.json').version")
OUT="dist/builds/$NAME-extension-$VERSION.zip"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

node tools/build-extension.js "$TMP"
cp assets/icons-prod/*.png "$TMP/icons/"
node -e "
  const fs = require('fs');
  const file = process.argv[1];
  const m = JSON.parse(fs.readFileSync(file));
  m.name = process.argv[2];
  m.action.default_title = process.argv[2];
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
" "$TMP/manifest.json" "$NAME"

mkdir -p dist/builds
# Старые версии убираем: в builds лежит только актуальная.
rm -f dist/builds/$NAME-extension-*.zip
(cd "$TMP" && zip -qr - . -x '.*' '*/.*') > "$OUT"
echo "$OUT"
