// Preload своих окон приложения: плеер, панель главного окна, настройки.
// bundle.js кладёт результат в generated/preload-app.js.

const { contextBridge, ipcRenderer } = require('electron');

/*__CHROME_SHIM__*/

const chromeApi = makeChrome(ipcRenderer);

// shared.js и попап расширения работают с настройками и вкладкой через chrome.*.
// Имя chrome в окне уже занято встроенным объектом, его подменяет mini/chrome-alias.js.
contextBridge.exposeInMainWorld('desktopChrome', {
  storage: {
    local: chromeApi.storage.local,
    onChanged: { addListener: (fn) => chromeApi.storage.onChanged.addListener(fn) },
  },
  runtime: {
    id: chromeApi.runtime.id,
    getManifest: chromeApi.runtime.getManifest,
    getURL: chromeApi.runtime.getURL,
    sendMessage: async () => null,
  },
  // Вкладка Яндекс Музыки в приложении одна — главное окно.
  tabs: {
    query: async () => ((await ipcRenderer.invoke('yjam:music-ready')) ? [{ id: 1 }] : []),
    sendMessage: (_tabId, msg) => ipcRenderer.invoke('yjam:ask-music', msg),
  },
  // В приложении нет разрешений браузера: доступ к сайту есть всегда.
  permissions: {
    contains: async () => true,
    request: async () => true,
  },
});

contextBridge.exposeInMainWorld('desktop', {
  onStatus: (fn) => ipcRenderer.on('yjam:status', (_e, status) => fn(status)),
  control: (action) => ipcRenderer.invoke('yjam:control', action),
  seek: (position) => ipcRenderer.invoke('yjam:seek', position),
  setVolume: (level, before) => ipcRenderer.invoke('yjam:volume', level, before),
  queue: () => ipcRenderer.invoke('yjam:queue'),
  savedQueue: () => ipcRenderer.invoke('yjam:saved-queue'),
  saveQueue: (tracks, currentId) => ipcRenderer.invoke('yjam:save-queue', tracks, currentId),
  resetPlayback: () => ipcRenderer.invoke('yjam:reset-playback'),
  onPlaybackReset: (fn) => ipcRenderer.on('yjam:playback-reset', () => fn()),
  dragWindow: (on) => ipcRenderer.invoke('yjam:drag-window', on),
  playFromQueue: (index, id, albumId) => ipcRenderer.invoke('yjam:queue-play', index, id, albumId),
  setMode: (mode) => ipcRenderer.invoke('yjam:set-mode', mode),
  toggleSettings: (page) => ipcRenderer.invoke('yjam:toggle-settings', page),
  closeSettings: () => ipcRenderer.invoke('yjam:close-settings'),
  openSettings: (page) => ipcRenderer.invoke('yjam:open-settings', page),
  hideTrayPanel: () => ipcRenderer.invoke('yjam:hide-tray-panel'),
  quit: () => ipcRenderer.invoke('yjam:quit'),
  onSettingsState: (fn) => ipcRenderer.on('yjam:settings-state', (_e, state) => fn(state)),
  setToolbarAnchors: (rects) => ipcRenderer.send('yjam:toolbar-anchors', rects),
  reloadMusic: () => ipcRenderer.invoke('yjam:reload-music'),
  info: () => ipcRenderer.invoke('yjam:info'),
  setHeight: (height) => ipcRenderer.send('yjam:window-height', height),
  copy: (text) => ipcRenderer.invoke('yjam:copy', text),
  openSongPage: (track) => ipcRenderer.invoke('yjam:open-song-page', track),
  copySongPage: (track) => ipcRenderer.invoke('yjam:copy-song-page', track),
  updateState: () => ipcRenderer.invoke('yjam:update-state'),
  onUpdateState: (fn) => ipcRenderer.on('yjam:update-state', (_e, state) => fn(state)),
  installUpdate: () => ipcRenderer.invoke('yjam:update-install'),
});
