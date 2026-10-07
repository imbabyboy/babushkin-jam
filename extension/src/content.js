// Логика джема: соединение с сервером, комната, защита от эха, подстройка плеера.
// Плеером управляет page.js (мир страницы), общение через window.postMessage.
// Настройки (сервер, имя, комната) лежат в chrome.storage.local, их меняют панель на странице и попап.

(() => {
  const DEFAULTS = YJam.DEFAULTS;
  const DRIFT_SEC = 2;            // расхождение, после которого перематываем
  const HEARTBEAT_MS = 5000;      // ведущий шлёт позицию
  const FOLLOW_CHECK_MS = 3000;   // ведомый сверяется с комнатой
  const ECHO_MS = 1500;           // сколько живёт ожидание своего события
  const SWITCH_MS = 90000;        // предел на включение трека (с перелистыванием альбома)
  const SETTLE_MS = 1500;         // после смены трека события паузы/перемотки — не от человека
  const MAX_SWITCH_ATTEMPTS = 3;

  let settings = { ...DEFAULTS };
  let ws = null;
  let conn = 'off';               // off | connecting | open | reconnecting
  let clientId = null;
  let room = null;                // последнее состояние комнаты от сервера
  let version = -1;
  let lastStateAt = 0;
  let lastChangeAt = 0;            // последнее изменение комнаты, кроме pos/queue
  let clockOffset = 0;            // serverTime ≈ Date.now() + clockOffset
  let bestRtt = Infinity;
  let reconnectTimer = null;
  let backoff = 1000;
  let warning = '';
  let autoplayBlocked = false;

  // ---------- мост к page.js ----------
  let seq = 0;
  const replies = new Map();

  function pageCall(cmd, args, timeoutMs = 12000) {
    return new Promise((resolve) => {
      const id = ++seq;
      replies.set(id, resolve);
      window.postMessage({ source: 'yjam-cs', id, cmd, args }, location.origin);
      setTimeout(() => {
        if (replies.delete(id)) resolve({ ok: false, error: 'timeout' });
      }, timeoutMs);
    });
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.source !== 'yjam-page') return;
    if (d.type === 'reply') {
      const r = replies.get(d.id);
      if (r) { replies.delete(d.id); r(d.result); }
      return;
    }
    onPlayerEvent(d);
  });

  // ---------- утилиты ----------
  const norm = (s) => (s || '').trim().toLowerCase();

  function sameTrack(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id) return String(a.id) === String(b.id);
    return norm(a.title) === norm(b.title) && norm(a.artist) === norm(b.artist);
  }

  const serverNow = () => Date.now() + clockOffset;
  const isLeader = () => !!room && room.leaderId === clientId;

  function expectedPosition(st) {
    if (!st.track) return 0;
    if (st.paused) return st.position;
    const pos = st.position + (serverNow() - st.updatedAt) / 1000;
    return st.track.duration ? Math.min(pos, st.track.duration) : pos;
  }

  function setWarning(text) {
    if (warning === text) return;
    warning = text;
    render();
  }

  // ---------- защита от эха ----------
  // Перед командой сервера запоминаем, какого события ждём, и не отправляем его обратно.
  // multi: ожидание гасит все такие события до истечения (перемотка может дать несколько seeked).
  const expects = [];

  function expect(type, ms = ECHO_MS, multi = false) {
    const e = { type, until: Date.now() + ms, multi };
    expects.push(e);
    return e;
  }

  function consume(type) {
    const now = Date.now();
    for (let i = expects.length - 1; i >= 0; i--) if (expects[i].until < now) expects.splice(i, 1);
    const i = expects.findIndex((e) => e.type === type);
    if (i < 0) return false;
    if (!expects[i].multi) expects.splice(i, 1);
    return true;
  }

  const hasPendingExpects = () => expects.some((e) => e.until > Date.now());

  // ---------- сервер ----------
  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function disconnect() {
    clearTimeout(reconnectTimer);
    if (ws) { const s = ws; ws = null; s.close(); }
    room = null;
    version = -1;
    clientId = null;
    conn = 'off';
  }

  function connect() {
    disconnect();
    warning = '';
    if (!settings.room || !settings.serverUrl) { render(); return; }
    conn = 'connecting';
    render();
    let sock;
    try { sock = new WebSocket(settings.serverUrl); }
    catch (e) { conn = 'off'; setWarning('Неверный адрес сервера'); return; }
    ws = sock;
    bestRtt = Infinity;

    sock.onopen = () => {
      if (ws !== sock) return;
      backoff = 1000;
      conn = 'open';
      send({ t: 'join', room: settings.room, name: settings.name || 'Гость' });
      for (let i = 0; i < 5; i++) setTimeout(ping, i * 250);
      render();
    };
    sock.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      onServer(m);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      room = null;
      version = -1;
      clientId = null;
      conn = 'reconnecting';
      render();
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 15000);
    };
  }

  function ping() { send({ t: 'ping', c: Date.now() }); }
  setInterval(() => { if (conn === 'open') ping(); }, 25000);

  function onServer(m) {
    switch (m.t) {
      case 'welcome':
        clientId = m.clientId;
        break;
      case 'pong': {
        const now = Date.now();
        const rtt = now - m.c;
        if (rtt < bestRtt) { bestRtt = rtt; clockOffset = m.s + rtt / 2 - now; }
        break;
      }
      case 'state':
        onState(m);
        break;
      case 'error':
        setWarning(m.message);
        break;
    }
  }

  function onState(m) {
    if (m.state.version <= version) return; // применяем только версию новее своей
    version = m.state.version;
    room = m.state;
    lastStateAt = Date.now();
    if (!m.cause || !['pos', 'queue'].includes(m.cause.type)) lastChangeAt = lastStateAt;
    render();
    const mine = m.cause && m.cause.by === clientId;
    if (mine && m.cause.type === 'join') {
      // Один в комнате (например, после перезагрузки) — комната подстраивается под нас,
      // а не наоборот: не включаем трек, оставшийся с прошлой сессии.
      if (room.track && room.members.length > 1) resync(); else seedRoom();
    } else if (!mine) {
      resync();
    }
  }

  // Комната пустая, а у нас что-то играет — становимся ведущим.
  async function seedRoom() {
    const s = await pageCall('state');
    if (s.ok && s.track) send({ t: 'track', track: s.track, position: s.position, paused: s.paused });
  }

  // ---------- события плеера (от человека или нет) ----------
  let lastEndedAt = 0;
  let settleUntil = 0;
  let playPauseTimer = null;
  let seekTimer = null;

  function onPlayerEvent(ev) {
    switch (ev.type) {
      case 'ended':
        lastEndedAt = Date.now();
        break;
      case 'track':
        onTrackChange(ev);
        break;
      case 'play':
      case 'pause':
        onPlayPause(ev);
        break;
      case 'seek':
        onSeek();
        break;
      case 'autoplay-blocked':
        if (room) { autoplayBlocked = true; render(); }
        break;
    }
  }

  function onTrackChange(ev) {
    settleUntil = Date.now() + SETTLE_MS;
    if (!room || !ev.track) return;

    // наш собственный playTrack
    if (consume('track')) { setTimeout(resync, 800); return; }

    // трек доиграл сам: у ведущего это следующий трек комнаты, у ведомого — игнорируем,
    // комната скоро пришлёт трек ведущего
    if (Date.now() - lastEndedAt < 4000) {
      if (isLeader()) send({ t: 'track', track: ev.track, position: ev.position, paused: ev.paused, auto: true });
      return;
    }

    // человек переключил трек -> становится ведущим
    send({ t: 'track', track: ev.track, position: ev.position, paused: ev.paused });
  }

  function onPlayPause(ev) {
    if (!room || Date.now() < settleUntil) return;
    if (consume(ev.type)) return;
    // ждём чуть-чуть: пауза перед сменой трека или концом трека — не действие человека
    clearTimeout(playPauseTimer);
    playPauseTimer = setTimeout(async () => {
      if (Date.now() < settleUntil || Date.now() - lastEndedAt < 1000) return;
      const s = await pageCall('state');
      if (!s.ok || !sameTrack(s.track, room && room.track)) return;
      if (s.paused === room.paused) return;
      send({ t: 'pause', paused: s.paused, position: s.position });
    }, 300);
  }

  function onSeek() {
    if (!room || Date.now() < settleUntil) return;
    if (consume('seek')) return;
    // при перетаскивании ползунка seeked приходит пачкой — шлём последнее
    clearTimeout(seekTimer);
    seekTimer = setTimeout(async () => {
      const s = await pageCall('state');
      if (!s.ok || !sameTrack(s.track, room && room.track)) return;
      send({ t: 'seek', position: s.position });
    }, 300);
  }

  // ---------- подстройка под комнату ----------
  let syncing = false;
  let switchKey = null;
  let switchAttempts = 0;
  let switchBusyUntil = 0;

  async function resync() {
    if (!room || !room.track || syncing) return;
    syncing = true;
    try {
      const target = room.track;
      const s = await pageCall('state');
      if (!s.ok) return;
      const exp = expectedPosition(room);

      if (!sameTrack(s.track, target)) {
        // трек комнаты вот-вот кончится — ждём следующий от ведущего, а не включаем старый
        if (target.duration && exp > target.duration - 3) return;
        if (!target.id) {
          setWarning('У ведущего не определился id трека — включите «' + target.title + '» вручную');
          return;
        }
        const key = String(target.id);
        if (switchKey !== key) { switchKey = key; switchAttempts = 0; }
        if (Date.now() < switchBusyUntil) return;
        if (switchAttempts >= MAX_SWITCH_ATTEMPTS) {
          setWarning('Не получилось включить «' + target.title + '» — включите вручную');
          return;
        }
        switchAttempts++;
        switchBusyUntil = Date.now() + SWITCH_MS;
        settleUntil = Date.now() + SWITCH_MS;
        // пока playTrack работает (может листать альбом), все смены трека — наши
        const echo = expect('track', SWITCH_MS, true);
        const r = await pageCall('playTrack', { id: target.id, albumId: target.albumId }, SWITCH_MS);
        if (r.reload) return; // страница перезагружается, продолжит новый content.js
        echo.until = settleUntil = Date.now() + SETTLE_MS;
        switchBusyUntil = 0;
        if (r.ok) setTimeout(resync, SETTLE_MS); // догнать позицию и паузу
        else if (!r.cancelled) setWarning('Не включился трек: ' + (r.error || 'неизвестно'));
        return;
      }

      switchAttempts = 0;
      if (warning) setWarning('');

      if (s.paused !== room.paused) {
        expect(room.paused ? 'pause' : 'play');
        const r = await pageCall(room.paused ? 'pause' : 'play');
        if (!room.paused && r.ok) { autoplayBlocked = false; render(); }
      }
      if (Math.abs(exp - s.position) > DRIFT_SEC) {
        expect('seek', ECHO_MS, true);
        await pageCall('seek', { position: exp });
      }
    } finally {
      syncing = false;
    }
  }

  // Ведущий регулярно шлёт позицию и данные трека: id и длительность могли определиться
  // уже после смены трека. Плюс следующий трек, если он изменился.
  let sentNextKey = null;
  setInterval(async () => {
    if (!isLeader() || syncing || hasPendingExpects() || Date.now() - lastStateAt < 1500) return;
    const s = await pageCall('state');
    if (!s.ok || !sameTrack(s.track, room && room.track)) return;
    if (warning) setWarning(''); // трек совпадает с комнатой — старое предупреждение неактуально
    // Пауза у ведущего разошлась с комнатой и никто ничего не делал 3 с — правим комнату.
    // Бывает, когда «плей» пришёл сразу после смены трека и был отброшен как не от человека.
    if (s.paused !== room.paused && !autoplayBlocked && Date.now() - lastChangeAt > 3000) {
      send({ t: 'pause', paused: s.paused, position: s.position });
    }
    send({ t: 'pos', position: s.position, track: s.track });
    const nextKey = s.next ? s.next.id : '';
    if (nextKey !== sentNextKey) {
      sentNextKey = nextKey;
      send({ t: 'queue', queue: s.next ? [s.next] : [] });
    }
  }, HEARTBEAT_MS);

  // ведомый подстраивает рассинхрон
  setInterval(() => { if (room && !isLeader()) resync(); }, FOLLOW_CHECK_MS);

  // ---------- панель на странице ----------
  // Приглашение: ссылка вида music.yandex.ru/?jam=КОД открывает панель с кнопкой «Войти».
  const invite = YJam.normalizeCode(new URLSearchParams(location.search).get('jam')) || null;
  let settingsLoaded = false;

  const overlay = YJamOverlay.create({
    async create(name) {
      await chrome.storage.local.set({ room: YJam.randomCode(), ...(name ? { name } : {}) });
    },
    async join(code, name) {
      await chrome.storage.local.set({ room: code, ...(name ? { name } : {}) });
    },
    async leave() {
      await chrome.storage.local.set({ room: '' });
    },
    async rename(name) {
      await chrome.storage.local.set({ name });
    },
    unblock() {
      autoplayBlocked = false;
      render();
      resync();
    },
  });

  function render() {
    if (!settingsLoaded) return;
    overlay.update({ ...status(), name: settings.name, invite });
  }

  // ---------- попап ----------
  function status() {
    return {
      conn,
      room: settings.room,
      clientId,
      isLeader: isLeader(),
      state: room,
      expectedPosition: room ? expectedPosition(room) : 0,
      warning,
      autoplayBlocked,
      clockOffset: Math.round(clockOffset),
      rtt: Number.isFinite(bestRtt) ? bestRtt : null,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'yjam:status') {
      pageCall('state').then((player) => reply({ ...status(), player }));
      return true;
    }
    if (msg.type === 'yjam:diag') {
      pageCall('diag').then((d) => reply({ ...d, jam: status() }));
      return true;
    }
    if (msg.type === 'yjam:resync') {
      switchAttempts = 0;
      switchBusyUntil = 0;
      autoplayBlocked = false;
      resync();
      reply({ ok: true });
    }
  });

  // ---------- настройки ----------
  YJam.ensureSettings().then((s) => {
    settings = { ...DEFAULTS, ...s };
    settingsLoaded = true;
    connect();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let reconnect = false;
    for (const k of Object.keys(DEFAULTS)) {
      if (!changes[k]) continue;
      settings[k] = changes[k].newValue || '';
      // новое имя применится при следующем входе: переподключение отняло бы роль ведущего
      if (k !== 'name' || !settings.room) reconnect = true;
    }
    if (reconnect) connect(); else render();
  });
})();
