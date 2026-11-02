// Фоновый скрипт: виджет на других сайтах.
// 1. Пересылает запросы виджета (remote.js) во вкладку Яндекс Музыки — там живёт джем (content.js).
// 2. Включает/выключает виджет на всех сайтах: remote.js зарегистрирован, только пока включена
//    настройка widgetEverywhere и выдано необязательное разрешение на все сайты.
//    Разрешение, раз выданное, НЕ снимаем (chrome.permissions.remove): Chrome при этом отбирает
//    и доступ к Яндекс Музыке из host_permissions — попап перестаёт видеть её вкладку.
//    Выключить — значит widgetEverywhere: false. Отозвать разрешение может только сам пользователь
//    в chrome://extensions — тогда выключаем и настройку.

importScripts('shared.js');

const SCRIPT_ID = 'yjam-widget';
const WIDGET_JS = ['src/shared.js', 'src/overlay.js', 'src/remote.js'];

async function findTab() {
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
// разрешение выдают только по «На всех сайтах» / «окно в окне» — значит, включаем. Попап мог
// закрыться, пока Chrome спрашивал, и сам не успел записать настройку.
chrome.permissions.onAdded.addListener(() => chrome.storage.local.set({ widgetEverywhere: true, widgetHidden: false }));
chrome.permissions.onRemoved.addListener(() => syncWidget());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.widgetEverywhere) syncWidget(!!changes.widgetEverywhere.newValue);
});
