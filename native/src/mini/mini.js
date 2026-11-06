// Окно плеера поверх всех окон. Показывает состояние из окна Музыки и шлёт туда команды;
// комнату создаёт и меняет записью в настройки — как попап и виджет расширения.

(() => {
  const PRESS_HOLD_MS = 1500;
  const DRAG_START_PX = 3; // дрогнувшая при клике рука — ещё не перетаскивание
  const VOLUME_OPEN_MS = 120; // курсор просто прошёл над значком — всплывашка не нужна
  const VOLUME_CLOSE_MS = 120;
  const VOLUME_POP_PADDING_PX = 8;
  const VOLUME_POP_MARGIN_PX = 8;
  const VOLUME_POP_GAP_PX = 8; // между процентами и значком
  const QUEUE_REFRESH_MS = 1500;
  const QUEUE_SCROLL_PAUSE_MS = 4000; // сколько не трогаем список после прокрутки рукой
  const COPIED_MS = 1200;
  const QUEUE_MAX_ROWS = 1000; // дальше забываем самые старые песни
  const SITE_ICON = '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/><path d="M11 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>';
  const COPY_ICONS = '<svg class="copy-icon" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>'
    + '<svg class="done-icon" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const $ = (id) => document.getElementById(id);
  let openPanel = null; // 'queue' или ничего
  let lastTrackId = null;
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

  function renderTrack(player, page, loading) {
    const track = player && player.track;
    $('loading').hidden = !loading;
    $('title').hidden = loading;
    $('artist').hidden = loading;
    $('title').textContent = track ? track.title : page === 'other' ? 'Яндекс Музыка не открыта' : 'Случайный';
    $('artist').textContent = track ? track.artist : '';

    const random = !track && page === 'music' && !loading;
    $('cover-box').classList.toggle('random', random);
    $('cover-random').toggleAttribute('hidden', !random);
    const cover = track && track.cover;
    if (cover && $('cover').getAttribute('src') !== cover) $('cover').src = cover;
    $('cover').hidden = !cover;

    // Только что нажали плей или паузу: показываем результат нажатия, пока сайт его не выполнит.
    const paused = Date.now() < pressedUntil ? pressedPaused : !player || player.paused;
    showPaused(paused);
    // До первого плея сайт не сообщает трек, но включить музыку уже можно.
    // Пока сайт грузится или трек возвращается, нажатие всё равно отменилось бы.
    $('toggle').disabled = page !== 'music' || loading;
    $('queue').disabled = loading;
    if (loading && openPanel === 'queue') setPanel(null);
    for (const id of ['prev', 'next']) $(id).disabled = !track;

    duration = (player && player.duration) || 0;
    const position = (player && player.position) || 0;
    $('progress').disabled = !track || !duration;
    $('progress-fill').style.width = duration ? Math.min(100, (position / duration) * 100) + '%' : '0';
    $('time').textContent = track && duration ? formatTime(position) + ' / ' + formatTime(duration) : '- / -';
    renderModes(player, track);
  }

  const REPEAT_TITLES = { none: 'Повтор: выключен', context: 'Повтор: вся очередь', one: 'Повтор: один трек' };

  function renderModes(player, track) {
    const modes = (player && player.modes) || { shuffle: false, repeat: 'none', canShuffle: false, canRepeat: false };
    $('shuffle').disabled = !track || !modes.canShuffle;
    $('shuffle').setAttribute('aria-pressed', String(modes.shuffle));
    // Кнопка серая по решению сайта: объясняем, чтобы это не выглядело поломкой.
    $('shuffle').title = !track || modes.canShuffle ? 'Случайный порядок' : 'Сайт не даёт перемешать эту очередь';
    $('repeat').disabled = !track || !modes.canRepeat;
    $('repeat').dataset.mode = modes.repeat;
    $('repeat').setAttribute('aria-pressed', String(modes.repeat !== 'none'));
    $('repeat').title = REPEAT_TITLES[modes.repeat] || REPEAT_TITLES.none;
  }

  // ---------- громкость ----------
  let volumeLevel = 1;
  let volumeHeldUntil = 0;
  let volumeDragFrom = null; // уровень в начале перетаскивания, он же вернётся по кнопке, если увели в ноль
  let volumeTimer = null;

  function showVolume(level) {
    volumeLevel = level;
    const percent = Math.round(level * 100);
    const label = level === 0 ? 'Включить звук' : 'Выключить звук';
    $('volume-slider').value = percent;
    $('volume-slider').style.setProperty('--fill', percent + '%');
    $('volume-value').textContent = percent + '%';
    $('mute').dataset.level = level === 0 ? 'off' : level < 0.5 ? 'low' : 'high';
    $('mute').setAttribute('aria-pressed', String(level === 0));
    $('mute').setAttribute('aria-label', label);
  }

  function renderVolume(player) {
    const level = player && typeof player.volume === 'number' ? player.volume : null;
    $('mute').disabled = level === null;
    if (level === null) closeVolume();
    // Пока тянем ползунок или только что нажали, опрос мог принести старый уровень.
    if (level !== null && volumeDragFrom === null && Date.now() >= volumeHeldUntil) showVolume(level);
  }

  // Значок попадает внутрь всплывашки на своё же место, его правый край совпадает с её правым краем:
  // справа от значка отступом служит поле самой кнопки. По высоте отступ меньше, если снизу мало места.
  function openVolume() {
    clearTimeout(volumeTimer);
    if ($('mute').disabled || !$('volume-pop').hidden) return;
    const pop = $('volume-pop');
    const box = $('mute').closest('.player').getBoundingClientRect();
    const icon = $('mute').getBoundingClientRect();
    const padY = Math.min(VOLUME_POP_PADDING_PX, box.bottom - VOLUME_POP_MARGIN_PX - icon.bottom);
    pop.style.top = icon.top - box.top - padY + 'px';
    pop.style.height = icon.height + padY * 2 + 'px';
    pop.style.paddingRight = box.right - VOLUME_POP_MARGIN_PX - icon.left + VOLUME_POP_GAP_PX + 'px';
    pop.hidden = false;
  }

  function closeVolume() {
    clearTimeout(volumeTimer);
    $('volume-pop').hidden = true;
  }

  $('volume').addEventListener('pointerenter', () => {
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(openVolume, VOLUME_OPEN_MS);
  });
  $('volume').addEventListener('pointerleave', () => {
    clearTimeout(volumeTimer);
    if (volumeDragFrom === null) volumeTimer = setTimeout(closeVolume, VOLUME_CLOSE_MS);
  });
  // Клавиатура: значок получил фокус табом. Клик мышью сюда не попадает, иначе всплывашка осталась бы открытой.
  $('volume').addEventListener('focusin', (e) => { if (e.target.matches(':focus-visible')) openVolume(); });
  $('volume').addEventListener('focusout', (e) => {
    if (!$('volume').contains(e.relatedTarget) && !$('volume').matches(':hover')) closeVolume();
  });

  $('volume-slider').addEventListener('pointerdown', () => { volumeDragFrom = volumeLevel; });
  window.addEventListener('pointerup', () => {
    if (volumeDragFrom === null) return;
    volumeDragFrom = null;
    volumeHeldUntil = Date.now() + PRESS_HOLD_MS;
    if (!$('volume').matches(':hover')) volumeTimer = setTimeout(closeVolume, VOLUME_CLOSE_MS);
  });
  $('volume-slider').addEventListener('input', (e) => {
    const before = volumeDragFrom === null ? volumeLevel : volumeDragFrom;
    const level = Number(e.target.value) / 100;
    volumeHeldUntil = Date.now() + PRESS_HOLD_MS;
    showVolume(level);
    desktop.setVolume(level, before);
  });
  $('mute').onclick = async () => {
    volumeHeldUntil = Date.now() + PRESS_HOLD_MS;
    const result = await desktop.control('mute');
    if (result && result.ok) showVolume(result.level);
  };

  // Подсказка важнее всего остального: она объясняет, почему не играет.
  function renderNotice(page, status) {
    let text = '';
    let action = null;
    if (page === 'other') {
      text = 'Войдите в Яндекс в полном окне';
      action = 'full';
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

  function renderJam(status) {
    const members = (status && status.state && status.state.members) || [];
    $('jam-label').textContent = status && status.room ? 'Джем · ' + (members.length || 1) : 'Джем';
    $('jam').classList.toggle('alert', !!(status && status.warning));
  }

  function render(data) {
    const { page, status, restoring } = data;
    const player = status && status.player && status.player.ok ? status.player : null;
    // Пока идёт возврат, сайт показывает то, что вспомнил сам: это ещё не наш трек.
    const loading = page === 'loading' || !!restoring;
    renderTrack(loading ? null : player, page, loading);
    renderVolume(loading ? null : player);
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

  $('toggle').onclick = () => {
    pressedPaused = !shownPaused;
    pressedUntil = Date.now() + PRESS_HOLD_MS;
    showPaused(pressedPaused);
    desktop.control('toggle');
  };
  $('prev').onclick = () => desktop.control('prev');
  $('next').onclick = () => desktop.control('next');
  $('shuffle').onclick = () => desktop.control('shuffle');
  $('repeat').onclick = () => desktop.control('repeat');
  $('full').onclick = () => desktop.setMode('full');
  $('hide').onclick = () => desktop.setMode('tray');
  // Раскрыто что-то одно: плейлист и настройки вместе не поместились бы на экран.
  function setPanel(name) {
    openPanel = name;
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
  let savedQueueKey = null;
  // Список прошлого запуска. Опрос сайта дождётся его, иначе затёр бы сохранённое своим.
  const queueLoaded = desktop.savedQueue().then((saved) => {
    if (!saved) return;
    queueTracks = saved.tracks;
    queueCurrentId = saved.currentId;
  });

  function persistQueue() {
    const key = JSON.stringify([queueTracks.map((t) => t.id), queueCurrentId]);
    if (key === savedQueueKey) return;
    savedQueueKey = key;
    desktop.saveQueue(queueTracks, queueCurrentId);
  }

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
      await desktop.copy(YJam.trackLink(track));
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
    persistQueue();
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
      await queueLoaded;
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

  // Сброс в настройках: сверху ничего не остаётся, только то, что сейчас в очереди сайта.
  desktop.onPlaybackReset(() => {
    queueTracks = [];
    queueCurrentId = null;
    queueKey = null;
    savedQueueKey = null;
    refreshQueue();
  });

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

  // ---------- вид плеера ----------
  function showView(view) {
    document.body.dataset.view = view;
    closeVolume(); // позиция считалась для прошлого вида
    // В нано нет кнопок, которыми панель можно было бы закрыть.
    if (view === 'nano' && openPanel) setPanel(null);
    fitWindow();
  }
  chrome.storage.local.get({ miniView: 'micro' }).then((p) => showView(p.miniView));
  chrome.storage.onChanged.addListener((changes) => { if (changes.miniView) showView(changes.miniView.newValue); });

  function openOver(page) {
    setPanel(null);
    desktop.toggleSettings(page);
  }
  $('settings').onclick = () => openOver('settings');
  desktop.onSettingsState(({ open, offset, page }) => {
    $('settings').setAttribute('aria-pressed', String(open && page === 'settings'));
    $('jam').setAttribute('aria-expanded', String(open && page === 'main'));
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

  $('jam').onclick = () => openOver('main');

  // ---------- перетаскивание и двойной клик ----------
  const isControl = (target) => !!target.closest('button, input, .queue-panel, .volume-pop');
  let dragStart = null;
  let dragging = false;

  $('app').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || isControl(e.target)) return;
    dragStart = { x: e.screenX, y: e.screenY };
    $('app').setPointerCapture(e.pointerId); // курсор уйдёт за край окна раньше, чем окно его догонит
  });
  $('app').addEventListener('pointermove', (e) => {
    if (!dragStart || dragging) return;
    if (Math.hypot(e.screenX - dragStart.x, e.screenY - dragStart.y) < DRAG_START_PX) return;
    dragging = true;
    desktop.dragWindow(true);
  });
  function endDrag() {
    if (dragging) desktop.dragWindow(false);
    dragging = false;
    dragStart = null;
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('app').addEventListener(type, endDrag);
  $('app').addEventListener('dblclick', (e) => { if (!isControl(e.target)) desktop.setMode('full'); });

  desktop.onStatus(render);
  fitWindow();
})();
