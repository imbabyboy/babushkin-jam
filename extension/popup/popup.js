const DEFAULTS = YJam.DEFAULTS;
const YM_URLS = [
  'https://*.music.yandex.ru/*',
  'https://*.music.yandex.com/*',
  'https://*.music.yandex.by/*',
  'https://*.music.yandex.kz/*',
];

const $ = (id) => document.getElementById(id);

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

function saveCommon() {
  return {
    name: $('name').value.trim() || YJam.randomName(),
    serverUrl: $('server').value.trim() || DEFAULTS.serverUrl,
  };
}

const fmt = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
};

const trackName = (t) =>
  t ? (t.artist ? t.artist + ' — ' : '') + (t.title || 'название неизвестно') : '—';

function setTrack(el, t) {
  el.replaceChildren(trackName(t));
  if (t) {
    const id = document.createElement('div');
    id.className = 'id';
    id.textContent = t.id ? `id ${t.id}` + (t.albumId ? ` · альбом ${t.albumId}` : '') : 'id не определён';
    el.appendChild(id);
  }
}

// Следующий трек из очереди комнаты: после текущего, иначе первый.
function nextInQueue(room) {
  const q = room.queue || [];
  if (!q.length) return null;
  const i = q.findIndex((t) => (t.id && room.track && t.id === room.track.id));
  return i >= 0 ? q[i + 1] || null : q[0];
}

// Что видит сервер — для отладки.
function renderServerState(st) {
  const room = st && st.state;
  $('server-state').hidden = !room;
  if (!room) return;
  const t = room.track;
  const leader = room.members.find((m) => m.id === room.leaderId);

  setTrack($('s-track'), t);
  $('s-time').textContent = t ? `${fmt(st.expectedPosition)} / ${t.duration ? fmt(t.duration) : '?'}` : '—';
  $('s-play').textContent = t ? (room.paused ? '⏸ пауза' : '▶ играет') : '—';

  const next = nextInQueue(room);
  if (next) setTrack($('s-next'), next);
  else $('s-next').textContent = (room.queue || []).length ? 'ещё не известен' : 'неизвестно (очередь пустая)';

  const p = st.player;
  if (p && p.ok && p.track) {
    const diff = p.position - st.expectedPosition;
    const same = t && (p.track.id && t.id ? p.track.id === t.id : p.track.title === t.title);
    $('s-local').textContent =
      `${p.paused ? '⏸' : '▶'} ${fmt(p.position)}` +
      (same ? ` (${diff >= 0 ? '+' : ''}${diff.toFixed(1)} с)` : ` · другой трек: ${trackName(p.track)}`);
  } else {
    $('s-local').textContent = p && p.ok ? 'ничего не играет' : 'плеер не отвечает';
  }

  const ago = Math.max(0, Math.round((Date.now() + st.clockOffset - room.updatedAt) / 1000));
  $('s-version').textContent =
    `v${room.version} · обновлено ${ago} с назад · ведущий ${leader ? leader.name : '—'}` +
    (st.rtt != null ? ` · пинг ${st.rtt} мс` : '');
}

async function refresh() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  const inRoom = !!settings.room;
  $('setup').hidden = inRoom;
  $('inroom').hidden = !inRoom;

  const st = await askTab('yjam:status');
  $('no-tab').hidden = !!st;
  if (!st) {
    $('no-tab').textContent = (await findTab())
      ? 'Перезагрузите вкладку Яндекс Музыки, чтобы расширение подключилось.'
      : 'Откройте music.yandex.ru в этом браузере.';
  }
  if (!inRoom) return;

  $('room-code').textContent = settings.room;
  const connText = {
    open: st && st.isLeader ? 'подключено · вы ведущий' : 'подключено · вы ведомый',
    connecting: 'подключаюсь…',
    reconnecting: 'нет связи, переподключаюсь…',
    off: 'не подключено',
  };
  $('conn').textContent = st ? connText[st.conn] || st.conn : '';

  const room = st && st.state;
  $('track').textContent = room && !room.track ? 'Ничего не играет. Включите трек — станете ведущим.' : '';
  renderServerState(st);

  const ul = $('members');
  ul.replaceChildren();
  for (const m of (room && room.members) || []) {
    const li = document.createElement('li');
    li.textContent = m.name + (m.id === room.leaderId ? ' 👑' : '') + (m.id === st.clientId ? ' (вы)' : '');
    ul.appendChild(li);
  }

  const warn = st && (st.autoplayBlocked ? 'Кликните на плашку джема на странице, чтобы включить звук.' : st.warning);
  $('warning').hidden = !warn;
  $('warning').textContent = warn || '';
}

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

$('resync').onclick = () => askTab('yjam:resync');

$('copy').onclick = () => navigator.clipboard.writeText(YJam.inviteLink($('room-code').textContent));

$('diag').onclick = async () => {
  const d = await askTab('yjam:diag');
  await navigator.clipboard.writeText(JSON.stringify(d || { error: 'нет вкладки Яндекс Музыки' }, null, 2));
  $('diag-ok').hidden = false;
  setTimeout(() => ($('diag-ok').hidden = true), 1500);
};

(async () => {
  const s = await YJam.ensureSettings();
  $('name').value = s.name;
  $('server').value = s.serverUrl;
  refresh();
  setInterval(refresh, 1000);
})();
