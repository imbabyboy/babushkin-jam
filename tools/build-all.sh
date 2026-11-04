#!/bin/sh
# Все сборки: приложение для Mac (Apple Silicon и Intel) и Windows и расширение.
# Готовые файлы с понятными именами лежат в dist/builds/, локальная версия расширения для Chrome — в dist/extension/.
# На экране только шаги с галочками, полный вывод — в dist/build-all.log. Если шаг упал, его конец покажется сразу.
# Установленное приложение не трогает.
# Запуск из любой папки: sh tools/build-all.sh
set -e
cd "$(dirname "$0")/.."

APP_VERSION=$(node -p "require('./extension/manifest.json').version")
OUT=dist/builds
LOG=dist/build-all.log
FAIL_TAIL_LINES=30

# Цвета и анимация только в терминале: в файле они превратились бы в мусор.
if [ -t 1 ]; then
  IS_TTY=1
  GREEN=$(printf '\033[32m')
  RED=$(printf '\033[31m')
  DIM=$(printf '\033[2m')
  BOLD=$(printf '\033[1m')
  RESET=$(printf '\033[0m')
else
  IS_TTY=
  GREEN= RED= DIM= BOLD= RESET=
fi

format_time() {
  if [ "$1" -ge 60 ]; then
    echo "$(($1 / 60)) мин $(($1 % 60)) с"
  else
    echo "$1 с"
  fi
}

clear_line() {
  if [ -n "$IS_TTY" ]; then printf '\r\033[K'; fi
}

# Фоновая команда в sh не получает Ctrl+C: останавливаем её сами.
step_pid=
trap '[ -z "$step_pid" ] || kill "$step_pid" 2>/dev/null; clear_line; echo "Остановлено"; exit 130' INT TERM

# step "Название" команда…: запускает команду, пока она идёт — крутит значок, в конце ставит галочку или крестик.
step() {
  label=$1
  shift
  step_started=$(date +%s)
  echo "=== $label" >>"$LOG"
  "$@" >>"$LOG" 2>&1 &
  step_pid=$!

  if [ -n "$IS_TTY" ]; then
    while kill -0 "$step_pid" 2>/dev/null; do
      for frame in ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏; do
        kill -0 "$step_pid" 2>/dev/null || break
        printf '\r\033[K %s %s %s%s%s' "$frame" "$label" "$DIM" "$(format_time $(($(date +%s) - step_started)))" "$RESET"
        sleep 0.1
      done
    done
  else
    echo " … $label"
  fi

  if wait "$step_pid"; then
    step_pid=
    clear_line
    echo " ${GREEN}✓${RESET} $label ${DIM}$(format_time $(($(date +%s) - step_started)))${RESET}"
  else
    step_pid=
    clear_line
    echo " ${RED}✗ $label${RESET}"
    echo
    tail -n "$FAIL_TAIL_LINES" "$LOG"
    echo
    echo "${RED}Сборка не удалась.${RESET} Полный вывод: $LOG"
    exit 1
  fi
}

prepare_app() {
  cd native
  [ -d node_modules ] || npm ci
  npm run bundle
}

# Mac собираем по одной архитектуре, чтобы у каждой был свой шаг. Подготовка уже сделана в prepare_app.
build_mac() {
  cd native
  npx electron-builder --config electron-builder.config.js --mac dmg "--$1"
}

build_windows() {
  cd native
  npx electron-builder --config electron-builder.config.js --win
}

started=$(date +%s)

# Старые версии убираем, чтобы случайно не отправить устаревший файл.
rm -rf dist/native "$OUT"
mkdir -p dist
: >"$LOG"

echo
echo " ${BOLD}babushkin-jam $APP_VERSION${RESET}"
echo

step "Расширение: zip для магазина" sh tools/build.sh
step "Расширение: версия для Chrome" node tools/build-extension.js
step "Приложение: подготовка" prepare_app
step "Mac: Apple Silicon" build_mac arm64
step "Mac: Intel" build_mac x64
step "Windows" build_windows

cp "dist/native/babushkin-jam-$APP_VERSION-arm64.dmg" "$OUT/babushkin-jam-$APP_VERSION-mac-apple-silicon.dmg"
cp "dist/native/babushkin-jam-$APP_VERSION.dmg" "$OUT/babushkin-jam-$APP_VERSION-mac-intel.dmg"
cp "dist/native/babushkin-jam Setup $APP_VERSION.exe" "$OUT/babushkin-jam-$APP_VERSION-windows.exe"

echo
echo " ${GREEN}${BOLD}Готово${RESET} за $(format_time $(($(date +%s) - started))): $OUT"
ls -lh "$OUT" | awk 'NR>1 {print "   " $5 "  " $9}'
echo
echo " ${DIM}Расширение в Chrome: нажмите ↻ в chrome://extensions и перезагрузите вкладку Музыки.${RESET}"
echo " ${DIM}Полный вывод: $LOG${RESET}"
