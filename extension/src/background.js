// Фоновый скрипт: виджет на других сайтах, джем-вкладка, ссылки в приложение.
// 1. Пересылает запросы виджета (remote.js) во вкладку Яндекс Музыки — там живёт джем (content.js).
// 2. Включает/выключает виджет на всех сайтах: remote.js зарегистрирован, только пока включена
//    настройка widgetEverywhere и выдано необязательное разрешение на все сайты.
//    Разрешение, раз выданное, НЕ снимаем (chrome.permissions.remove): Chrome при этом отбирает
//    и доступ к Яндекс Музыке из host_permissions — попап перестаёт видеть её вкладку.
//    Выключить — значит widgetEverywhere: false. Отозвать разрешение может только сам пользователь
//    в chrome://extensions — тогда выключаем и настройку.
// 3. Помнит джем-вкладку: в комнате участвует одна вкладка Яндекс Музыки, а не каждая открытая.
// 4. Отдаёт ссылки на Яндекс Музыку приложению babushkin-jam, если так выбрано в настройках.

importScripts('shared.js');

const SCRIPT_ID = 'yjam-widget';
const WIDGET_JS = ['src/shared.js', 'src/overlay.js', 'src/remote.js'];

// ---------- джем-вкладка ----------
// Код комнаты общий на браузер, а участник — вкладка. Раньше в комнату входила каждая вкладка Музыки,
// и любая открытая ссылка добавляла участника. Теперь входит одна: та, где вошли в комнату или
// нажали «Перенести сюда». Закрыли её или ушли с Музыки — роль переходит к другой вкладке Музыки.
// storage.session: id вкладок живут до перезапуска браузера, как и она.
const YM_RE = /^https:\/\/([^/]*\.)?music\.yandex\.(ru|com|by|kz)\//;
const isYm = (tab) => !!tab && YM_RE.test(tab.url || tab.pendingUrl || '');

async function jamTab() {
  const { jamTabId } = await chrome.storage.session.get({ jamTabId: null });
  if (jamTabId == null) return null;
  try {
    const tab = await chrome.tabs.get(jamTabId);
    return isYm(tab) ? tab : null;
  } catch { return null; } // вкладку закрыли
}

const tellTab = (tabId, jam) => chrome.tabs.sendMessage(tabId, { type: 'yjam:jam-tab', jam }).catch(() => {});

// Вкладки грузятся одновременно (восстановление после перезапуска) — заявки разбираем по одной.
let claims = Promise.resolve();
function claim(tab, force) {
  const run = async () => {
    const current = await jamTab();
    if (current && current.id !== tab.id && !force) return { jam: false };
    if (current && current.id !== tab.id) tellTab(current.id, false);
    await chrome.storage.session.set({ jamTabId: tab.id });
    return { jam: true };
  };
  claims = claims.then(run, run);
  return claims;
}

// Джем-вкладки больше нет — джем продолжает другая вкладка Музыки, если в комнате были.
async function handOver(goneId) {
  const { jamTabId } = await chrome.storage.session.get({ jamTabId: null });
  if (jamTabId !== goneId) return;
  await chrome.storage.session.remove('jamTabId');
  const { room } = await chrome.storage.local.get({ room: '' });
  if (!room) return;
  const tabs = (await chrome.tabs.query({ url: YJam.YM_URLS })).filter((t) => t.id !== goneId);
  const next = tabs.find((t) => t.active) || tabs[0];
  if (!next) return;
  await chrome.storage.session.set({ jamTabId: next.id });
  tellTab(next.id, true);
}

chrome.tabs.onRemoved.addListener((tabId) => { handOver(tabId); });
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'loading') return;
  const { jamTabId } = await chrome.storage.session.get({ jamTabId: null });
  if (tabId !== jamTabId) return;
  let tab = null;
  try { tab = await chrome.tabs.get(tabId); } catch {}
  if (!isYm(tab)) handOver(tabId);
});

// ---------- ссылки в приложение ----------
// Открывать ли ссылки на Яндекс Музыку в приложении, решает настройка приложения babushkin-jam.
// Запущенное приложение слушает 127.0.0.1 и само отвечает; его ответ помним в openLinksInApp,
// чтобы незапущенное открыть по ссылке babushkin-jam://, только если там это включено.
// Заголовок X-YJam страницы сайтов отправить не могут: приложение разрешает CORS только расширениям,
// поэтому доступ к 127.0.0.1 расширению не нужен.
const APP_TIMEOUT_MS = 800;

function askApp(path, method = 'GET') {
  return fetch(`http://127.0.0.1:${YJam.APP_PORT}${path}`, {
    method, headers: { 'X-YJam': chrome.runtime.getManifest().version }, signal: AbortSignal.timeout(APP_TIMEOUT_MS),
  });
}

// Настройка из приложения; не запущено — то, что оно говорило в последний раз.
async function appPrefs() {
  try {
    const res = await askApp('/prefs');
    if (res.ok) {
      const { openLinks } = await res.json();
      await chrome.storage.local.set({ openLinksInApp: !!openLinks });
      return { openLinks: !!openLinks, running: true };
    }
    // Приложение старше 1.7 настройки не знает: ссылки в него не отдаём.
    await chrome.storage.local.set({ openLinksInApp: false });
    return { openLinks: false, running: true };
  } catch {
    const { openLinksInApp } = await chrome.storage.local.get({ openLinksInApp: false });
    return { openLinks: openLinksInApp, running: false };
  }
}

// 'sent' — приложение открыло ссылку, 'off' — в нём это выключено, 'offline' — не запущено.
async function sendToApp(url) {
  try {
    const res = await askApp(`/link?url=${encodeURIComponent(url)}`, 'POST');
    const sent = res.status === 204;
    await chrome.storage.local.set({ openLinksInApp: sent });
    return sent ? 'sent' : 'off';
  } catch { return 'offline'; }
}

const APP_LAUNCH_WAIT_MS = 15000;
const APP_POLL_MS = 400;

// Открылась в приложении — вкладка не нужна: новую закрываем, в старой возвращаемся назад.
function leaveTab(tabId, fresh) {
  if (fresh) chrome.tabs.remove(tabId).catch(() => {});
  else chrome.tabs.goBack(tabId).catch(() => {});
}

// Ждём, пока запущенное по ссылке приложение начнёт отвечать. Браузер может сначала спросить разрешение,
// поэтому ждём с запасом (15 с — меньше 30 с, после которых Chrome может остановить service worker).
async function waitForApp() {
  const until = Date.now() + APP_LAUNCH_WAIT_MS;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, APP_POLL_MS));
    try {
      await askApp('/prefs');
      return true;
    } catch {}
  }
  return false;
}

// Приложение запустилось — вкладку убираем. Не запустилось (отказали в разрешении, приложения нет) —
// открываем страницу заново уже как обычную: links.js остановил её загрузку. #yjam-stay — больше не перехватывать.
async function finishLaunch(tabId, url, fresh) {
  if (await waitForApp()) {
    leaveTab(tabId, fresh);
    return;
  }
  try {
    await chrome.tabs.update(tabId, { url: url.replace(/#.*$/, '') + '#yjam-stay' });
    await chrome.tabs.reload(tabId); // смена только хеша страницу не перезагружает
  } catch {} // вкладку уже закрыли
}

// Приложение не запущено, но ссылки в нём включены — запускаем по схеме babushkin-jam://, ссылку оно
// получит при запуске. Ответ { launching } уходит сразу: links.js останавливает загрузку сайта. Живая страница
// синхронизирует плеер между устройствами аккаунта и подменяла в приложении открытый трек прошлым (26 ноября 2026).
async function openInApp(url, tab, fresh) {
  const result = await sendToApp(url);
  if (result === 'sent') {
    leaveTab(tab.id, fresh);
    return { sent: true };
  }
  if (result === 'offline') {
    const { openLinksInApp } = await chrome.storage.local.get({ openLinksInApp: false });
    if (!openLinksInApp) return { sent: false };
    try {
      await chrome.tabs.update(tab.id, { url: YJam.appLink(url) });
    } catch { return { sent: false }; }
    finishLaunch(tab.id, url, fresh);
    return { launching: true };
  }
  return { sent: false };
}

async function findTab() {
  const jam = await jamTab();
  if (jam) return jam;
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, url: YJam.YM_URLS });
  if (active) return active;
  const [any] = await chrome.tabs.query({ url: YJam.YM_URLS });
  return any || null;
}

async function relay(msg) {
  const tab = await findTab();
  if (!tab) return null;
  try { return await chrome.tabs.sendMessage(tab.id, msg); }
  catch { return null; } // вкладка открыта до установки расширения — нужна перезагрузка
}

// Переход во вкладку Яндекс Музыки из виджета на другом сайте или из попапа. Откуда пришли —
// запоминаем в storage.returnTo: виджет на Яндекс Музыке покажет под собой «Назад на <сайт>».
async function focusTab(from) {
  const tab = await findTab();
  if (!tab) return false;
  if (from && from.id !== tab.id) {
    await chrome.storage.local.set({ returnTo: { tabId: from.id, windowId: from.windowId, ymTabId: tab.id, host: siteName(from.url) } });
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return true;
}

function siteName(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : '';
  } catch { return ''; }
}

async function goBack() {
  const { returnTo } = await chrome.storage.local.get({ returnTo: null });
  await chrome.storage.local.remove('returnTo');
  if (!returnTo) return false;
  try {
    await chrome.tabs.update(returnTo.tabId, { active: true });
    await chrome.windows.update(returnTo.windowId, { focused: true });
    return true;
  } catch { return false; } // вкладку уже закрыли
}

// «Назад» нужен, только пока пользователь во вкладке Музыки, куда его привели: ушёл сам на другую
// вкладку или закрыл ту, куда возвращаться, — кнопку убираем.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const { returnTo } = await chrome.storage.local.get({ returnTo: null });
  if (returnTo && tabId !== returnTo.ymTabId) chrome.storage.local.remove('returnTo');
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { returnTo } = await chrome.storage.local.get({ returnTo: null });
  if (returnTo && (tabId === returnTo.tabId || tabId === returnTo.ymTabId)) chrome.storage.local.remove('returnTo');
});

// Шрифт для виджета на чужом сайте: страница сама адрес chrome-extension:// не всегда может загрузить
// (YouTube), поэтому отдаём байты отсюда, в base64 — сообщения переносят только JSON.
const FONT_FILE_RE = /^[a-z-]+\.woff2$/;
async function fontBase64(file) {
  if (!FONT_FILE_RE.test(String(file))) return null;
  const res = await fetch(chrome.runtime.getURL('fonts/' + file));
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(binary) };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'yjam:font') { fontBase64(msg.file).then(reply, () => reply(null)); return true; }
  if (msg.type === 'yjam:relay') { relay(msg.msg).then(reply); return true; }
  if (msg.type === 'yjam:focus') { focusTab(msg.from || sender.tab).then(reply); return true; }
  if (msg.type === 'yjam:back') { goBack().then(reply); return true; }
  if (msg.type === 'yjam:claim' && sender.tab) { claim(sender.tab, !!msg.force).then(reply); return true; }
  if (msg.type === 'yjam:app-prefs') { appPrefs().then(reply); return true; }
  if (msg.type === 'yjam:open-in-app' && sender.tab && YM_RE.test(msg.url || '')) {
    openInApp(msg.url, sender.tab, !!msg.fresh).then(reply);
    return true;
  }
});

// inject — ещё и в уже открытые вкладки, чтобы виджет появился без перезагрузки.
async function syncWidget(inject = false) {
  const granted = await chrome.permissions.contains({ origins: YJam.ALL_SITES });
  const { widgetEverywhere } = await chrome.storage.local.get({ widgetEverywhere: false });
  if (!granted && widgetEverywhere) await chrome.storage.local.set({ widgetEverywhere: false });
  const on = granted && widgetEverywhere;
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  try { // два вызова подряд (настройка + разрешение) могут столкнуться — второй просто не нужен
    if (on && !registered.length) {
      await chrome.scripting.registerContentScripts([{
        id: SCRIPT_ID, matches: YJam.ALL_SITES, excludeMatches: YJam.YM_URLS, js: WIDGET_JS, runAt: 'document_idle',
      }]);
    } else if (!on && registered.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
  } catch (e) {}
  if (!on || !inject) return;
  const ym = new Set((await chrome.tabs.query({ url: YJam.YM_URLS })).map((t) => t.id));
  for (const tab of await chrome.tabs.query({ url: YJam.ALL_SITES })) {
    if (ym.has(tab.id)) continue;
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: WIDGET_JS }).catch(() => {});
  }
}

// Заодно приложение узнаёт, что расширение установлено, и показывает свою настройку ссылок.
chrome.runtime.onInstalled.addListener(() => { syncWidget(); appPrefs(); });
chrome.runtime.onStartup.addListener(() => { syncWidget(); appPrefs(); });
// Доступ ко всем сайтам выдают только по «На всех сайтах» / «окно в окне» — значит, включаем. Попап мог
// закрыться, пока Chrome спрашивал, и сам не успел записать настройку. Доступ к 127.0.0.1 — для ссылок, не для виджета.
chrome.permissions.onAdded.addListener(({ origins = [] }) => {
  if (origins.some((o) => YJam.ALL_SITES.includes(o))) chrome.storage.local.set({ widgetEverywhere: true, widgetHidden: false });
});
chrome.permissions.onRemoved.addListener(() => syncWidget());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.widgetEverywhere) syncWidget(!!changes.widgetEverywhere.newValue);
});
