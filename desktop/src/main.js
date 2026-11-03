// Главный процесс: окно с Яндекс Музыкой и панелью, плеер поверх всех окон, трей, горячие клавиши.
// Настройки — не отдельное окно, а вид внутри главного окна или плеера.
// Логики комнаты здесь нет: она работает на странице Музыки тем же кодом, что и в расширении.

const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, Menu, Tray, WebContentsView, clipboard, globalShortcut, ipcMain, nativeImage, net,
  protocol, screen, session, shell,
} = require('electron');
const { pathToFileURL } = require('url');
const { createStore } = require('./store');

const MUSIC_URL = 'https://music.yandex.ru/';
const MUSIC_HOST_RE = /(^|\.)music\.yandex\.(ru|com|by|kz)$/;
const POLL_MS = 1000;
const STATUS_TIMEOUT_MS = 2500;
const MESSAGE_TIMEOUT_MS = 15000;
const RETRY_LOAD_MS = 5000;
const TOOLBAR_HEIGHT = 44;
const MINI_WIDTH = 340;
const MINI_MIN_HEIGHT = 120;
const SETTINGS_WIDTH = 320;
const SETTINGS_MIN_HEIGHT = 120;
const SETTINGS_GAP = 6;       // от кнопки «Джем» до настроек
const SETTINGS_MARGIN = 8;    // от настроек до края окна
const IS_MAC = process.platform === 'darwin';
const BACKGROUND = '#1C1C1C';

const GENERATED = path.join(__dirname, '..', 'generated');
const ASSETS = path.join(__dirname, '..', 'assets');

const MODES = { full: 'Полное окно', mini: 'Только плеер', tray: 'Свернуть в трей' };
const CLOSE_ACTIONS = { mini: 'Оставить плеер', tray: 'Свернуть в трей', quit: 'Выйти из приложения' };
const HOTKEYS = [
  { accelerator: 'CommandOrControl+Alt+P', label: 'Плей / пауза', run: () => control('toggle') },
  { accelerator: 'CommandOrControl+Alt+[', label: 'Предыдущий трек', run: () => control('prev') },
  { accelerator: 'CommandOrControl+Alt+]', label: 'Следующий трек', run: () => control('next') },
  { accelerator: 'CommandOrControl+Alt+J', label: 'Показать или скрыть плеер', run: () => toggleMini() },
];
const PREF_DEFAULTS = { mode: 'full', closeAction: 'mini', miniOnTop: true, hotkeys: true, trayIcon: true };
// Что окна настроек могут спрашивать у страницы Музыки — то же, что попап расширения у вкладки.
const MUSIC_MESSAGES = new Set(['yjam:status', 'yjam:diag', 'yjam:control', 'yjam:resync']);

let store;
let YJam;
let mainWindow = null;   // рамка окна и панель сверху
let musicView = null;    // сама Яндекс Музыка под панелью
let miniWindow = null;
let settingsView = null;  // попап расширения, живёт между открытиями
let settingsHost = null; // где открыт сейчас: 'main', 'mini' или нигде
let settingsHeight = 440;
let jamAnchor = null;    // кнопка «Джем» на панели, координаты в окне
let playerHeight = MINI_MIN_HEIGHT;
let playerOffset = 0;    // настройки над плеером: на столько плеер ниже верха окна
let tray = null;
let quitting = false;
let htmlFullScreen = false;
let lastStatus = { page: 'loading', status: null };
let failedHotkeys = [];
let menuKey = '';

// Должно быть до готовности приложения. Звук не ждёт клика по странице: иначе кнопки плеера
// и горячие клавиши не включали бы музыку после запуска.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([
  { scheme: 'yjam-asset', privileges: { standard: true, secure: true, bypassCSP: true, supportFetchAPI: true, corsEnabled: true } },
]);

const prefs = () => store.get(PREF_DEFAULTS);
const musicContents = () => (musicView ? musicView.webContents : null);

// ---------- сообщения на страницу Музыки ----------
let messageSeq = 0;
const pending = new Map();

function askMusic(msg, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (currentPage() !== 'music') { resolve(null); return; }
    const id = ++messageSeq;
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, timeoutMs);
    pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
    musicContents().send('yjam:message', id, msg);
  });
}

function currentPage() {
  const contents = musicContents();
  if (!contents || contents.isLoadingMainFrame()) return 'loading';
  try {
    return MUSIC_HOST_RE.test(new URL(contents.getURL()).hostname) ? 'music' : 'other';
  } catch (e) {
    return 'loading';
  }
}

// Результат показываем сразу, а не при следующем опросе: иначе кажется, что кнопка не сработала.
async function control(action) {
  const result = await askMusic({ type: 'yjam:control', action });
  poll();
  return result;
}

// ---------- режимы окон ----------
function setMode(mode) {
  if (!MODES[mode]) return;
  closeSettings();
  store.set({ mode });
  applyMode(mode);
  refreshMenus(true);
}

function applyMode(mode) {
  if (mode === 'full') {
    miniWindow.hide();
    mainWindow.show();
    mainWindow.focus();
    musicContents().focus();
  } else {
    mainWindow.hide();
    if (mode === 'mini') miniWindow.show();
    else miniWindow.hide();
  }
}

function toggleMini() {
  setMode(prefs().mode === 'mini' ? 'tray' : 'mini');
}

// Клик по значку в Доке и повторный запуск: показываем то, что открыто сейчас, а режим не меняем.
// Плеер без булавки иначе было бы не достать из-под других окон. В режиме трея окон нет, открываем полное.
function revealApp() {
  if (!mainWindow) return;
  const { mode } = prefs();
  if (mode === 'tray') { setMode('full'); return; }
  const win = mode === 'full' ? mainWindow : miniWindow;
  win.show();
  win.focus();
}

// ---------- главное окно: панель сверху, Яндекс Музыка под ней ----------
function layoutMusic() {
  if (!mainWindow || !musicView) return;
  const { width, height } = mainWindow.getContentBounds();
  const top = htmlFullScreen ? 0 : TOOLBAR_HEIGHT;
  musicView.setBounds({ x: 0, y: top, width, height: height - top });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 760,
    minHeight: 480,
    show: false,
    backgroundColor: BACKGROUND,
    title: 'babushkin-jam',
    icon: path.join(ASSETS, 'icon.png'),
    // Панель заменяет заголовок окна. Системные кнопки остаются на ней.
    titleBarStyle: 'hidden',
    ...(IS_MAC
      ? { trafficLightPosition: { x: 14, y: 15 } }
      : { titleBarOverlay: { color: BACKGROUND, symbolColor: '#F2F2F2', height: TOOLBAR_HEIGHT } }),
    webPreferences: {
      preload: path.join(GENERATED, 'preload-app.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'toolbar', 'toolbar.html'));
  mainWindow.webContents.on('did-finish-load', () => pushSettingsState());
  // Клик по самой кнопке «Джем» не считаем: она сама закроет настройки по своему нажатию.
  mainWindow.webContents.on('before-mouse-event', (_e, mouse) => {
    if (mouse.type === 'mouseDown' && settingsHost === 'main' && !insideJamAnchor(mouse)) closeSettings();
  });

  musicView = new WebContentsView({
    webPreferences: {
      preload: path.join(GENERATED, 'preload-music.js'),
      contextIsolation: true,
      sandbox: true,
      // Скрытое окно не должно притормаживать: от таймеров зависит синхронизация комнаты.
      backgroundThrottling: false,
    },
  });
  musicView.setBackgroundColor(BACKGROUND);
  mainWindow.contentView.addChildView(musicView);
  layoutMusic();
  mainWindow.on('resize', () => { layoutMusic(); layoutSettings(); });
  mainWindow.on('blur', () => { if (settingsHost === 'main') closeSettings(); });

  mainWindow.on('closed', () => {
    // Содержимое вида само не закрывается вместе с окном.
    if (musicView) musicView.webContents.close();
    if (settingsView) settingsView.webContents.close();
    musicView = null;
    settingsView = null;
    mainWindow = null;
  });
  mainWindow.on('close', (e) => {
    if (quitting) return;
    const { closeAction } = prefs();
    if (closeAction === 'quit') { app.quit(); return; }
    e.preventDefault();
    setMode(closeAction);
  });

  const contents = musicView.webContents;
  contents.on('before-mouse-event', (_e, mouse) => {
    if (mouse.type === 'mouseDown' && settingsHost === 'main') closeSettings();
  });
  contents.on('enter-html-full-screen', () => { htmlFullScreen = true; layoutMusic(); });
  contents.on('leave-html-full-screen', () => { htmlFullScreen = false; layoutMusic(); });

  // Ссылки «в новом окне»: Яндекс — внутри приложения (вход в аккаунт), остальное — в браузере.
  contents.setWindowOpenHandler(({ url }) => {
    let host = '';
    try { host = new URL(url).hostname; } catch (e) { return { action: 'deny' }; }
    if (MUSIC_HOST_RE.test(host)) { contents.loadURL(url); return { action: 'deny' }; }
    if (/(^|\.)(yandex\.[a-z]+|ya\.ru)$/.test(host)) return { action: 'allow' };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    if (!/^https:/.test(url)) e.preventDefault();
  });
  contents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    // -3 — переход отменён, это не ошибка. Остальное — например, нет сети: пробуем ещё.
    if (!isMainFrame || code === -3) return;
    setTimeout(() => { if (musicView) contents.loadURL(MUSIC_URL); }, RETRY_LOAD_MS);
  });

  contents.loadURL(MUSIC_URL);
}

// ---------- плеер поверх всех окон ----------
function createMiniWindow() {
  const { miniBounds } = store.get({ miniBounds: null });
  miniWindow = new BrowserWindow({
    width: MINI_WIDTH,
    height: MINI_MIN_HEIGHT,
    ...miniPosition(miniBounds),
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: BACKGROUND,
    title: 'babushkin-jam — плеер',
    webPreferences: {
      preload: path.join(GENERATED, 'preload-app.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  applyMiniOnTop();
  miniWindow.on('closed', () => { miniWindow = null; });
  miniWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    setMode('tray');
  });
  // Запоминаем место плеера, а не окна: над плеером могут быть раскрыты настройки.
  miniWindow.on('moved', () => {
    const { x, y } = miniWindow.getBounds();
    store.set({ miniBounds: { x, y: y + playerOffset } });
  });
  miniWindow.webContents.on('did-finish-load', () => { pushStatus(); pushSettingsState(); });
  miniWindow.loadFile(path.join(__dirname, 'mini', 'mini.html'));
}

// Монитор могли отключить: тогда плеер показываем у края основного экрана, а не за его пределами.
function miniPosition(saved) {
  const area = screen.getPrimaryDisplay().workArea;
  const fallback = { x: area.x + area.width - MINI_WIDTH - 24, y: area.y + 24 };
  if (!saved) return fallback;
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
    saved.x >= a.x && saved.y >= a.y && saved.x < a.x + a.width && saved.y < a.y + a.height);
  return onScreen ? { x: saved.x, y: saved.y } : fallback;
}

function applyMiniOnTop() {
  if (!miniWindow) return;
  const on = prefs().miniOnTop;
  miniWindow.setAlwaysOnTop(on, 'floating');
  if (IS_MAC) miniWindow.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on, skipTransformProcessType: true });
}

function setMiniHeight(height) {
  playerHeight = Math.max(Math.ceil(height), MINI_MIN_HEIGHT);
  layoutMini();
}

// Окно плеера — это сам плеер и раскрытые настройки. Плеер остаётся на месте экрана, настройки его не
// перекрывают: снизу, а если там не хватает места и сверху его больше — сверху.
function layoutMini() {
  const bounds = miniWindow.getBounds();
  const area = screen.getDisplayMatching({ ...bounds, y: bounds.y + playerOffset, height: playerHeight }).workArea;
  const player = Math.min(playerHeight, area.height);
  // нижний край не должен уйти за экран, когда панель раскрылась
  const top = Math.max(area.y, Math.min(bounds.y + playerOffset, area.y + area.height - player));

  let panel = 0;
  let above = false;
  if (settingsHost === 'mini') {
    const roomBelow = area.y + area.height - (top + player);
    const roomAbove = top - area.y;
    above = roomBelow < settingsHeight && roomAbove > roomBelow;
    panel = Math.min(settingsHeight, above ? roomAbove : roomBelow);
    settingsView.setBounds({ x: 0, y: above ? 0 : player, width: MINI_WIDTH, height: panel });
  }
  playerOffset = above ? panel : 0;
  pushSettingsState(above ? 'above' : 'below');
  miniWindow.setBounds({ x: bounds.x, y: top - playerOffset, width: MINI_WIDTH, height: player + panel });
}

// ---------- настройки: попап расширения внутри окна ----------
function createSettingsView() {
  settingsView = new WebContentsView({
    webPreferences: {
      preload: path.join(GENERATED, 'preload-app.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  settingsView.setBackgroundColor(BACKGROUND);
  settingsView.webContents.on('did-finish-load', () => pushSettingsState());
  settingsView.webContents.loadFile(path.join(GENERATED, 'settings', 'popup.html'));
}

function hostWindow() {
  return settingsHost === 'main' ? mainWindow : settingsHost === 'mini' ? miniWindow : null;
}

// Режим «только трей» окон не держит, поэтому настройки раскрываем в плеере.
function openSettings() {
  if (prefs().mode === 'tray') setMode('mini');
  const host = prefs().mode === 'full' ? 'main' : 'mini';
  if (settingsHost !== host) {
    closeSettings();
    if (!settingsView) createSettingsView();
    settingsHost = host;
    settingsView.setBorderRadius(host === 'main' ? 12 : 0);
    hostWindow().contentView.addChildView(settingsView);
    layoutSettings();
  }
  hostWindow().show();
  hostWindow().focus();
  settingsView.webContents.focus();
  pushSettingsState();
}

function closeSettings() {
  if (!settingsHost) return;
  const host = settingsHost;
  hostWindow().contentView.removeChildView(settingsView);
  settingsHost = null;
  if (host === 'mini') layoutMini();
  else if (mainWindow.isVisible()) musicContents().focus();
  pushSettingsState();
}

function toggleSettings() {
  if (settingsHost) closeSettings();
  else openSettings();
}

function layoutSettings() {
  if (settingsHost === 'mini') layoutMini();
  else if (settingsHost === 'main') layoutPopover();
}

// Строго под кнопкой «Джем»: левые края совпадают. Окно могут сделать низким — тогда настройки прокручиваются.
function layoutPopover() {
  const { width, height } = mainWindow.getContentBounds();
  const anchor = jamAnchor || { left: SETTINGS_MARGIN, bottom: TOOLBAR_HEIGHT };
  const x = Math.round(Math.max(SETTINGS_MARGIN, Math.min(anchor.left, width - SETTINGS_WIDTH - SETTINGS_MARGIN)));
  const y = Math.round(anchor.bottom + SETTINGS_GAP);
  settingsView.setBounds({
    x, y, width: SETTINGS_WIDTH, height: Math.min(settingsHeight, height - y - SETTINGS_MARGIN),
  });
}

function insideJamAnchor({ x, y }) {
  const a = jamAnchor;
  return !!a && x >= a.left && x <= a.right && y >= a.top && y <= a.bottom;
}

function setSettingsHeight(height) {
  settingsHeight = Math.max(Math.ceil(height), SETTINGS_MIN_HEIGHT);
  layoutSettings();
}

let settingsPlacement = 'below';

// Плееру — на сколько сдвинуться вниз, кнопкам — подсветка, самим настройкам — с какой стороны линия.
function pushSettingsState(side) {
  if (side) settingsPlacement = side;
  const placement = settingsHost === 'main' ? 'popover' : settingsPlacement;
  if (mainWindow) mainWindow.webContents.send('yjam:settings-state', { open: settingsHost === 'main' });
  if (miniWindow) miniWindow.webContents.send('yjam:settings-state', { open: settingsHost === 'mini', offset: playerOffset });
  if (settingsView) settingsView.webContents.send('yjam:settings-state', { placement });
}

// ---------- состояние для окон и трея ----------
let polling = false;

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const page = currentPage();
    const status = page === 'music' ? await askMusic({ type: 'yjam:status' }, STATUS_TIMEOUT_MS) : null;
    lastStatus = { page, status };
    pushStatus();
    refreshMenus();
  } finally {
    polling = false;
  }
}

function pushStatus() {
  for (const w of [mainWindow, miniWindow]) if (w) w.webContents.send('yjam:status', lastStatus);
}

// ---------- комната из меню ----------
function roomInfo() {
  const st = lastStatus.status;
  if (!st || !st.room) return null;
  const room = st.state;
  const members = (room && room.members) || [];
  const leader = room && members.find((m) => m.id === room.leaderId);
  return {
    code: st.room,
    conn: st.conn,
    count: members.length,
    leader: st.isLeader ? 'вы' : leader ? leader.name : '',
    warning: st.warning || '',
  };
}

function jamItems() {
  const info = roomInfo();
  if (!info) {
    return [
      { label: 'Вы не в комнате', enabled: false },
      { type: 'separator' },
      { label: 'Создать комнату', click: () => store.set({ room: YJam.randomCode() }) },
      { label: 'Войти по коду…', click: openSettings },
      { type: 'separator' },
      { label: 'Настройки синхронизации…', click: openSettings },
    ];
  }
  const online = info.conn === 'open';
  return [
    { label: `Комната ${info.code}${info.count ? ' · ' + info.count : ''}`, enabled: false },
    { label: online ? 'На связи' : 'Нет связи, пробуем ещё', enabled: false },
    ...(info.leader ? [{ label: `Ведущий: ${info.leader}`, enabled: false }] : []),
    ...(info.warning ? [{ label: info.warning.slice(0, 70), enabled: false }] : []),
    { type: 'separator' },
    { label: 'Скопировать ссылку', click: () => clipboard.writeText(YJam.inviteLink(info.code)) },
    { label: 'Синхронизировать', click: () => askMusic({ type: 'yjam:resync' }) },
    { label: 'Скопировать диагностику', click: copyDiagnostics },
    { type: 'separator' },
    { label: 'Настройки синхронизации…', click: openSettings },
    { label: 'Выйти из комнаты', click: () => store.set({ room: '' }) },
  ];
}

// ---------- меню: одно и то же в трее и в меню приложения ----------
function currentTrack() {
  const player = lastStatus.status && lastStatus.status.player;
  return (player && player.track) || null;
}

function isPlaying() {
  const player = lastStatus.status && lastStatus.status.player;
  return !!player && player.track && !player.paused;
}

function playerItems() {
  const has = !!currentTrack();
  return [
    // До первого плея сайт не сообщает трек, но включить музыку уже можно.
    { label: isPlaying() ? 'Пауза' : 'Плей', enabled: currentPage() === 'music', click: () => control('toggle') },
    { label: 'Предыдущий трек', enabled: has, click: () => control('prev') },
    { label: 'Следующий трек', enabled: has, click: () => control('next') },
  ];
}

function modeItems() {
  const p = prefs();
  return Object.entries(MODES).map(([mode, label]) => ({
    label, type: 'radio', checked: p.mode === mode, click: () => setMode(mode),
  }));
}

function onTopItem() {
  return {
    label: 'Плеер поверх всех окон', type: 'checkbox', checked: prefs().miniOnTop,
    click: (item) => store.set({ miniOnTop: item.checked }),
  };
}

function windowOptionItems() {
  const p = prefs();
  return [
    {
      label: 'При закрытии окна',
      submenu: Object.entries(CLOSE_ACTIONS).map(([action, label]) => ({
        label, type: 'radio', checked: p.closeAction === action,
        click: () => store.set({ closeAction: action }),
      })),
    },
    {
      label: 'Горячие клавиши', type: 'checkbox', checked: p.hotkeys,
      click: (item) => store.set({ hotkeys: item.checked }),
    },
    {
      label: 'Какие клавиши',
      submenu: [
        ...HOTKEYS.map((h) => ({ label: `${h.label}: ${hotkeyLabel(h.accelerator)}`, enabled: false })),
        ...(failedHotkeys.length ? [
          { type: 'separator' },
          { label: 'Заняты другой программой: ' + failedHotkeys.map(hotkeyLabel).join(', '), enabled: false },
        ] : []),
      ],
    },
  ];
}

function hotkeyLabel(accelerator) {
  return accelerator.replace('CommandOrControl', IS_MAC ? '⌘' : 'Ctrl').replace('Alt', IS_MAC ? '⌥' : 'Alt');
}

function applicationMenu() {
  return Menu.buildFromTemplate([
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    { label: 'Плеер', submenu: playerItems() },
    { label: 'Джем', submenu: jamItems() },
    { label: 'Окно', submenu: [...modeItems(), { type: 'separator' }, onTopItem(), ...windowOptionItems()] },
    { role: 'editMenu', label: 'Правка' },
    {
      label: 'Вид',
      submenu: [
        { label: 'Настройки…', accelerator: 'CommandOrControl+,', click: openSettings },
        { label: 'Обновить страницу', accelerator: 'CommandOrControl+R', click: () => musicContents().reload() },
        { role: 'togglefullscreen', label: 'На весь экран' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Крупнее' },
        { role: 'zoomOut', label: 'Мельче' },
        { role: 'resetZoom', label: 'Обычный размер' },
      ],
    },
    {
      label: 'Помощь',
      submenu: [
        { label: 'Скопировать диагностику', click: copyDiagnostics },
        { label: 'Инструменты разработчика', click: () => musicContents().openDevTools({ mode: 'detach' }) },
      ],
    },
  ]);
}

function trayMenu() {
  const t = currentTrack();
  const title = t ? `${t.title}${t.artist ? ' — ' + t.artist : ''}` : 'Ничего не играет';
  const info = roomInfo();
  return Menu.buildFromTemplate([
    { label: title.length > 60 ? title.slice(0, 59) + '…' : title, enabled: false },
    { type: 'separator' },
    ...playerItems(),
    { type: 'separator' },
    { label: info ? `Джем · ${info.code}${info.count ? ' · ' + info.count : ''}` : 'Джем', submenu: jamItems() },
    { label: 'Настройки…', click: openSettings },
    { type: 'separator' },
    ...modeItems(),
    onTopItem(),
    { label: 'Окно и клавиши', submenu: windowOptionItems() },
    { type: 'separator' },
    { label: 'Выйти', click: () => app.quit() },
  ]);
}

// Пересобираем меню, только когда в нём что-то изменилось: обновление раз в секунду закрывало бы его.
function refreshMenus(force = false) {
  const t = currentTrack();
  const key = JSON.stringify([t && t.title, t && t.artist, isPlaying(), currentPage(), prefs(), failedHotkeys, roomInfo()]);
  if (!force && key === menuKey) return;
  menuKey = key;
  Menu.setApplicationMenu(applicationMenu());
  if (tray) {
    tray.setContextMenu(trayMenu());
    tray.setToolTip(t ? `${t.title}${t.artist ? ' — ' + t.artist : ''}` : 'babushkin-jam');
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, IS_MAC ? 'trayTemplate.png' : 'tray.png'));
  tray = new Tray(icon);
  // На macOS клик открывает меню сам. На Windows меню — правой кнопкой, а левая управляет плеером.
  if (!IS_MAC) {
    tray.on('click', toggleMini);
    tray.on('double-click', () => setMode('full'));
  }
}

function applyTrayIcon() {
  if (prefs().trayIcon) {
    if (!tray) createTray();
  } else if (tray) {
    tray.destroy();
    tray = null;
  }
}

// ---------- горячие клавиши ----------
function applyHotkeys() {
  globalShortcut.unregisterAll();
  failedHotkeys = [];
  if (prefs().hotkeys) {
    for (const h of HOTKEYS) {
      if (!globalShortcut.register(h.accelerator, h.run)) failedHotkeys.push(h.accelerator);
    }
  }
  refreshMenus(true);
}

async function copyDiagnostics() {
  const diag = await askMusic({ type: 'yjam:diag' });
  clipboard.writeText(JSON.stringify({ app: app.getVersion(), page: currentPage(), diag }, null, 2));
}

// ---------- настройки изменились ----------
function onStoreChange(changes) {
  for (const w of [mainWindow, miniWindow, musicView, settingsView]) {
    if (w) w.webContents.send('yjam:storage-changed', changes);
  }
  if (changes.miniOnTop) applyMiniOnTop();
  if (changes.trayIcon) applyTrayIcon();
  // Меню собирается и при запуске, когда горячих клавиш ещё нет: применяем только изменение.
  if (changes.hotkeys) applyHotkeys();
  else refreshMenus();
}

// ---------- мост к окнам ----------
function setupIpc() {
  const known = (e) => {
    const contents = [mainWindow, miniWindow, musicView, settingsView].filter(Boolean).map((w) => w.webContents);
    return contents.includes(e.sender);
  };
  const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => (known(e) ? fn(...args) : null));

  handle('yjam:storage-get', (keys) => store.get(keys));
  handle('yjam:storage-set', (items) => store.set(items));
  handle('yjam:storage-remove', (keys) => store.remove(keys));
  handle('yjam:control', (action) => control(action));
  handle('yjam:seek', (position) => askMusic({ type: 'yjam:seek', position: Number(position) || 0 }));
  handle('yjam:queue', () => askMusic({ type: 'yjam:queue' }, STATUS_TIMEOUT_MS));
  handle('yjam:queue-play', async (index, id) => {
    const result = await askMusic({ type: 'yjam:queue-play', index: Number(index), id: String(id) });
    poll();
    return result;
  });
  handle('yjam:set-mode', (mode) => setMode(mode));
  handle('yjam:copy', (text) => clipboard.writeText(String(text)));
  handle('yjam:toggle-settings', () => toggleSettings());
  handle('yjam:close-settings', () => closeSettings());
  handle('yjam:reload-music', () => musicContents().reload());
  handle('yjam:music-ready', () => currentPage() === 'music');
  handle('yjam:ask-music', async (msg) => {
    if (!msg || !MUSIC_MESSAGES.has(msg.type)) return null;
    const result = await askMusic(msg);
    if (msg.type === 'yjam:control') poll();
    // Попап предлагает открыть вкладку, пока плей не нажимали на самой странице. Здесь звук включается и так.
    return msg.type === 'yjam:status' && result ? { ...result, canPlay: true } : result;
  });
  handle('yjam:info', () => ({
    version: app.getVersion(),
    platform: IS_MAC ? 'macOS' : 'Windows',
    modes: MODES,
    closeActions: CLOSE_ACTIONS,
    prefDefaults: PREF_DEFAULTS,
    hotkeys: HOTKEYS.map((h) => ({ label: h.label, keys: hotkeyLabel(h.accelerator) })),
  }));

  ipcMain.on('yjam:reply', (e, id, result) => {
    if (!known(e)) return;
    const done = pending.get(id);
    if (done) { pending.delete(id); done(result); }
  });
  ipcMain.on('yjam:window-height', (e, height) => {
    if (miniWindow && e.sender === miniWindow.webContents) setMiniHeight(height);
    else if (settingsView && e.sender === settingsView.webContents) setSettingsHeight(height);
  });
  ipcMain.on('yjam:jam-anchor', (e, rect) => {
    if (!mainWindow || e.sender !== mainWindow.webContents) return;
    jamAnchor = rect;
    layoutSettings();
  });
}

// Шрифты джема для окон приложения.
function setupAssets() {
  const fontsDir = path.join(GENERATED, 'fonts');
  protocol.handle('yjam-asset', async (request) => {
    const name = path.basename(new URL(request.url).pathname);
    const file = path.join(fontsDir, name);
    if (!fs.existsSync(file)) return new Response('', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    return new Response(res.body, {
      headers: { 'content-type': 'font/woff2', 'access-control-allow-origin': '*' },
    });
  });
}

// Сайт видит обычный Chromium: с приписками Electron и названия приложения Яндекс может
// счесть браузер неподдерживаемым.
function setupSession() {
  const ua = session.defaultSession.getUserAgent()
    .replace(/\s*Electron\/\S+/, '')
    .replace(new RegExp('\\s*' + app.getName().replace(/[^\w-]/g, '\\$&') + '/\\S+'), '');
  session.defaultSession.setUserAgent(ua);
  app.userAgentFallback = ua;
  // Сайту нужен только буфер обмена (кнопка «копировать») и полный экран.
  const ALLOWED = new Set(['clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(ALLOWED.has(permission)));
}

// Коды комнат и ссылки — из того же shared.js, что и в расширении. Он рассчитан на окно с chrome.*,
// а здесь нужны только чистые функции.
function loadShared() {
  const source = fs.readFileSync(path.join(GENERATED, 'shared.js'), 'utf8');
  const stubChrome = { runtime: { getManifest: () => ({ name: 'babushkin-jam' }) } };
  return new Function('chrome', `${source}\nreturn YJam;`)(stubChrome);
}

// ---------- запуск ----------
if (!app.requestSingleInstanceLock()) {
  // Каждая копия была бы отдельным участником комнаты — оставляем одну.
  app.quit();
} else {
  app.on('second-instance', revealApp);
  // Окна не закрываются, а прячутся, поэтому приложение живёт до явного выхода.
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!IS_MAC || quitting) app.quit(); });
  app.on('activate', revealApp);
  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.whenReady().then(() => {
    YJam = loadShared();
    store = createStore(path.join(app.getPath('userData'), 'settings.json'), onStoreChange);
    setupSession();
    setupAssets();
    setupIpc();
    createMainWindow();
    createMiniWindow();
    applyTrayIcon();
    applyHotkeys();
    applyMode(prefs().mode);
    setInterval(poll, POLL_MS);
  });
}
