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
const { createUpdater } = require('./updater');

const MUSIC_URL = 'https://music.yandex.ru/';
const RELEASES_URL = 'https://github.com/imbabyboy/babushkin-jam/releases/latest';
const MUSIC_HOST_RE = /(^|\.)music\.yandex\.(ru|com|by|kz)$/;
const POLL_MS = 1000;
const MINI_DRAG_TICK_MS = 16;
const PLAYBACK_SAVE_MS = 5000;
const PLAYBACK_END_MARGIN_SEC = 5; // с самого конца начинать незачем: трек тут же кончится
const PLAYBACK_QUEUE_MAX = 1000;
const RESTORE_TIMEOUT_MS = 60000;
const RESTORE_ROOM_WAIT_MS = 5000; // столько ждём ответа сервера, одни ли мы в комнате
const STATUS_TIMEOUT_MS = 2500;
const MESSAGE_TIMEOUT_MS = 15000;
const RETRY_LOAD_MS = 5000;
const TOOLBAR_HEIGHT = 44;
const MINI_WIDTH = 340;
const SETTINGS_READY_MAX_MS = 1000; // страница ещё грузится: дальше показываем как есть
const TRAY_PANEL_WIDTH = 320;
const TRAY_PANEL_GAP = 6;
const TRAY_PANEL_REOPEN_MS = 300; // клик по иконке сначала убирает фокус с панели и прячет её, открывать снова не надо
const MINI_NANO_WIDTH = 120; // три кнопки и поля вокруг них
const MINI_NORMAL_WIDTH = 380;
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
// В узких переключателях настроек и трея длинные названия не помещаются.
const MODE_LABELS = { full: 'Окно', mini: 'Плеер', tray: 'В трей' };
const CLOSE_LABELS = { mini: 'Плеер', tray: 'В трей', quit: 'Выйти' };
const HOTKEYS = [
  { accelerator: 'CommandOrControl+Alt+P', label: 'Плей / пауза', run: () => control('toggle') },
  { accelerator: 'CommandOrControl+Alt+[', label: 'Предыдущий трек', run: () => control('prev') },
  { accelerator: 'CommandOrControl+Alt+]', label: 'Следующий трек', run: () => control('next') },
  { accelerator: 'CommandOrControl+Alt+J', label: 'Показать или скрыть плеер', run: () => toggleMini() },
];
const MINI_VIEWS = { nano: 'Нано', micro: 'Микро', normal: 'Нормальный' };
const PREF_DEFAULTS = { mode: 'full', closeAction: 'mini', miniOnTop: true, miniView: 'micro', hotkeys: true, trayIcon: true, rememberPlayback: true };
// Что окна настроек могут спрашивать у страницы Музыки — то же, что попап расширения у вкладки.
const MUSIC_MESSAGES = new Set(['yjam:status', 'yjam:diag', 'yjam:control', 'yjam:resync']);

let store;
let YJam;
let updater;
let mainWindow = null;   // рамка окна и панель сверху
let musicView = null;    // сама Яндекс Музыка под панелью
let miniWindow = null;
let settingsView = null;  // попап расширения, живёт между открытиями
let settingsHost = null; // где открыт сейчас: 'main', 'mini' или нигде
let settingsHeight = 440;
let toolbarAnchors = null; // кнопки «Джем» и «Настройки» на панели, координаты в окне
let playerHeight = MINI_MIN_HEIGHT;
let playerOffset = 0;    // настройки над плеером: на столько плеер ниже верха окна
let tray = null;
let trayPanel = null;
let trayPanelHeight = 0;
let trayPanelHiddenAt = 0;
let quitting = false;
let htmlFullScreen = false;
let lastStatus = { page: 'loading', status: null };
let failedHotkeys = [];
let menuKey = '';
let miniDrag = null;     // тащим плеер: отступ курсора от угла окна и таймер
let playbackStore = null; // трек, время и плейлист: меняются часто, поэтому не в настройках
let restoreState = 'waiting'; // waiting, reload (страница перезагружается), running, done
let restoreWaitFrom = 0;
let playbackSavedAt = 0;
let playbackForgotten = false; // сбросили: снова запоминаем, только когда музыку включат
let latestQueue = null;

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

// ---------- память о том, что играло ----------
function rememberPlayback(status, force = false) {
  if (restoreState !== 'done' || !prefs().rememberPlayback) return;
  const player = status && status.player;
  const track = player && player.ok && player.track;
  // Пока трек меняется, позиция относится к прошлому.
  if (!track || !track.id || player.loading || player.trackPending) return;
  if (playbackForgotten) {
    if (player.paused) return;
    playbackForgotten = false;
    if (latestQueue) playbackStore.set({ queue: latestQueue });
  }
  const { playback } = playbackStore.get({ playback: null });
  const sameTrack = !!playback && playback.id === String(track.id);
  if (!force && sameTrack && Date.now() - playbackSavedAt < PLAYBACK_SAVE_MS) return;
  const nearEnd = player.duration > 0 && player.position > player.duration - PLAYBACK_END_MARGIN_SEC;
  playbackSavedAt = Date.now();
  playbackStore.set({
    playback: {
      id: String(track.id),
      albumId: track.albumId ? String(track.albumId) : null,
      position: nearEnd ? 0 : Math.round(player.position),
      paused: !!player.paused,
    },
  });
}

function saveQueue(tracks, currentId) {
  if (!Array.isArray(tracks)) return;
  latestQueue = { tracks: tracks.slice(-PLAYBACK_QUEUE_MAX), currentId: currentId || null };
  if (prefs().rememberPlayback && !playbackForgotten) playbackStore.set({ queue: latestQueue });
}

function forgetPlayback() {
  playbackStore.remove(['playback', 'queue']);
}

// Кнопка «Сбросить»: на паузе трек и список больше не запоминаем, иначе после перезапуска они вернулись бы.
function resetPlayback() {
  forgetPlayback();
  latestQueue = null;
  playbackForgotten = true;
  if (miniWindow) miniWindow.webContents.send('yjam:playback-reset');
}

// Есть что возвращать, но ещё не вернули: окна пишут «Загрузка…», а не случайный трек, показанный сайтом.
function isRestoring() {
  return restoreState !== 'done' && prefs().rememberPlayback && !!playbackStore.get({ playback: null }).playback;
}

// Кроме нас в комнате кто-то есть: трек и время задаёт она. Один в комнате — она подстраивается под нас.
// Нет связи с сервером — тоже восстанавливаем: если там кто-то есть, после подключения комната своё вернёт.
function roomDecides(status) {
  return !!status.room && !!status.state && status.state.members.length > 1;
}

// Трек придётся включить, поэтому на это время выключаем звук окна.
async function restorePlayback(status) {
  if (restoreState !== 'waiting' || !status.player || !status.player.ok) return;
  const { playback } = playbackStore.get({ playback: null });
  if (!prefs().rememberPlayback || !playback) {
    restoreState = 'done';
    return;
  }
  if (status.room && !status.state) {
    if (!restoreWaitFrom) restoreWaitFrom = Date.now();
    if (Date.now() - restoreWaitFrom < RESTORE_ROOM_WAIT_MS) return;
  }
  if (roomDecides(status)) {
    restoreState = 'done';
    return;
  }
  restoreState = 'running';
  const contents = musicContents();
  let onNavigate = null;
  const navigated = new Promise((resolve) => { onNavigate = resolve; });
  contents.once('did-navigate', onNavigate); // сайт перезагрузился: ответа уже не будет
  contents.setAudioMuted(true);
  try {
    const result = await Promise.race([
      askMusic({ type: 'yjam:restore', ...playback, timeoutMs: RESTORE_TIMEOUT_MS }, RESTORE_TIMEOUT_MS),
      navigated.then(() => ({ ok: false, error: 'страница перезагрузилась' })),
    ]);
    // На сайт с аккаунтом можно посмотреть только у автора: по этой записи видно, что случилось при запуске.
    playbackStore.set({ lastRestore: { result, track: playback.id, position: playback.position } });
  } finally {
    if (!contents.isDestroyed()) {
      contents.removeListener('did-navigate', onNavigate);
      contents.setAudioMuted(false);
    }
    restoreState = 'done';
    poll();
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
  // Клик по самим кнопкам не считаем: они сами закроют или переключат страницу по своему нажатию.
  mainWindow.webContents.on('before-mouse-event', (_e, mouse) => {
    if (mouse.type === 'mouseDown' && settingsHost === 'main' && !insideToolbarAnchor(mouse)) closeSettings();
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
  contents.on('did-finish-load', () => { if (restoreState === 'reload') restoreState = 'waiting'; });

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
    width: miniWidth(),
    height: MINI_MIN_HEIGHT,
    ...miniPosition(miniBounds),
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    backgroundColor: BACKGROUND,
    icon: path.join(ASSETS, 'icon.png'),
    title: 'babushkin-jam — плеер',
    // Окно тащим сами, поэтому первый же клик по неактивному окну должен дойти до страницы.
    acceptFirstMouse: true,
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
  miniWindow.on('moved', () => { if (!miniDrag) saveMiniPosition(); });
  miniWindow.on('hide', stopMiniDrag);
  miniWindow.webContents.on('did-finish-load', () => { pushStatus(); pushSettingsState(); });
  miniWindow.loadFile(path.join(__dirname, 'mini', 'mini.html'));
}

// Запоминаем место плеера, а не окна: над плеером могут быть раскрыты настройки.
function saveMiniPosition() {
  const { x, y } = miniWindow.getBounds();
  store.set({ miniBounds: { x, y: y + playerOffset } });
}

// Системная зона перетаскивания забирает клики себе, и двойной клик до страницы не дошёл бы.
// Поэтому страница только говорит «начали» и «отпустили», а окно идёт за курсором отсюда.
function startMiniDrag() {
  if (!miniWindow || miniDrag) return;
  const cursor = screen.getCursorScreenPoint();
  const { x, y } = miniWindow.getBounds();
  miniDrag = {
    dx: cursor.x - x,
    dy: cursor.y - y,
    timer: setInterval(() => {
      const now = screen.getCursorScreenPoint();
      const { width, height } = miniWindow.getBounds();
      miniWindow.setBounds({ x: now.x - miniDrag.dx, y: now.y - miniDrag.dy, width, height });
    }, MINI_DRAG_TICK_MS),
  };
}

function stopMiniDrag() {
  if (!miniDrag) return;
  clearInterval(miniDrag.timer);
  miniDrag = null;
  saveMiniPosition();
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

// Раскрытые настройки в нано не поместились бы, поэтому на это время окно обычной ширины.
function miniWidth() {
  const { miniView } = prefs();
  if (miniView === 'normal') return MINI_NORMAL_WIDTH;
  return miniView === 'nano' && settingsHost !== 'mini' ? MINI_NANO_WIDTH : MINI_WIDTH;
}

function setMiniHeight(height) {
  playerHeight = Math.ceil(height);
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

  const width = miniWidth();
  let panel = 0;
  let above = false;
  if (settingsHost === 'mini') {
    const roomBelow = area.y + area.height - (top + player);
    const roomAbove = top - area.y;
    above = roomBelow < settingsHeight && roomAbove > roomBelow;
    panel = Math.min(settingsHeight, above ? roomAbove : roomBelow);
    settingsView.setBounds({ x: 0, y: above ? 0 : player, width, height: panel });
  }
  playerOffset = above ? panel : 0;
  pushSettingsState(above ? 'above' : 'below');
  // Нано могли поставить к правому краю: при расширении окно не должно уйти за экран.
  const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - width));
  miniWindow.setBounds({ x, y: top - playerOffset, width, height: player + panel });
}

// ---------- настройки: попап расширения внутри окна ----------
function createSettingsView() {
  settingsView = new WebContentsView({
    webPreferences: {
      preload: path.join(GENERATED, 'preload-app.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false, // иначе скрытая страница не перерисуется к следующему показу
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
async function openSettings(page = 'settings') {
  settingsPage = page;
  if (prefs().mode === 'tray') setMode('mini');
  const opening = ++settingsOpening;
  if (!settingsView) createSettingsView();
  // Сначала меняем страницу, потом показываем: иначе на миг видна прошлая страница и прошлая высота.
  const height = await settingsPageReady(page);
  if (opening !== settingsOpening) return; // пока ждали, закрыли или открыли другую
  if (height) setSettingsHeight(height);
  const host = prefs().mode === 'full' ? 'main' : 'mini';
  if (settingsHost !== host) {
    closeSettings();
    settingsHost = host;
    settingsView.setBorderRadius(host === 'main' ? 12 : 0);
    hostWindow().contentView.addChildView(settingsView);
  }
  layoutSettings();
  hostWindow().show();
  hostWindow().focus();
  settingsView.webContents.focus();
  pushSettingsState();
}

function settingsPageReady(page) {
  const ready = settingsView.webContents.executeJavaScript(`window.yjamShowPage(${JSON.stringify(page)})`).catch(() => 0);
  const late = new Promise((resolve) => { setTimeout(() => resolve(0), SETTINGS_READY_MAX_MS); });
  return Promise.race([ready, late]);
}

function closeSettings() {
  settingsOpening++;
  if (!settingsHost) return;
  const host = settingsHost;
  hostWindow().contentView.removeChildView(settingsView);
  settingsHost = null;
  if (host === 'mini') layoutMini();
  // Фокус возвращаем, только если окно и так в фокусе: иначе оно отнимет его у панели трея, и та закроется.
  else if (mainWindow.isFocused()) musicContents().focus();
  pushSettingsState();
}

// «Джем» открывает комнату, шестерёнка — настройки. Вторая кнопка при открытой первой просто переключает страницу.
function toggleSettings(page = 'main') {
  if (settingsHost && settingsPage === page) closeSettings();
  else openSettings(page);
}

function layoutSettings() {
  if (settingsHost === 'mini') layoutMini();
  else if (settingsHost === 'main') layoutPopover();
}

// Строго под кнопкой «Джем»: левые края совпадают. Окно могут сделать низким — тогда настройки прокручиваются.
function layoutPopover() {
  const { width, height } = mainWindow.getContentBounds();
  const anchor = toolbarAnchors && toolbarAnchors[settingsPage];
  // Джем стоит слева и открывается вправо от кнопки, настройки — наоборот.
  const wanted = !anchor ? SETTINGS_MARGIN : settingsPage === 'settings' ? anchor.right - SETTINGS_WIDTH : anchor.left;
  const x = Math.round(Math.max(SETTINGS_MARGIN, Math.min(wanted, width - SETTINGS_WIDTH - SETTINGS_MARGIN)));
  const y = Math.round((anchor ? anchor.bottom : TOOLBAR_HEIGHT) + SETTINGS_GAP);
  settingsView.setBounds({
    x, y, width: SETTINGS_WIDTH, height: Math.min(settingsHeight, height - y - SETTINGS_MARGIN),
  });
}

function insideToolbarAnchor({ x, y }) {
  return Object.values(toolbarAnchors || {}).some((a) => x >= a.left && x <= a.right && y >= a.top && y <= a.bottom);
}

function setSettingsHeight(height) {
  settingsHeight = Math.max(Math.ceil(height), SETTINGS_MIN_HEIGHT);
  layoutSettings();
}

let settingsPlacement = 'below';
let settingsPage = 'main'; // 'main' — комната, 'settings' — настройки
let settingsOpening = 0;

// Плееру — на сколько сдвинуться вниз, кнопкам — подсветка, самим настройкам — с какой стороны линия.
function pushSettingsState(side) {
  if (side) settingsPlacement = side;
  const placement = settingsHost === 'main' ? 'popover' : settingsPlacement;
  if (mainWindow) mainWindow.webContents.send('yjam:settings-state', { open: settingsHost === 'main', page: settingsPage });
  if (miniWindow) miniWindow.webContents.send('yjam:settings-state', { open: settingsHost === 'mini', offset: playerOffset, page: settingsPage });
  if (settingsView) settingsView.webContents.send('yjam:settings-state', { placement, page: settingsPage });
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
    if (status) {
      restorePlayback(status);
      rememberPlayback(status);
    }
  } finally {
    polling = false;
  }
}

function pushStatus() {
  const data = { ...lastStatus, restoring: isRestoring() };
  for (const w of [mainWindow, miniWindow, trayPanel]) if (w) w.webContents.send('yjam:status', data);
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
      { label: 'Войти по коду…', click: () => openSettings('main') },
      { type: 'separator' },
      { label: 'Настройки синхронизации…', click: () => openSettings('main') },
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
    { label: 'Настройки синхронизации…', click: () => openSettings('main') },
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

// В нано нет шестерёнки, а отсюда вид меняется без полного окна.
function miniViewItem() {
  const { miniView } = prefs();
  return {
    label: 'Вид плеера',
    submenu: Object.entries(MINI_VIEWS).map(([view, label]) => ({
      label, type: 'radio', checked: miniView === view,
      click: () => store.set({ miniView: view }),
    })),
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
    { label: 'Окно', submenu: [...modeItems(), { type: 'separator' }, miniViewItem(), onTopItem(), ...windowOptionItems()] },
    { role: 'editMenu', label: 'Правка' },
    {
      label: 'Вид',
      submenu: [
        { label: 'Настройки…', accelerator: 'CommandOrControl+,', click: () => openSettings('settings') },
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

// Пересобираем меню, только когда в нём что-то изменилось: обновление раз в секунду закрывало бы его.
function refreshMenus(force = false) {
  const t = currentTrack();
  const key = JSON.stringify([t && t.title, t && t.artist, isPlaying(), currentPage(), prefs(), failedHotkeys, roomInfo()]);
  if (!force && key === menuKey) return;
  menuKey = key;
  Menu.setApplicationMenu(applicationMenu());
  if (tray) {
    tray.setToolTip(t ? `${t.title}${t.artist ? ' — ' + t.artist : ''}` : 'babushkin-jam');
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, IS_MAC ? 'trayTemplate.png' : 'tray.png'));
  tray = new Tray(icon);
  createTrayPanel();
  tray.on('right-click', toggleTrayPanel);
  // На Windows левая кнопка по привычке управляет плеером.
  if (IS_MAC) {
    tray.on('click', toggleTrayPanel);
  } else {
    tray.on('click', toggleMini);
    tray.on('double-click', () => setMode('full'));
  }
}

// Системное меню не умеет кнопок в одну строку, поэтому под иконкой — своё окно.
function createTrayPanel() {
  trayPanel = new BrowserWindow({
    width: TRAY_PANEL_WIDTH,
    height: 400,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // panel и размытие только на macOS: panel показывается поверх чужих полноэкранных окон.
    ...(IS_MAC
      ? { type: 'panel', vibrancy: 'menu', visualEffectState: 'active', backgroundColor: '#00000000' }
      : { backgroundColor: BACKGROUND }),
    title: 'babushkin-jam — трей',
    webPreferences: {
      preload: path.join(GENERATED, 'preload-app.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (IS_MAC) trayPanel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  trayPanel.on('closed', () => { trayPanel = null; });
  trayPanel.on('blur', hideTrayPanel);
  trayPanel.webContents.on('did-finish-load', pushStatus);
  trayPanel.loadFile(path.join(GENERATED, 'settings', 'popup.html'), { search: 'host=tray' });
}

// Панель задач на Windows бывает и снизу, и сверху: окно ставим с той стороны иконки, где есть место.
function placeTrayPanel() {
  const icon = tray.getBounds();
  const area = screen.getDisplayNearestPoint({ x: icon.x, y: icon.y }).workArea;
  const height = Math.min(trayPanelHeight || 400, area.height - TRAY_PANEL_GAP * 2);
  const x = Math.max(area.x + TRAY_PANEL_GAP, Math.min(
    icon.x + icon.width / 2 - TRAY_PANEL_WIDTH / 2,
    area.x + area.width - TRAY_PANEL_WIDTH - TRAY_PANEL_GAP,
  ));
  const below = icon.y + icon.height / 2 < area.y + area.height / 2;
  const y = below
    ? Math.max(area.y + TRAY_PANEL_GAP, icon.y + icon.height + TRAY_PANEL_GAP)
    : Math.max(area.y + TRAY_PANEL_GAP, icon.y - height - TRAY_PANEL_GAP);
  trayPanel.setBounds({ x: Math.round(x), y: Math.round(y), width: TRAY_PANEL_WIDTH, height });
}

function toggleTrayPanel() {
  if (!trayPanel) createTrayPanel();
  if (trayPanel.isVisible()) { hideTrayPanel(); return; }
  if (Date.now() - trayPanelHiddenAt < TRAY_PANEL_REOPEN_MS) return;
  placeTrayPanel();
  pushStatus();
  trayPanel.show();
  trayPanel.focus();
}

function hideTrayPanel() {
  if (!trayPanel || !trayPanel.isVisible()) return;
  trayPanelHiddenAt = Date.now();
  trayPanel.hide();
}

function applyTrayIcon() {
  if (prefs().trayIcon) {
    if (!tray) createTray();
  } else if (tray) {
    if (trayPanel) trayPanel.destroy();
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
  for (const w of [mainWindow, miniWindow, musicView, settingsView, trayPanel]) {
    if (w) w.webContents.send('yjam:storage-changed', changes);
  }
  if (changes.miniOnTop) applyMiniOnTop();
  if (changes.miniView && miniWindow) layoutMini();
  if (changes.trayIcon) applyTrayIcon();
  if (changes.rememberPlayback) {
    if (!changes.rememberPlayback.newValue) forgetPlayback();
    else if (latestQueue) playbackStore.set({ queue: latestQueue });
  }
  // Меню собирается и при запуске, когда горячих клавиш ещё нет: применяем только изменение.
  if (changes.hotkeys) applyHotkeys();
  else refreshMenus();
}

// ---------- мост к окнам ----------
function setupIpc() {
  const known = (e) => {
    const contents = [mainWindow, miniWindow, musicView, settingsView, trayPanel].filter(Boolean).map((w) => w.webContents);
    return contents.includes(e.sender);
  };
  const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => (known(e) ? fn(...args) : null));

  handle('yjam:storage-get', (keys) => store.get(keys));
  handle('yjam:storage-set', (items) => store.set(items));
  handle('yjam:storage-remove', (keys) => store.remove(keys));
  handle('yjam:control', (action) => control(action));
  handle('yjam:seek', (position) => askMusic({ type: 'yjam:seek', position: Number(position) || 0 }));
  handle('yjam:volume', (level, before) => askMusic({ type: 'yjam:volume', level: Number(level) || 0, before: Number(before) || 0 }));
  handle('yjam:queue', () => askMusic({ type: 'yjam:queue' }, STATUS_TIMEOUT_MS));
  handle('yjam:saved-queue', () => (prefs().rememberPlayback ? playbackStore.get({ queue: null }).queue : null));
  handle('yjam:save-queue', (tracks, currentId) => saveQueue(tracks, currentId));
  handle('yjam:reset-playback', () => resetPlayback());
  handle('yjam:drag-window', (on) => (on ? startMiniDrag() : stopMiniDrag()));
  handle('yjam:queue-play', async (index, id, albumId) => {
    const result = await askMusic({
      type: 'yjam:queue-play', index: Number(index), id: String(id), albumId: albumId ? String(albumId) : null,
    });
    poll();
    return result;
  });
  handle('yjam:set-mode', (mode) => { hideTrayPanel(); setMode(mode); });
  handle('yjam:open-settings', (page) => { hideTrayPanel(); openSettings(page === 'main' ? 'main' : 'settings'); });
  handle('yjam:hide-tray-panel', () => hideTrayPanel());
  handle('yjam:quit', () => app.quit());
  handle('yjam:copy', (text) => clipboard.writeText(String(text)));
  // Окно передаёт только данные трека, а адрес строится здесь: страница не может открыть произвольную ссылку.
  handle('yjam:open-song-page', (track) => shell.openExternal(YJam.songPageUrl(track)));
  // Короткую ссылку спрашиваем отсюда: у окна плеера CSP без connect-src.
  handle('yjam:copy-song-page', async (track) => clipboard.writeText(await YJam.shortSongPageUrl(track)));
  handle('yjam:toggle-settings', (page) => toggleSettings(page === 'settings' ? 'settings' : 'main'));
  handle('yjam:close-settings', () => closeSettings());
  handle('yjam:reload-music', () => {
    rememberPlayback(lastStatus.status, true);
    restoreState = 'reload';
    musicContents().reload();
  });
  handle('yjam:update-state', () => updater.getState());
  handle('yjam:update-install', () => updater.install());
  handle('yjam:music-ready', () => currentPage() === 'music');
  handle('yjam:ask-music', async (msg) => {
    if (!msg || !MUSIC_MESSAGES.has(msg.type)) return null;
    const result = await askMusic(msg);
    if (msg.type === 'yjam:control') poll();
    // Попап предлагает открыть вкладку, пока плей не нажимали на самой странице. Здесь звук включается и так.
    return msg.type === 'yjam:status' && result ? { ...result, canPlay: true, restoring: isRestoring() } : result;
  });
  handle('yjam:info', () => ({
    version: app.getVersion(),
    platform: IS_MAC ? 'macOS' : 'Windows',
    modeLabels: MODE_LABELS,
    miniViews: MINI_VIEWS,
    closeLabels: CLOSE_LABELS,
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
    else if (trayPanel && e.sender === trayPanel.webContents) {
      trayPanelHeight = Math.ceil(height);
      if (trayPanel.isVisible()) placeTrayPanel();
      else trayPanel.setContentSize(TRAY_PANEL_WIDTH, trayPanelHeight);
    }
  });
  ipcMain.on('yjam:toolbar-anchors', (e, rects) => {
    if (!mainWindow || e.sender !== mainWindow.webContents) return;
    toolbarAnchors = rects;
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

function setupUpdater() {
  updater = createUpdater({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    pid: process.pid,
    tempDir: path.join(app.getPath('temp'), 'babushkin-jam-update'),
    fetch: (url, options) => net.fetch(url, options),
    openReleases: () => shell.openExternal(RELEASES_URL),
    quit: () => app.quit(),
    onChange: (state) => { if (mainWindow) mainWindow.webContents.send('yjam:update-state', state); },
  });
  // При запуске из исходников обновлять нечего.
  if (app.isPackaged) updater.start();
}

// ---------- запуск ----------
if (!app.requestSingleInstanceLock()) {
  // Каждая копия была бы отдельным участником комнаты — оставляем одну.
  app.quit();
} else {
  app.on('second-instance', revealApp);
  // Окна не закрываются, а прячутся, поэтому приложение живёт до явного выхода.
  app.on('before-quit', () => {
    quitting = true;
    if (playbackStore) rememberPlayback(lastStatus.status, true);
  });
  app.on('window-all-closed', () => { if (!IS_MAC || quitting) app.quit(); });
  app.on('activate', revealApp);
  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.whenReady().then(() => {
    YJam = loadShared();
    store = createStore(path.join(app.getPath('userData'), 'settings.json'), onStoreChange);
    playbackStore = createStore(path.join(app.getPath('userData'), 'playback.json'), () => {});
    setupSession();
    setupAssets();
    setupUpdater();
    setupIpc();
    createMainWindow();
    createMiniWindow();
    applyTrayIcon();
    applyHotkeys();
    applyMode(prefs().mode);
    setInterval(poll, POLL_MS);
  });
}
