// Окно плеера поверх всех окон. Показывает состояние из окна Музыки и шлёт туда команды;
// комнату создаёт и меняет записью в настройки — как попап и виджет расширения.

(() => {
  const PRESS_HOLD_MS = 1500;
  const QUEUE_REFRESH_MS = 1500;
  const QUEUE_SCROLL_PAUSE_MS = 4000; // сколько не трогаем список после прокрутки рукой
  const COPIED_MS = 1200;
  const QUEUE_MAX_ROWS = 1000; // дальше забываем самые старые песни
  const SITE_ICON = '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/><path d="M11 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>';
  const COPY_ICONS = '<svg class="copy-icon" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>'
    + '<svg class="done-icon" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const $ = (id) => document.getElementById(id);
  let openPanel = null; // 'jam', 'queue' или ничего
  let lastTrackId = null;
  let current = null;
  let duration = 0;
  let pressedUntil = 0;
  let pressedPaused = true;
  let shownPaused = true;

  YJam.loadFonts();

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // У <svg> нет свойства hidden, как у HTML-элементов: запись в него не меняет атрибут, и иконка не переключается.
  function showPaused(paused) {
    shownPaused = paused;
    $('icon-play').toggleAttribute('hidden', !paused);
    $('icon-pause').toggleAttribute('hidden', paused);
  }

  function renderTrack(player, page) {
    const track = player && player.track;
    $('title').textContent = track ? track.title : page === 'music' ? 'Ничего не играет' : 'Яндекс Музыка не открыта';
    $('artist').textContent = track ? track.artist : '';

    const cover = track && track.cover;
    if (cover && $('cover').getAttribute('src') !== cover) $('cover').src = cover;
    $('cover').hidden = !cover;

    // Только что нажали плей или паузу: показываем результат нажатия, пока сайт его не выполнит.
    const paused = Date.now() < pressedUntil ? pressedPaused : !player || player.paused;
    showPaused(paused);
    // До первого плея сайт не сообщает трек, но включить музыку уже можно.
    $('toggle').disabled = page !== 'music';
    for (const id of ['prev', 'next']) $(id).disabled = !track;

    duration = (player && player.duration) || 0;
    const position = (player && player.position) || 0;
    $('progress').disabled = !track || !duration;
    $('progress-fill').style.width = duration ? Math.min(100, (position / duration) * 100) + '%' : '0';
    $('time').textContent = track && duration ? formatTime(position) + ' / ' + formatTime(duration) : '- / -';
  }

  // Подсказка важнее всего остального: она объясняет, почему не играет.
  function renderNotice(page, status) {
    let text = '';
    let action = null;
    if (page === 'other') {
      text = 'Войдите в Яндекс в полном окне';
      action = 'full';
    } else if (page === 'loading') {
      text = 'Загружаем Яндекс Музыку…';
    } else if (status && status.autoplayBlocked) {
      text = 'Нажмите, чтобы включить звук';
      action = 'full';
    } else if (status && status.warning) {
      text = status.warning;
    }
    $('notice').hidden = !text;
    $('notice').textContent = text;
    $('notice').disabled = !action;
    $('notice').dataset.action = action || '';
  }

  const CONN_TEXT = { open: 'на связи', connecting: 'подключаемся…', reconnecting: 'нет связи, пробуем ещё', off: 'не подключено' };

  function renderJam(status) {
    const roomCode = status && status.room;
    const members = (status && status.state && status.state.members) || [];
    $('jam-label').textContent = roomCode ? 'Джем · ' + (members.length || 1) : 'Джем';
    $('jam').classList.toggle('alert', !!(status && status.warning));
    $('lobby').hidden = !!roomCode;
    $('room').hidden = !roomCode;
    if (!roomCode) return;

    $('room-code').textContent = roomCode;
    $('conn').textContent = CONN_TEXT[status.conn] || '';
    $('conn').classList.toggle('ok', status.conn === 'open');
    renderMembers(members, status);
  }

  function renderMembers(members, status) {
    const list = $('members');
    list.replaceChildren(...members.map((m, i) => {
      const li = document.createElement('li');
      li.className = 'member';

      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.style.background = YJam.avatarColor(i);
      avatar.textContent = YJam.initial(m.name);

      const name = document.createElement('span');
      name.className = 'member-name';
      name.textContent = m.name;
      if (m.id === status.clientId) {
        const you = document.createElement('span');
        you.className = 'you';
        you.textContent = 'вы';
        name.append(you);
      }
      li.append(avatar, name);

      if (status.state.leaderId === m.id) {
        const host = document.createElement('span');
        host.className = 'host';
        host.textContent = 'ведущий';
        li.append(host);
      }
      return li;
    }));
  }

  function render(data) {
    current = data;
    const { page, status } = data;
    const player = status && status.player && status.player.ok ? status.player : null;
    renderTrack(player, page);
    const trackId = player && player.track && player.track.id;
    if (trackId && trackId !== lastTrackId) {
      lastTrackId = trackId;
      refreshQueue();
    }
    renderNotice(page, status);
    renderJam(status);
    fitWindow();
  }

  let lastHeight = 0;
  function fitWindow() {
    const height = $('app').offsetHeight;
    if (height === lastHeight) return;
    lastHeight = height;
    desktop.setHeight(height);
  }

  // Вставили ссылку-приглашение — берём из неё код.
  function readCode(text) {
    try {
      const jam = new URL(text.trim()).searchParams.get('jam');
      if (jam) return YJam.normalizeCode(jam);
    } catch (e) {
      // это не ссылка, а сам код
    }
    return YJam.normalizeCode(text);
  }

  async function joinRoom() {
    const code = readCode($('code').value);
    if (!code) { $('code').focus(); return; }
    await chrome.storage.local.set({ room: code });
    $('code').value = '';
  }

  $('toggle').onclick = () => {
    pressedPaused = !shownPaused;
    pressedUntil = Date.now() + PRESS_HOLD_MS;
    showPaused(pressedPaused);
    desktop.control('toggle');
  };
  $('prev').onclick = () => desktop.control('prev');
  $('next').onclick = () => desktop.control('next');
  $('full').onclick = () => desktop.setMode('full');
  $('hide').onclick = () => desktop.setMode('tray');
  // Раскрыто что-то одно: комната есть и в самих настройках, а вместе они не поместились бы на экран.
  function setPanel(name) {
    openPanel = name;
    $('panel').hidden = name !== 'jam';
    $('jam').setAttribute('aria-expanded', String(name === 'jam'));
    $('queue-panel').hidden = name !== 'queue';
    $('queue').setAttribute('aria-expanded', String(name === 'queue'));
    clearInterval(queueTimer);
    if (name === 'queue') {
      queueKey = null;
      scrollToCurrent = true;
      refreshQueue();
      queueTimer = setInterval(refreshQueue, QUEUE_REFRESH_MS);
    }
    fitWindow();
  }

  const togglePanel = (name) => {
    desktop.closeSettings();
    setPanel(openPanel === name ? null : name);
  };

  // ---------- плейлист ----------
  let queueTimer = null;
  let queueKey = null;
  let queueBusy = false;
  let queueAgain = false;
  let queueTracks = [];
  let queueCurrentId = null;
  let queueShownCurrent = null;
  let queueFailed = false;
  let scrollToCurrent = false;
  let scrolledAt = 0;
  let programScroll = false;

  const trackLink = ({ id, albumId }) =>
    'https://music.yandex.ru' + (albumId ? `/album/${albumId}/track/${id}` : `/track/${id}`);

  function siteButton(track) {
    const button = document.createElement('button');
    button.className = 'queue-action queue-site';
    button.title = 'Уйти на сайт: ссылки на эту песню в других сервисах';
    button.setAttribute('aria-label', 'Уйти на сайт');
    button.innerHTML = SITE_ICON;
    button.onclick = (e) => {
      e.stopPropagation(); // клик по строке включил бы трек
      desktop.openSongPage(track);
    };
    return button;
  }

  function copyButton(track) {
    const button = document.createElement('button');
    button.className = 'queue-action queue-copy';
    button.title = 'Скопировать ссылку на трек';
    button.setAttribute('aria-label', 'Скопировать ссылку на трек');
    button.innerHTML = COPY_ICONS;
    let timer = null;
    button.onclick = async (e) => {
      e.stopPropagation(); // клик по строке включил бы трек
      await desktop.copy(trackLink(track));
      button.classList.add('copied');
      clearTimeout(timer);
      timer = setTimeout(() => button.classList.remove('copied'), COPIED_MS);
    };
    return button;
  }

  function queueRow(track, isCurrent) {
    // Кнопка не может лежать внутри кнопки, поэтому строка — это li: клик по ней и по длительности включает трек.
    const li = document.createElement('li');
    li.className = 'queue-item';
    li.classList.toggle('current', isCurrent);
    li.onclick = async () => {
      await desktop.playFromQueue(track.index, track.id, track.albumId);
      refreshQueue();
    };

    const button = document.createElement('button');
    button.className = 'queue-row';
    button.setAttribute('aria-current', String(isCurrent));

    const cover = document.createElement('img');
    cover.className = 'queue-cover';
    cover.alt = '';
    cover.loading = 'lazy';
    if (track.cover) cover.src = track.cover;
    else cover.hidden = true;

    const text = document.createElement('span');
    text.className = 'queue-text';
    const title = document.createElement('span');
    title.className = 'queue-title';
    title.textContent = track.title;
    if (track.version) {
      const version = document.createElement('span');
      version.className = 'queue-version';
      version.textContent = track.version;
      title.append(version);
    }
    const artist = document.createElement('span');
    artist.className = 'queue-artist';
    artist.textContent = track.artist;
    text.append(title, artist);

    const time = document.createElement('span');
    time.className = 'queue-duration';
    time.textContent = track.duration ? formatTime(track.duration) : '';

    button.append(cover, text);
    li.append(button, copyButton(track), siteButton(track), time);
    return li;
  }

  // Сайт знает только текущий альбом или плейлист. Поэтому сверху остаётся всё, что было раньше,
  // а под ним идёт очередь сайта в её настоящем порядке: она учитывает и новые треки, и случайный порядок.
  function mergeQueue(queue) {
    if (!queue || !queue.ok) {
      queueFailed = !queueTracks.length && !!queue;
      return;
    }
    queueFailed = false;
    const live = new Set(queue.tracks.map((t) => t.id));
    const earlier = queueTracks.filter((t) => !live.has(t.id));
    queueTracks = [...earlier.slice(-Math.max(0, QUEUE_MAX_ROWS - queue.tracks.length)), ...queue.tracks];
    const now = queue.tracks[queue.current];
    if (now) queueCurrentId = now.id;
    else if (lastTrackId) queueCurrentId = lastTrackId;
  }

  function renderQueue() {
    // Список перестраиваем, только когда он изменился: иначе сбрасывались бы наведение и прокрутка.
    const key = JSON.stringify([queueFailed, queueTracks.map((t) => t.index + ':' + t.id), queueCurrentId]);
    if (key === queueKey) return;
    const currentChanged = queueShownCurrent !== queueCurrentId;
    queueKey = key;
    queueShownCurrent = queueCurrentId;

    $('queue-empty').hidden = queueTracks.length > 0;
    $('queue-empty').textContent = queueFailed
      ? 'Не получилось прочитать список у сайта'
      : 'Плейлист появится, когда включите музыку';

    const list = $('queue-list');
    const top = list.scrollTop;
    const currentAt = queueTracks.findIndex((t) => t.id === queueCurrentId);
    list.replaceChildren(...queueTracks.map((t, i) => queueRow(t, i === currentAt)));
    fitWindow();

    const handsOff = Date.now() - scrolledAt < QUEUE_SCROLL_PAUSE_MS;
    const row = list.children[currentAt];
    programScroll = true;
    list.scrollTop = top;
    if (row && (scrollToCurrent || (currentChanged && !handsOff))) {
      list.scrollTop = row.offsetTop - list.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
    }
    if (queueTracks.length) scrollToCurrent = false;
    requestAnimationFrame(() => { programScroll = false; });
  }

  // Работает и при закрытом плейлисте: иначе песни, сыгранные без него, в список не попали бы.
  async function refreshQueue() {
    if (queueBusy) {
      queueAgain = true;
      return;
    }
    queueBusy = true;
    try {
      mergeQueue(await desktop.queue());
      if (openPanel === 'queue') renderQueue();
    } finally {
      queueBusy = false;
      if (queueAgain) {
        queueAgain = false;
        refreshQueue();
      }
    }
  }

  $('queue').onclick = () => togglePanel('queue');
  $('queue-list').addEventListener('scroll', () => { if (!programScroll) scrolledAt = Date.now(); });

  // ---------- поверх всех окон ----------
  function showOnTop(on) {
    $('ontop').setAttribute('aria-pressed', String(on));
    $('ontop').title = on ? 'Поверх всех окон: включено' : 'Поверх всех окон: выключено';
  }
  $('ontop').onclick = () => chrome.storage.local.set({ miniOnTop: $('ontop').getAttribute('aria-pressed') !== 'true' });
  chrome.storage.local.get({ miniOnTop: true }).then((p) => showOnTop(p.miniOnTop));
  chrome.storage.onChanged.addListener((changes) => { if (changes.miniOnTop) showOnTop(changes.miniOnTop.newValue); });

  $('settings').onclick = () => {
    setPanel(null);
    desktop.toggleSettings();
  };
  desktop.onSettingsState(({ open, offset }) => {
    $('settings').setAttribute('aria-pressed', String(open));
    if (open && openPanel) setPanel(null); // настройки открыли из трея
    // Настройки над плеером лежат поверх верхней части окна, сам плеер должен быть ниже них.
    document.body.style.paddingTop = offset + 'px';
  });
  $('notice').onclick = () => { if ($('notice').dataset.action === 'full') desktop.setMode('full'); };

  $('progress').onclick = (e) => {
    if (!duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    desktop.seek(((e.clientX - r.left) / r.width) * duration);
  };

  $('jam').onclick = () => togglePanel('jam');

  $('create').onclick = () => chrome.storage.local.set({ room: YJam.randomCode() });
  $('join').onclick = joinRoom;
  $('code').onkeydown = (e) => { if (e.key === 'Enter') joinRoom(); };
  $('leave').onclick = () => chrome.storage.local.set({ room: '' });
  $('copy').onclick = async () => {
    const code = current && current.status && current.status.room;
    if (!code) return;
    await desktop.copy(YJam.inviteLink(code));
    $('copy').textContent = 'Скопировано';
    setTimeout(() => { $('copy').textContent = 'Скопировать ссылку'; }, 1500);
  };

  desktop.onStatus(render);
  fitWindow();
})();
