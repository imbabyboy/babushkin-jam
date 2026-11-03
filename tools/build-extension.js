// Собирает расширение в одну папку: Chrome загружает его целиком и не видит файлы выше этой папки.
// Берёт extension/ и код джема из shared/. Пути внутри сборки — те, что указаны в manifest.json.
// Запуск из любой папки:
//   node tools/build-extension.js           dist/extension/ — локальная версия, её загружаем в Chrome
//   node tools/build-extension.js --watch   то же и пересборка при каждой правке
//   node tools/build-extension.js <папка>   в пустую папку, так tools/build.sh готовит zip для магазина

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXTENSION = path.join(ROOT, 'extension');
const SHARED = path.join(ROOT, 'shared');
const DEV_OUT = path.join(ROOT, 'dist', 'extension');
const REBUILD_DELAY_MS = 100;

const notHidden = (source) => !path.basename(source).startsWith('.');
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, filter: notHidden });

function assemble(out) {
  copy(EXTENSION, out);
  copy(path.join(SHARED, 'fonts'), path.join(out, 'fonts'));
  for (const file of fs.readdirSync(SHARED)) {
    if (file.endsWith('.js')) fs.copyFileSync(path.join(SHARED, file), path.join(out, 'src', file));
  }
}

// Саму папку не удаляем: она открыта в Chrome как распакованное расширение.
function buildDev() {
  fs.mkdirSync(DEV_OUT, { recursive: true });
  for (const entry of fs.readdirSync(DEV_OUT)) fs.rmSync(path.join(DEV_OUT, entry), { recursive: true, force: true });
  assemble(DEV_OUT);
  const { version } = JSON.parse(fs.readFileSync(path.join(DEV_OUT, 'manifest.json')));
  console.log(`dist/extension/: ${version}`);
}

function watch() {
  let timer = null;
  const rebuild = () => {
    // Редактор может сохранять файл через переименование: в этот момент файла нет, следующее событие соберёт заново.
    try { buildDev(); } catch (e) { console.error(e.message); }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, REBUILD_DELAY_MS);
  };
  for (const dir of [EXTENSION, SHARED]) fs.watch(dir, { recursive: true }, schedule);
  console.log('Жду правки. После пересборки нажмите ↻ у расширения в chrome://extensions.');
}

const arg = process.argv[2];
if (arg && arg !== '--watch') {
  assemble(path.resolve(arg));
} else {
  buildDev();
  if (arg === '--watch') watch();
}
