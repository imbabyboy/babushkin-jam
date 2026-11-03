#!/bin/sh
# Все сборки для друзей: приложение для Mac (Apple Silicon и Intel) и Windows и расширение.
# Готовые файлы с понятными именами лежат в dist/friends/. Установленное приложение не трогает.
# Запуск из любой папки: sh tools/build-all.sh
set -e
cd "$(dirname "$0")/.."

APP_VERSION=$(node -p "require('./desktop/package.json').version")
EXT_VERSION=$(node -p "require('./extension/manifest.json').version")
OUT=dist/friends

# Старые версии убираем, чтобы случайно не отправить устаревший файл.
rm -rf desktop/dist "$OUT"
sh tools/build.sh

(
  cd desktop
  [ -d node_modules ] || npm ci
  npm run dist:mac
  npm run dist:win
)

mkdir -p "$OUT"
cp "desktop/dist/babushkin-jam-$APP_VERSION-arm64.dmg" "$OUT/babushkin-jam-$APP_VERSION-mac-apple-silicon.dmg"
cp "desktop/dist/babushkin-jam-$APP_VERSION.dmg" "$OUT/babushkin-jam-$APP_VERSION-mac-intel.dmg"
cp "desktop/dist/babushkin-jam Setup $APP_VERSION.exe" "$OUT/babushkin-jam-$APP_VERSION-windows.exe"
cp dist/babushkin-jam.zip "$OUT/babushkin-jam-extension-$EXT_VERSION.zip"

echo
echo "Готово: $OUT"
ls -lh "$OUT" | awk 'NR>1 {print "  " $5 "  " $9}'
