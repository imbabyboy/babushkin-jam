// Установлено ли расширение babushkin-jam: ссылки на Яндекс Музыку в приложение передаёт оно.
// Копию из Chrome Web Store находим по папке Extensions/<id> в профилях Chrome и браузеров на его основе
// (Chrome удаляет её вместе с расширением). Распакованную копию так не найти — её main.js узнаёт
// по запросам расширения на 127.0.0.1 (extensionSeenAt).

const fs = require('fs');
const os = require('os');
const path = require('path');

const EXTENSION_ID = 'iincaikpjidieflnaajiehogcimgbepe';
const STORE_URL = `https://chromewebstore.google.com/detail/babushkin-jam/${EXTENSION_ID}`;

// Папки данных браузеров: в каждой профили (Default, Profile 1…), у Оперы расширения прямо в ней.
function browserDirs(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    return [
      'Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome Canary', 'Chromium', 'Yandex/YandexBrowser',
      'Microsoft Edge', 'BraveSoftware/Brave-Browser', 'Arc/User Data', 'Dia/User Data', 'Vivaldi', 'com.operasoftware.Opera',
    ].map((dir) => path.join(base, dir));
  }
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return [
    ...['Google/Chrome', 'Google/Chrome Beta', 'Chromium', 'Yandex/YandexBrowser', 'Microsoft/Edge',
      'BraveSoftware/Brave-Browser', 'Vivaldi'].map((dir) => path.join(local, dir, 'User Data')),
    path.join(roaming, 'Opera Software', 'Opera Stable'),
  ];
}

function extensionOnDisk(dirs = browserDirs()) {
  const has = (dir) => fs.existsSync(path.join(dir, 'Extensions', EXTENSION_ID));
  for (const dir of dirs) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    if (has(dir)) return true;
    if (entries.some((e) => e.isDirectory() && has(path.join(dir, e.name)))) return true;
  }
  return false;
}

module.exports = { EXTENSION_ID, STORE_URL, browserDirs, extensionOnDisk };
