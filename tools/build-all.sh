#!/bin/sh
# Все сборки: приложение для Mac (Apple Silicon и Intel) и Windows и расширение.
# Готовые файлы с понятными именами лежат в dist/builds/. Установленное приложение не трогает.
# Запуск из любой папки: sh tools/build-all.sh
set -e
cd "$(dirname "$0")/.."

APP_VERSION=$(node -p "require('./native/package.json').version")
OUT=dist/builds

# Старые версии убираем, чтобы случайно не отправить устаревший файл.
rm -rf native/dist "$OUT"
sh tools/build.sh

(
  cd native
  [ -d node_modules ] || npm ci
  npm run dist:mac
  npm run dist:win
)

cp "native/dist/babushkin-jam-$APP_VERSION-arm64.dmg" "$OUT/babushkin-jam-$APP_VERSION-mac-apple-silicon.dmg"
cp "native/dist/babushkin-jam-$APP_VERSION.dmg" "$OUT/babushkin-jam-$APP_VERSION-mac-intel.dmg"
cp "native/dist/babushkin-jam Setup $APP_VERSION.exe" "$OUT/babushkin-jam-$APP_VERSION-windows.exe"

echo
echo "Готово: $OUT"
ls -lh "$OUT" | awk 'NR>1 {print "  " $5 "  " $9}'
