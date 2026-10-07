// Попап по макету «Babushkin Jam UI»: лобби (имя, «Создать комнату», сервер в одну строку, вход по коду)
// и комната (ссылка, участники, трек). Синхронизация и диагностика — в меню под гаечным ключом.
// Логики джема здесь нет: попап пишет настройки в chrome.storage.local и спрашивает статус у вкладки.

const DEFAULTS = YJam.DEFAULTS;
const YM_URLS = [
  'https://*.music.yandex.ru/*',
  'https://*.music.yandex.com/*',
  'https://*.music.yandex.by/*',
  'https://*.music.yandex.kz/*',
];
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PAUSE = '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>';
const ICON_PLAY = '<path d="M7 5l12 7-12 7z"/>';
const ICON_CROWN = '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>';

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

async function askTab(type) {
  const tab = await findTab();
  if (!tab) return null;
  try { return await chrome.tabs.sendMessage(tab.id, { type }); }
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

function memberRow(m, i, room, clientId) {
  const li = document.createElement('li');
  li.className = 'member';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.style.background = YJam.avatarColor(i);
  avatar.textContent = YJam.initial(m.name);

  const name = document.createElement('div');
  name.className = 'member-name';
  const n = document.createElement('span');
  n.textContent = m.name;
  name.appendChild(n);
  if (m.id === clientId) {
    const you = document.createElement('span');
    you.className = 'you';
    you.textContent = 'вы';
    name.appendChild(you);
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

function renderRoom(settings, st) {
  $('room-code').textContent = settings.room;
  $('invite-link').textContent = YJam.inviteLink(settings.room).replace(/^https:\/\//, '');

  const [kind, text] = roleLine(st);
  setStatus($('room-dot'), $('role'), kind, text);

  const room = st && st.state;
  const members = (room && room.members) || [];
  $('people-title').textContent = `В комнате · ${members.length || '—'}`;
  $('members').replaceChildren(...members.map((m, i) => memberRow(m, i, room, st.clientId)));
  $('alone').hidden = members.length !== 1;

  const t = room && room.track;
  $('now').hidden = !t;
  if (t) {
    $('now-icon').innerHTML = room.paused ? ICON_PAUSE : ICON_PLAY;
    $('now-text').textContent = (t.artist ? t.artist + ' — ' : '') + (t.title || 'название неизвестно');
  }
}

async function noTabText() {
  return (await findTab())
    ? 'Перезагрузите вкладку Яндекс Музыки, чтобы расширение подключилось.'
    : 'Откройте music.yandex.ru в этом браузере.';
}

async function refresh() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  const inRoom = !!settings.room;
  $('setup').hidden = inRoom;
  $('inroom').hidden = !inRoom;
  $('head-lobby').hidden = inRoom;
  $('head-room').hidden = !inRoom;

  const st = await askTab('yjam:status');
  renderMenu(settings, st);

  const warn = !st
    ? await noTabText()
    : st.autoplayBlocked
      ? 'Кликните по плашке «Джем» на странице, чтобы включить звук.'
      : st.warning;

  if (!inRoom) {
    $('no-tab-lobby').hidden = !!st;
    $('no-tab-lobby').textContent = st ? '' : warn;
    if ($('server-box').hidden) renderServerLine();
    return;
  }
  renderRoom(settings, st);
  $('warning').hidden = !warn;
  $('warning').textContent = warn || '';
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
