# Участие в разработке

Спасибо, что хотите помочь! Баг-репорты, идеи и pull request'ы приветствуются.

## Как устроен проект

```
shared/               код джема и шрифты: один на расширение и приложение
  page.js             адаптер плеера: работает в контексте страницы, всё про устройство сайта — здесь
  shared.js           общие настройки и хелперы (глобальный YJam)
  content.js          логика джема: соединение, комната, защита от эха, подстройка плеера
  fonts/              Golos Text и JetBrains Mono (woff2, кириллица + латиница, OFL)
extension/            только расширение Chrome (Manifest V3)
  manifest.json
  src/overlay.js      панель «Джем» в Shadow DOM, без логики
  src/background.js   фоновый скрипт: виджет на других сайтах
  src/remote.js       виджет на других сайтах
  popup/              попап, его же использует окно настроек приложения
native/               приложение для macOS и Windows на Electron
services/rooms/       сервер комнат: Node.js + ws, состояние только в памяти
services/links/       сервис ссылок на песню
deploy/               Dockerfile, Caddyfile и скрипты деплоя
store/                тексты и картинки для Chrome Web Store
docs/                 документация
assets/icons-prod/    красные иконки для магазина (в extension/icons — голубые для локальной версии)
tools/build-extension.js  сборка расширения в dist/extension/ для разработки
tools/build.sh        сборка zip для магазина
tools/ym-probe.js     скрипт-разведка плеера для консоли браузера
```

Как части общаются:

```
page.js ⇄ window.postMessage ⇄ content.js ⇄ WebSocket ⇄ server.js ⇄ остальные участники
popup.js ⇄ chrome.tabs.sendMessage ⇄ content.js
```

Настройки (`serverUrl`, `name`, `room`) лежат в `chrome.storage.local`. Панель и попап только пишут туда, `content.js` слушает изменения и переподключается.

## Запуск

```sh
cd services/rooms && npm install && npm run dev
```

Расширение: `node tools/build-extension.js` (или с `--watch`, чтобы пересобирать при каждой правке), затем `chrome://extensions` → «Режим разработчика» → «Загрузить распакованное» → папка `dist/extension/`. Папку `extension/` напрямую загрузить нельзя: в ней нет кода из `shared/`. Это локальная версия: голубая иконка и имя «babushkin-jam (local)», чтобы не путать с версией из магазина (красная). Прод-сборку делает `sh tools/build.sh`. В попапе впишите сервер `ws://localhost:8787`. Для проверки синхронизации удобно взять два профиля Chrome.

После правок и пересборки нажмите ↻ у расширения и перезагрузите вкладку Яндекс Музыки (если меняли только попап — вкладку перезагружать не нужно).

## Ветки

Основная ветка — `main`, напрямую в неё пушит только владелец. Новая работа — в ветке `yj-<название>` и через pull request. В VS Code для этого есть задачи (`Cmd+Shift+B`): «new branch», «checkout branch», «git commit and push» (коммит вида `yj-<название> | сообщение`).

## Дизайн

Попап и панель сделаны по макету из Claude Design (папка `babushkin-jam-ui-mockups/`, в репозиторий не входит). Тёмная тема, акцент `#FFDB4D`, шрифты `YJam Golos` / `YJam Mono` — их регистрирует `YJam.loadFonts()` из `shared.js` (через `FontFace`: `@font-face` внутри Shadow DOM панели не работает). Цвета аватаров — `YJam.avatarColor(i)` по месту участника в списке, одинаково в попапе и на панели.

## Правила

- **Правила комнаты** (кто становится ведущим, кто что может) описаны в README. Если меняете их — объясните в pull request зачем.
- **Всё, что зависит от устройства сайта Яндекс Музыки, — только в `page.js`.** `content.js` ничего не знает про DOM плеера.
- **Любое действие с плеером по команде комнаты — через `expect()`** в `content.js`, иначе расширение отправит своё же действие обратно на сервер (эхо).
- **Сервер проверяет и обрезает всё, что приходит от клиента** (`str`, `num`, `cleanTrack`).
- Новое сообщение протокола: сначала сервер, потом расширение. Старый сервер просто игнорирует неизвестные сообщения.

## Стиль кода

- Обычный JavaScript без сборщиков и TypeScript. Сервер — ES-модули, расширение — скрипты в IIFE.
- 2 пробела, одинарные кавычки, точки с запятой.
- Константы — `UPPER_SNAKE` с единицами в имени: `ECHO_MS`, `DRIFT_SEC`.
- Комментарии и тексты интерфейса — по-русски. Комментарий объясняет «почему», а не «что».
- Команды адаптера плеера возвращают `{ ok, ... }` или `{ ok: false, error }`, а не бросают исключения.
- Перехваты функций сайта оборачивайте в `try/catch`: расширение не должно ломать сайт.

## Проверки

Тестов пока нет. CI проверяет синтаксис всех JS-файлов и `manifest.json` и запускает сервер. Локально то же самое:

```sh
for f in services/rooms/server.js shared/*.js extension/src/*.js extension/popup/*.js tools/*.js; do node --check "$f"; done
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json'))"
```

Перед pull request проверьте вручную на двух профилях Chrome: смену трека, паузу, перемотку и вход по ссылке.

## Релиз

1. Поднять `version` в `extension/manifest.json` и дописать `CHANGELOG.md`.
2. Закоммитить и поставить тег: `git tag v0.4.0 && git push --tags`.
3. GitHub Actions соберёт `babushkin-jam-extension-<версия>.zip` и создаст релиз.
4. Загрузить этот zip в [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) → babushkin-jam → «Пакет» → «Загрузить новый пакет» и отправить на проверку.
5. Если менялся сервер — задеплоить его до релиза расширения (`sh deploy/deploy.sh`, см. [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)).
