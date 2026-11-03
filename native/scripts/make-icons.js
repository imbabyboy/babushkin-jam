// Рисует иконки приложения и трея из векторных заготовок. Запускать вручную, только если меняется рисунок:
//   npx electron scripts/make-icons.js
// Результат лежит в assets/ и хранится в репозитории.

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const ASSETS = path.join(__dirname, '..', 'assets');

// Банка варенья — как иконка расширения в assets/icons-prod, но в векторе: той не хватает размера.
const CHECKS = [0, 1, 2, 3].flatMap((row) => [0, 1, 2, 3, 4, 5, 6]
  .filter((col) => (row + col) % 2 === 0)
  .map((col) => `<rect x="${236 + col * 79}" y="${84 + row * 56}" width="79" height="56" fill="#E5322D"/>`))
  .join('');

const JAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <path d="M236 84h552v196c0 30-24 40-46 40H282c-22 0-46-10-46-40z" fill="#FFF3E6"/>
  ${CHECKS}
  <rect x="274" y="300" width="476" height="52" fill="#7A4A2B"/>
  <rect x="166" y="340" width="692" height="620" rx="120" fill="#B3124F"/>
  <rect x="214" y="400" width="44" height="240" rx="22" fill="#E8628F"/>
  <rect x="300" y="470" width="470" height="340" rx="28" fill="#FFF3C9"/>
  <ellipse cx="478" cy="716" rx="66" ry="52" fill="#2B1B1B"/>
  <rect x="510" y="530" width="34" height="186" fill="#2B1B1B"/>
  <path d="M510 530l130 42v62l-130-42z" fill="#2B1B1B"/>
</svg>`;

// Наушники из виджета: PHONES в overlay.js. На macOS цвет задаёт система, важна только прозрачность.
const phones = (color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}"
  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 15v-3a8 8 0 0 1 16 0v3"/>
  <rect x="2.5" y="14" width="4.5" height="7" rx="1.5" fill="${color}"/>
  <rect x="17" y="14" width="4.5" height="7" rx="1.5" fill="${color}"/>
</svg>`;

const TARGETS = [
  { file: 'icon.png', size: 1024, svg: JAR },
  { file: 'trayTemplate.png', size: 16, svg: phones('#000') },
  { file: 'trayTemplate@2x.png', size: 32, svg: phones('#000') },
  { file: 'tray.png', size: 32, svg: JAR },
];

async function render({ file, size, svg }) {
  const win = new BrowserWindow({
    width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true },
  });
  const html = `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  fs.writeFileSync(path.join(ASSETS, file), image.resize({ width: size, height: size }).toPNG());
  win.destroy();
}

app.disableHardwareAcceleration();
// Окна рисуем по одному: иначе приложение завершится, как только закроется первое.
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const target of TARGETS) await render(target);
  app.quit();
});
