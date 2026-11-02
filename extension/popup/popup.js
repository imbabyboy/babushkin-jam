// Попап по макету «Babushkin Jam UI»: лобби (имя, «Создать комнату», сервер в одну строку, вход по коду)
// и комната (ссылка, участники, трек с кнопками плеера). Синхронизация и диагностика — в меню под
// гаечным ключом; глаз — показать/убрать виджет; шестерёнка — настройки (имя, где показывать виджет).
// Логики джема здесь нет: попап пишет настройки в chrome.storage.local и спрашивает статус у вкладки.

const DEFAULTS = YJam.DEFAULTS;
const YM_URLS = YJam.YM_URLS;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PAUSE = '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>';
const ICON_PLAY = '<path d="M7 5l12 7-12 7z"/>';
const ICON_OPEN = '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>';
const ICON_CROWN = '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>';
const ICON_EDIT = '<path d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z"/><path d="M14 8l2 2"/>';
const ICON_CHECK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
const ICON_CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>';

const $ = (id) => document.getElementById(id);

YJam.loadFonts();
$('badge').hidden = !YJam.IS_LOCAL;
$('server').placeholder = DEFAULTS.serverUrl;

async function findTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true, url: YM_URLS });
  if (active) return active;
  const [any] = await chrome.tabs.query({ url: YM_URLS });
  return any || null;
}

async function askTab(type, extra) {
  const tab = await findTab();
  if (!tab) return null;
  try { return await chrome.tabs.sendMessage(tab.id, { type, ...extra }); }
  catch { return null; } // вкладка открыта до установки расширения — нужна перезагрузка
}

const serverValue = () => $('server').value.trim() || DEFAULTS.serverUrl;

function saveCommon() {
  return {
    name: $('name').value.trim() || YJam.randomName(),
    serverUrl: serverValue(),
  };
}

// Короткая подпись временной надписи: показать на ms и вернуть исходную.
function flash(el, text, ms = 1000) {
  clearTimeout(el._flash);
  if (el._orig == null) el._orig = el.textContent;
  el.textContent = text;
  el._flash = setTimeout(() => { el.textContent = el._orig; el._orig = null; }, ms);
}

function setStatus(dot, textEl, kind, text) {
  dot.className = 'dot' + (kind ? ' ' + kind : '');
  textEl.textContent = text;
}

// ---------- сервер в лобби: одна строка со статусом, по клику — поле ----------
// Статус проверяем пробным WebSocket: открылся — на связи. Результат кэшируем по адресу.
const probes = new Map(); // url -> 'wait' | 'ok' | 'bad'

function probe(url) {
  if (probes.has(url)) return;
  probes.set(url, 'wait');
  let ws;
  const done = (res) => {
    if (probes.get(url) !== 'wait') return;
    probes.set(url, res);
    try { ws.close(); } catch (e) {}
    renderServerLine();
  };
  try { ws = new WebSocket(url); } catch (e) { done('bad'); return; }
  ws.onopen = () => done('ok');
  ws.onerror = () => done('bad');
  setTimeout(() => done('bad'), 4000);
}

function renderServerLine() {
  const url = serverValue();
  probe(url);
  const res = probes.get(url);
  const who = url === DEFAULTS.serverUrl ? 'Общий сервер' : 'Свой сервер';
  const text = { wait: 'проверяю…', ok: 'на связи', bad: 'нет связи' }[res];
  setStatus($('srv-dot'), $('srv-text'), res === 'wait' ? '' : res, `${who} · ${text}`);
}

function showServer(open) {
  $('server-box').hidden = !open;
  $('server-line').hidden = open;
  if (open) $('server').focus();
  else renderServerLine();
}

$('server-show').onclick = () => showServer(true);
$('server-hide').onclick = () => showServer(false);

// ---------- меню под ключом ----------
function setMenu(open) {
  // шапка в лобби и в комнате разной высоты — меню ставим прямо под кнопкой
  const t = $('tools');
  $('menu').style.top = `${t.offsetTop + t.offsetHeight + 6}px`;
  $('menu').hidden = !open;
  $('tools').setAttribute('aria-expanded', String(open));
}

$('tools').onclick = (e) => { e.stopPropagation(); setMenu($('menu').hidden); };
document.addEventListener('click', (e) => { if (!$('menu').hidden && !$('menu').contains(e.target)) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

const shortHost = (url) => {
  try {
    const u = new URL(url);
    return u.hostname.split('.').slice(-2).join('.') + (u.port ? ':' + u.port : '');
  } catch (e) { return url; }
};

function renderMenu(settings, st) {
  $('resync').hidden = !settings.room;
  $('m-server').textContent = shortHost(settings.serverUrl);
  $('m-server').title = settings.serverUrl;
  $('m-ping').textContent = st && st.rtt != null ? `${st.rtt} мс` : '—';
  const room = st && st.state;
  $('m-version').textContent = room ? `v${room.version}` : '—';

  // Расхождение своего плеера с комнатой, если играет тот же трек.
  const p = st && st.player;
  const t = room && room.track;
  let drift = '—';
  if (p && p.ok && p.track && t) {
    const same = p.track.id && t.id ? p.track.id === t.id : p.track.title === t.title;
    const d = p.position - st.expectedPosition;
    drift = same ? `${d >= 0 ? '+' : ''}${d.toFixed(1)} с` : 'другой трек';
  }
  $('m-drift').textContent = drift;
}

// ---------- комната ----------
function svg(markup, cls) {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('aria-hidden', 'true');
  if (cls) el.setAttribute('class', cls);
  el.innerHTML = markup;
  return el;
}

function iconButton(cls, title, icon, onclick) {
  const b = document.createElement('button');
  b.className = cls;
  b.title = title;
  b.appendChild(svg(icon));
  b.onclick = onclick;
  return b;
}

// Своё имя правится прямо в списке: карандаш при наведении → поле с галочкой и крестиком.
// Пока поле открыто, список не перерисовываем — иначе оно пропадёт из-под курсора.
let renaming = false;
let lastRoom = null;

function startRename() {
  renaming = true;
  renderMembers(lastRoom.room, lastRoom.clientId);
  $('rename').focus();
  $('rename').select();
}

async function finishRename(save) {
  if (!renaming) return;
  const input = $('rename');
  const name = input.value.trim();
  renaming = false;
  if (save && name && name !== input.defaultValue) await saveName(name);
  renderMembers(lastRoom.room, lastRoom.clientId);
}

// Поле правки имени с галочкой и крестиком; done(save) — Enter/галочка или Esc/крестик.
function renameForm(id, value, done) {
  const input = document.createElement('input');
  input.id = id;
  input.className = 'input';
  input.maxLength = 40;
  input.autocomplete = 'off';
  input.placeholder = 'Гость';
  input.defaultValue = value;
  input.onkeydown = (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') done(true);
    else if (e.key === 'Escape') { e.stopPropagation(); done(false); }
  };
  const form = document.createElement('div');
  form.className = 'rename';
  form.append(input,
    iconButton('rename-btn ok', 'Сохранить', ICON_CHECK, () => done(true)),
    iconButton('rename-btn', 'Отмена', ICON_CLOSE, () => done(false)));
  return form;
}

async function saveName(name) {
  $('name').value = name;
  await chrome.storage.local.set({ name });
  setTimeout(refresh, 300); // дождаться нового имени от сервера
}

function memberRow(m, i, room, clientId) {
  const li = document.createElement('li');
  li.className = 'member';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.style.background = YJam.avatarColor(i);
  avatar.textContent = YJam.initial(m.name);

  if (m.id === clientId && renaming) {
    li.append(avatar, renameForm('rename', m.name, finishRename));
    return li;
  }

  const name = document.createElement('div');
  name.className = 'member-name';
  const n = document.createElement('span');
  n.textContent = m.name;
  name.appendChild(n);
  if (m.id === clientId) {
    const you = document.createElement('span');
    you.className = 'you';
    you.textContent = 'вы';
    name.append(you, iconButton('edit', 'Изменить имя', ICON_EDIT, startRename));
  }

  li.append(avatar, name);
  if (m.id === room.leaderId) {
    const host = document.createElement('div');
    host.className = 'host';
    host.append(svg(ICON_CROWN), 'ведущий');
    li.appendChild(host);
  }
  return li;
}

function roleLine(st) {
  if (!st) return ['', 'нет вкладки Яндекс Музыки'];
  const room = st.state;
  if (st.conn === 'open' && room) {
    if (st.isLeader) return ['ok', 'подключено · вы ведущий'];
    const leader = room.members.find((m) => m.id === room.leaderId);
    return ['ok', 'подключено · ведущий ' + (leader ? leader.name : '—')];
  }
  if (st.conn === 'connecting') return ['', 'подключаюсь…'];
  return ['bad', 'нет связи, переподключаюсь…'];
}

function renderMembers(room, clientId) {
  lastRoom = { room, clientId };
  const members = (room && room.members) || [];
  $('members').replaceChildren(...members.map((m, i) => memberRow(m, i, room, clientId)));
  $('alone').hidden = members.length !== 1;
}

function renderRoom(settings, st) {
  $('room-code').textContent = settings.room;
  $('invite-link').textContent = YJam.inviteLink(settings.room).replace(/^https:\/\//, '');

  const [kind, text] = roleLine(st);
  setStatus($('room-dot'), $('role'), kind, text);

  const room = st && st.state;
  const members = (room && room.members) || [];
  $('people-title').textContent = `В комнате · ${members.length || '—'}`;
  if (!room) renaming = false;
  if (!renaming) renderMembers(room, st && st.clientId);
}

// Плашка трека с кнопками плеера: в комнате — трек комнаты, в лобби — что играет во вкладке.
function renderNow(inRoom, st, settings) {
  const now = $('now');
  const anchor = inRoom ? $('warning') : $('no-tab-lobby');
  if (now.nextElementSibling !== anchor) anchor.before(now);

  const room = inRoom && st && st.state;
  const p = st && st.player && st.player.ok ? st.player : null;
  const t = (room && room.track) || (p && p.track);
  now.hidden = !st || !t;
  if (now.hidden) return;
  $('now-text').textContent = (t.artist ? t.artist + ' — ' : '') + (t.title || 'название неизвестно');
  const paused = p ? p.paused : room.paused;
  $('now-icon').innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
  // пока плей ни разу не нажимали на самой Яндекс Музыке, отсюда её не включить —
  // вместо «плей» кнопка «перейти во вкладку»
  const locked = paused && st.canPlay === false;
  $('toggle').classList.toggle('open', locked);
  if (locked) $('now-icon').innerHTML = ICON_OPEN;
  const pip = settings.widgetEverywhere && !settings.widgetHidden;
  $('pip').setAttribute('aria-pressed', String(pip));
  $('toggle').title = locked ? 'Открыть Яндекс Музыку: первый раз включите плей там' : paused ? 'Играть' : 'Пауза';
}

$('now').onclick = async (e) => {
  const b = e.target.closest('.ctrl');
  if (!b) return;
  if (b.classList.contains('open')) {
    // через фон: он запомнит вкладку, откуда пришли, для кнопки «Назад» под виджетом
    const [from] = await chrome.tabs.query({ active: true, currentWindow: true });
    try { await chrome.runtime.sendMessage({ type: 'yjam:focus', from }); } catch (e) {}
    window.close();
    return;
  }
  if (b.dataset.action === 'toggle') { // сразу показать результат, не дожидаясь опроса
    const play = $('toggle').title === 'Играть';
    $('now-icon').innerHTML = play ? ICON_PAUSE : ICON_PLAY;
    $('toggle').title = play ? 'Пауза' : 'Играть';
  }
  await askTab('yjam:control', { action: b.dataset.action });
  setTimeout(refresh, 400);
};

// «Окно в окне» на плашке трека — то же, что «Где показывать виджет» в настройках.
$('pip').onclick = async () => {
  if ($('pip').getAttribute('aria-pressed') === 'true') await widgetOnYmOnly();
  else await widgetEverywhere();
};

// ---------- виджет и настройки ----------
let view = 'main'; // main | settings

function setView(v) {
  view = v;
  $('settings-btn').setAttribute('aria-pressed', String(v === 'settings'));
  sRenaming = false;
  refresh();
}

$('settings-btn').onclick = () => setView(view === 'settings' ? 'main' : 'settings');
$('settings-done').onclick = () => setView('main');

$('widget').onclick = async () => {
  const { widgetHidden } = await chrome.storage.local.get({ widgetHidden: false });
  await chrome.storage.local.set({ widgetHidden: !widgetHidden });
  refresh();
};

function renderWidgetButton(hidden) {
  $('widget').classList.toggle('off', hidden);
  $('widget').title = hidden ? 'Показать виджет' : 'Убрать виджет';
}

// Имя в настройках — как в списке участников: карандаш → поле с галочкой и крестиком.
let sRenaming = false;

function renderSettingsName(name) {
  if (sRenaming) return;
  const text = document.createElement('span');
  text.textContent = name;
  $('s-name').replaceChildren(text, iconButton('edit', 'Изменить имя', ICON_EDIT, () => {
    sRenaming = true;
    $('s-name').replaceChildren(renameForm('s-rename', name, finishSettingsRename));
    $('s-rename').focus();
    $('s-rename').select();
  }));
}

async function finishSettingsRename(save) {
  if (!sRenaming) return;
  const input = $('s-rename');
  const name = input.value.trim();
  sRenaming = false;
  const changed = save && name && name !== input.defaultValue;
  if (changed) await saveName(name);
  renderSettingsName(changed ? name : input.defaultValue);
}

// «На всех сайтах» — необязательное разрешение на все сайты. Его выдачу/отзыв ловит background.js:
// регистрирует виджет для всех сайтов или снимает (попап может закрыться, пока Chrome спрашивает).
// Разрешение спрашиваем один раз и потом не снимаем (почему — в background.js); выключение — просто настройка.
async function widgetEverywhere() {
  try {
    if (await chrome.permissions.request({ origins: YJam.ALL_SITES })) {
      await chrome.storage.local.set({ widgetEverywhere: true, widgetHidden: false });
    }
  } catch (e) {}
  refresh();
}
async function widgetOnYmOnly() {
  await chrome.storage.local.set({ widgetEverywhere: false });
  refresh();
}
$('w-all').onclick = widgetEverywhere;
$('w-ym').onclick = widgetOnYmOnly;

async function renderSettings(settings) {
  renderSettingsName(settings.name);
  const all = settings.widgetEverywhere && await chrome.permissions.contains({ origins: YJam.ALL_SITES });
  $('w-ym').setAttribute('aria-checked', String(!all));
  $('w-all').setAttribute('aria-checked', String(all));
  $('w-hint').textContent = all
    ? 'Виджет есть на любом сайте. Музыка играет во вкладке Яндекс Музыки — не закрывайте её.'
    : 'Для «На всех сайтах» Chrome спросит доступ ко всем сайтам — только чтобы показать там виджет.';
}

// Доступ к Яндекс Музыке мог пропасть: старая версия снимала разрешение на все сайты,
// и Chrome отбирал вместе с ним и его. Без доступа вкладку не найти — просим вернуть.
const NO_ACCESS = 'Нет доступа к Яндекс Музыке. Нажмите здесь и разрешите, потом перезагрузите её вкладку.';
async function noTabText() {
  if (!(await chrome.permissions.contains({ origins: YM_URLS }))) return NO_ACCESS;
  return (await findTab())
    ? 'Перезагрузите вкладку Яндекс Музыки, чтобы расширение подключилось.'
    : 'Откройте Яндекс Музыку (music.yandex.ru или music.yandex.com) в этом браузере.';
}

for (const id of ['warning', 'no-tab-lobby']) {
  $(id).onclick = async () => {
    if ($(id).textContent !== NO_ACCESS) return;
    try { await chrome.permissions.request({ origins: YM_URLS }); } catch (e) {}
    refresh();
  };
}

async function refresh() {
  const settings = await chrome.storage.local.get({ ...DEFAULTS, widgetHidden: false, widgetEverywhere: false });
  const inRoom = !!settings.room;
  const inSettings = view === 'settings';
  $('setup').hidden = inRoom || inSettings;
  $('inroom').hidden = !inRoom || inSettings;
  $('settings').hidden = !inSettings;
  $('head-lobby').hidden = inRoom || inSettings;
  $('head-room').hidden = !inRoom || inSettings;
  $('head-settings').hidden = !inSettings;
  renderWidgetButton(settings.widgetHidden);

  const st = await askTab('yjam:status');
  renderMenu(settings, st);
  if (inSettings) { await renderSettings(settings); return; }
  renderNow(inRoom, st, settings);

  const warn = !st
    ? await noTabText()
    : st.autoplayBlocked
      ? 'Chrome не включает звук, пока на странице Яндекс Музыки ни разу не кликнули. Кликните там в любом месте — дальше кнопки будут работать.'
      : st.warning;

  if (!inRoom) {
    renaming = false;
    const lobbyWarn = !st || st.autoplayBlocked ? warn : '';
    $('no-tab-lobby').hidden = !lobbyWarn;
    $('no-tab-lobby').textContent = lobbyWarn;
    $('no-tab-lobby').classList.toggle('action', lobbyWarn === NO_ACCESS);
    if ($('server-box').hidden) renderServerLine();
    return;
  }
  renderRoom(settings, st);
  $('warning').hidden = !warn;
  $('warning').textContent = warn || '';
  $('warning').classList.toggle('action', warn === NO_ACCESS);
}

// ---------- действия ----------
$('create').onclick = async () => {
  await chrome.storage.local.set({ ...saveCommon(), room: YJam.randomCode() });
  refresh();
};

$('join').onclick = async () => {
  const code = YJam.normalizeCode($('code').value);
  if (!code) return $('code').focus();
  await chrome.storage.local.set({ ...saveCommon(), room: code });
  refresh();
};

$('code').onkeydown = (e) => { if (e.key === 'Enter') $('join').click(); };

$('leave').onclick = async () => {
  await chrome.storage.local.set({ room: '' });
  refresh();
};

let copiedTimer = null;
$('copy').onclick = async () => {
  await navigator.clipboard.writeText(YJam.inviteLink($('room-code').textContent));
  $('copy').classList.add('done');
  $('copy-label').textContent = 'Ссылка скопирована';
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    $('copy').classList.remove('done');
    $('copy-label').textContent = 'Скопировать ссылку';
  }, 1000);
};

$('resync').onclick = async () => {
  await askTab('yjam:resync');
  flash($('resync-label'), 'Готово');
};

$('diag').onclick = async () => {
  const d = await askTab('yjam:diag');
  await navigator.clipboard.writeText(JSON.stringify(d || { error: 'нет вкладки Яндекс Музыки' }, null, 2));
  flash($('diag-label'), 'Скопировано');
};

(async () => {
  const s = await YJam.ensureSettings();
  $('name').value = s.name;
  // пустое поле — общий сервер, поэтому адрес по умолчанию в поле не пишем
  const custom = s.serverUrl && s.serverUrl !== DEFAULTS.serverUrl;
  $('server').value = custom ? s.serverUrl : '';
  showServer(false);
  refresh();
  setInterval(refresh, 1000);
})();
