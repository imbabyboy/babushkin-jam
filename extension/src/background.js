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
const APP_TIMEOUT_MS = 800;

// Запущенное приложение принимает ссылку на 127.0.0.1. Заголовок X-YJam страницы сайтов
// без разрешения приложения не отправят — открыть так ссылку может только расширение.
async function sendToApp(url) {
  if (!(await chrome.permissions.contains({ origins: YJam.APP_ORIGINS }))) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${YJam.APP_PORT}/open?url=${encodeURIComponent(url)}`, {
      method: 'POST', headers: { 'X-YJam': '1' }, signal: AbortSignal.timeout(APP_TIMEOUT_MS),
    });
    return res.ok;
  } catch { return false; }
}

// Открылась в приложении — вкладка не нужна: новую закрываем, в старой возвращаемся назад.
// Приложение не запущено — запускаем по схеме babushkin-jam:// (браузер спросит разрешение), вкладка остаётся.
async function openInApp(url, tab, fresh) {
  if (await sendToApp(url)) {
    if (fresh) chrome.tabs.remove(tab.id).catch(() => {});
    else chrome.tabs.goBack(tab.id).catch(() => {});
    return { sent: true };
  }
  await chrome.tabs.update(tab.id, { url: YJam.appLink(url) }).catch(() => {});
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

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'yjam:relay') { relay(msg.msg).then(reply); return true; }
  if (msg.type === 'yjam:focus') { focusTab(msg.from || sender.tab).then(reply); return true; }
  if (msg.type === 'yjam:back') { goBack().then(reply); return true; }
  if (msg.type === 'yjam:claim' && sender.tab) { claim(sender.tab, !!msg.force).then(reply); return true; }
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

chrome.runtime.onInstalled.addListener(() => syncWidget());
chrome.runtime.onStartup.addListener(() => syncWidget());
// Доступ ко всем сайтам выдают только по «На всех сайтах» / «окно в окне» — значит, включаем. Попап мог
// закрыться, пока Chrome спрашивал, и сам не успел записать настройку. Доступ к 127.0.0.1 — для ссылок, не для виджета.
chrome.permissions.onAdded.addListener(({ origins = [] }) => {
  if (origins.some((o) => YJam.ALL_SITES.includes(o))) chrome.storage.local.set({ widgetEverywhere: true, widgetHidden: false });
});
chrome.permissions.onRemoved.addListener(() => syncWidget());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.widgetEverywhere) syncWidget(!!changes.widgetEverywhere.newValue);
});
