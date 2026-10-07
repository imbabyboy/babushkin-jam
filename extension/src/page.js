// Адаптер плеера Яндекс Музыки. Работает в мире страницы (world: MAIN) с document_start,
// чтобы перехватить <audio>, mediaSession и сеть раньше, чем их создаст сайт.
// Ничего не знает про комнаты: шлёт события плеера в content.js и выполняет его команды.
// Всё, что зависит от внутренностей сайта, — здесь. Это гипотезы, их проверяет ymJam.diag().

(() => {
  if (window.__yjamPage) return;
  window.__yjamPage = true;

  const FROM_PAGE = 'yjam-page';
  const FROM_CS = 'yjam-cs';
  const emit = (type, data = {}) =>
    window.postMessage({ source: FROM_PAGE, type, ...data }, location.origin);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const short = (s) => (s && s.length > 120 ? s.slice(0, 120) + '…' : s);

  // ---------- 1. Медиа-элементы ----------
  // Плеер может создавать Audio без вставки в DOM, поэтому ловим через play().
  const media = new Set();
  let current = null; // элемент, который играл последним

  // Сайт проигрывает беззвучный data:audio/mp3, чтобы разблокировать звук, — это не плеер.
  const isSilent = (el) => /^data:/.test(el.currentSrc || el.src || '');

  function attach(el) {
    if (!el || media.has(el)) return;
    media.add(el);
    el.addEventListener('play', () => {
      if (isSilent(el)) return;
      current = el;
      emit('play', snapshot());
    });
    el.addEventListener('pause', () => { if (el === current) emit('pause', snapshot()); });
    el.addEventListener('seeked', () => { if (el === current) emit('seek', snapshot()); });
    el.addEventListener('ended', () => { if (el === current) emit('ended', snapshot()); });
  }

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    attach(this);
    const p = origPlay.apply(this, args);
    if (p && p.catch) {
      p.catch((e) => { if (e && e.name === 'NotAllowedError') emit('autoplay-blocked'); });
    }
    return p;
  };
  // элементы в DOM: события медиа не всплывают, но ловятся на погружении
  document.addEventListener('play', (e) => attach(e.target), true);

  function activeMedia() {
    if (current) return current;
    if (!media.size) document.querySelectorAll('audio, video').forEach(attach);
    const list = [...media].filter((m) => !isSilent(m));
    return list.find((m) => !m.paused) || list.find((m) => m.currentSrc) || null;
  }

  function snapshot() {
    const el = activeMedia();
    if (!el) return { position: 0, duration: 0, paused: true };
    return {
      position: el.currentTime || 0,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      paused: el.paused,
    };
  }

  // ---------- 2. Media Session ----------
  // Обработчики сайта (play/pause/seekto/nexttrack) — лучший способ управлять:
  // через них интерфейс сайта остаётся в согласованном состоянии.
  const handlers = {};
  if (window.MediaSession) {
    const proto = MediaSession.prototype;
    const origSet = proto.setActionHandler;
    proto.setActionHandler = function (action, fn) {
      handlers[action] = fn;
      return origSet.call(this, action, fn);
    };
    const desc = Object.getOwnPropertyDescriptor(proto, 'metadata');
    if (desc && desc.set) {
      Object.defineProperty(proto, 'metadata', {
        configurable: true,
        enumerable: desc.enumerable,
        get() { return desc.get.call(this); },
        set(v) { desc.set.call(this, v); setTimeout(checkTrack, 0); },
      });
    }
  }

  // ---------- 3. Сеть ----------
  // Ответы API с треками складываем в справочник «название -> id»: так id находится,
  // даже когда панели плеера нет на странице (полноэкранная «Моя волна»).
  // По get-file-info видно, что грузится: одиночный запрос — текущий трек,
  // batch — предзагрузка следующего (гипотеза по логам от 6 октября).
  const norm = (s) => (s || '').trim().toLowerCase();
  const requests = [];
  const fileInfo = []; // { id, batch, at }
  const known = new Map(); // id -> { id, albumId, title, artist, duration }
  const byTitle = new Map(); // norm(название) -> Set(id)
  const INTERESTING = /track|queue|plays|file-info|rotor|station/i;
  const FILE_INFO_RE = /get-file-info(\/batch)?\?.*?\btrackIds?=(\d+)/;

  function noteRequest(method, url) {
    url = String(url || '');
    const fi = url.match(FILE_INFO_RE);
    if (fi) {
      fileInfo.push({ id: fi[2], batch: !!fi[1], at: Date.now() });
      if (fileInfo.length > 30) fileInfo.shift();
    }
    if (!INTERESTING.test(url)) return;
    requests.push(method + ' ' + url);
    if (requests.length > 60) requests.shift();
  }

  function rememberTrack(o) {
    const [id, albumFromId] = String(o.id).split(':');
    if (!/^\d+$/.test(id)) return;
    const album = Array.isArray(o.albums) && o.albums[0];
    const t = {
      id,
      albumId: album && album.id != null ? String(album.id) : albumFromId || null,
      title: o.title,
      artist: o.artists.map((a) => a && a.name).filter(Boolean).join(', '),
      duration: o.durationMs ? o.durationMs / 1000 : 0,
    };
    known.delete(id);
    known.set(id, t);
    if (known.size > 3000) known.delete(known.keys().next().value);
    const keys = [o.title];
    if (o.version) keys.push(`${o.title} ${o.version}`, `${o.title} (${o.version})`);
    for (const k of keys) {
      const key = norm(k);
      if (!byTitle.has(key)) byTitle.set(key, new Set());
      byTitle.get(key).add(id);
    }
  }

  // Обходим любой JSON и берём всё, что похоже на трек: { id, title, artists: [...] }.
  function indexTracks(json) {
    let budget = 50000;
    const walk = (v, depth) => {
      if (!v || typeof v !== 'object' || depth > 12 || --budget < 0) return;
      if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
      if ((typeof v.id === 'string' || typeof v.id === 'number') &&
          typeof v.title === 'string' && Array.isArray(v.artists)) rememberTrack(v);
      for (const k in v) walk(v[k], depth + 1);
    };
    walk(json, 0);
  }

  const isMusicApi = (url) => /music\.yandex\.|^\/(?!\/)/.test(url);

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    let url = '';
    try {
      url = String(typeof input === 'string' || input instanceof URL ? input : input && input.url);
      noteRequest((init && init.method) || (input && input.method) || 'GET', url);
    } catch (e) {}
    const p = origFetch.apply(this, arguments);
    if (isMusicApi(url)) {
      p.then((res) => {
        if (/json/.test(res.headers.get('content-type') || '')) {
          res.clone().json().then(indexTracks, () => {});
        }
      }, () => {});
    }
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      noteRequest(method, url);
      if (isMusicApi(String(url))) {
        this.addEventListener('load', () => {
          try {
            if (this.responseType === 'json') indexTracks(this.response);
            else if (!this.responseType || this.responseType === 'text') {
              if (/json/.test(this.getResponseHeader('content-type') || '')) indexTracks(JSON.parse(this.responseText));
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
    return origOpen.apply(this, arguments);
  };

  // ---------- 4. Текущий трек ----------
  const ID_RE = /\/album\/(\d+)\/track\/(\d+)/;

  function classOf(el) {
    return (el.getAttribute && el.getAttribute('class')) || '';
  }

  function inPlayerBar(el) {
    for (let i = 0, p = el; p && i < 12; i++, p = p.parentElement) {
      if (/player/i.test(classOf(p))) return true;
    }
    return false;
  }

  function readMeta() {
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    if (md && md.title) {
      const art = md.artwork && md.artwork.length ? md.artwork[md.artwork.length - 1].src : '';
      return { title: md.title, artist: md.artist || '', album: md.album || '', cover: art };
    }
    // старый сайт
    const api = window.externalAPI;
    if (api && api.getCurrentTrack) {
      try {
        const t = api.getCurrentTrack();
        if (t && t.title) {
          return {
            title: t.title,
            artist: (t.artists || []).map((a) => a.title).join(', '),
            album: (t.album && t.album.title) || '',
            cover: t.cover ? 'https://' + String(t.cover).replace('%%', '400x400') : '',
          };
        }
      } catch (e) {}
    }
    return null;
  }

  function idsFromApi() {
    try {
      const t = window.externalAPI && window.externalAPI.getCurrentTrack();
      const m = t && t.link && t.link.match(ID_RE);
      if (m) return { albumId: m[1], id: m[2], score: 9, source: 'externalAPI' };
    } catch (e) {}
    return null;
  }

  // Ссылка /album/A/track/T в панели плеера. Очки: внутри плеера +2, текст совпал с названием +1.
  function idsFromDom(title) {
    const want = (title || '').trim().toLowerCase();
    let best = null;
    for (const a of document.querySelectorAll('a[href*="/track/"]')) {
      const m = (a.getAttribute('href') || '').match(ID_RE);
      if (!m) continue;
      let score = 0;
      if (inPlayerBar(a)) score += 2;
      const text = ((a.textContent || '') + ' ' + (a.getAttribute('aria-label') || '')).toLowerCase();
      if (want && text.includes(want)) score += 1;
      if (score >= 2 && (!best || score > best.score)) {
        best = { albumId: m[1], id: m[2], score, source: 'dom' };
      }
    }
    return best;
  }

  // По справочнику из ответов API: название совпало +2, первый артист совпал +1.
  function idsFromIndex(meta) {
    const ids = byTitle.get(norm(meta.title));
    if (!ids) return null;
    const artist = norm(meta.artist);
    let best = null;
    for (const id of ids) {
      const t = known.get(id);
      if (!t) continue;
      const first = norm(t.artist.split(',')[0]);
      const score = first && artist.includes(first) ? 3 : 2;
      if (!best || score >= best.score) best = { id, albumId: t.albumId, score, source: 'api' };
    }
    return best;
  }

  // Последний одиночный get-file-info — трек, который сейчас загрузился.
  function idsFromFileInfo(meta) {
    const last = [...fileInfo].reverse().find((f) => !f.batch);
    if (!last) return null;
    const t = known.get(last.id);
    if (t && norm(t.title) !== norm(meta.title)) return null;
    return { id: last.id, albumId: t ? t.albumId : null, score: 1, source: 'file-info' };
  }

  function resolveIds(meta) {
    const dom = idsFromDom(meta.title);
    if (dom && dom.score >= 3) return dom;
    return idsFromApi() || idsFromIndex(meta) || dom || idsFromFileInfo(meta);
  }

  // Следующий трек: последняя предзагрузка (batch) после запроса текущего трека.
  function nextTrack(currentId) {
    if (!currentId) return null;
    let start = -1;
    for (let i = fileInfo.length - 1; i >= 0; i--) {
      if (fileInfo[i].id === currentId && !fileInfo[i].batch) { start = i; break; }
    }
    if (start < 0) return null;
    for (let i = fileInfo.length - 1; i > start; i--) {
      const f = fileInfo[i];
      if (f.batch && f.id !== currentId) {
        return known.get(f.id) || { id: f.id, albumId: null, title: '', artist: '', duration: 0 };
      }
    }
    return null;
  }

  let cache = { key: null, ids: null, since: 0 };
  const metaKey = (m) => (m ? m.title + '\u0000' + m.artist : null);

  function currentTrack() {
    const meta = readMeta();
    if (!meta) return null;
    const key = metaKey(meta);
    if (cache.key !== key) cache = { key, ids: null, since: Date.now() };
    let ids = cache.ids;
    if (!ids) {
      ids = resolveIds(meta);
      // сразу после смены трека в DOM может висеть ссылка на прошлый трек:
      // кэшируем только уверенный результат или после паузы
      if (ids && (ids.score >= 3 || Date.now() - cache.since > 1500)) cache.ids = ids;
    }
    return {
      ...meta,
      id: ids ? ids.id : null,
      albumId: ids ? ids.albumId : null,
      idSource: ids ? ids.source : null,
      duration: snapshot().duration,
    };
  }

  // Смена трека: ждём, пока определится id (до 2.5 с), и только потом сообщаем.
  let lastKey = null;
  let settleTimer = null;
  function checkTrack() {
    const key = metaKey(readMeta());
    if (key === lastKey) return;
    lastKey = key;
    clearTimeout(settleTimer);
    if (!key) return;
    const started = Date.now();
    const settle = () => {
      if (lastKey !== key) return;
      const t = currentTrack();
      if (t && !t.id && Date.now() - started < 2500) { settleTimer = setTimeout(settle, 250); return; }
      emit('track', { track: t, ...snapshot() });
    };
    settleTimer = setTimeout(settle, 400);
  }
  setInterval(checkTrack, 500); // metadata могут менять «на месте», без присваивания

  // ---------- 5. Включение трека по id ----------
  // Гипотеза: переходим на страницу трека и жмём там «Слушать».
  const PLAY_LABEL = /^(слушать|воспроизвести|воспроизведение|играть|play|listen)/i;

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findPlayButton() {
    for (const b of document.querySelectorAll('button, [role="button"]')) {
      const label = (b.getAttribute('aria-label') || b.textContent || '').trim();
      if (PLAY_LABEL.test(label) && visible(b) && !inPlayerBar(b)) return b;
    }
    return null;
  }

  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(250);
    }
    return null;
  }

  function spaNavigate(url) {
    // Next.js pages router
    const router = window.next && window.next.router;
    if (router && typeof router.push === 'function') { router.push(url); return 'next-router'; }
    // ссылка, которую уже отрисовал сайт, — её клик перехватит роутер
    const a = document.querySelector(`a[href="${url}"]`);
    if (a) { a.click(); return 'link'; }
    return null;
  }

  let lastNav = { url: null, at: 0 };

  // Полная перезагрузка — крайний случай. Помним её в sessionStorage, а не в памяти:
  // после перезагрузки память страницы пустая, и без этого вкладка могла бы
  // перезагружаться по кругу (например, если сайт открыл трек по другому адресу).
  const RELOAD_KEY = 'yjam-reload';
  const RELOAD_GUARD_MS = 2 * 60 * 1000;
  const SPA_WAIT_MS = 10000; // сколько ждём, пока сайт догрузится и роутер станет доступен

  function reloadedRecently(url) {
    try {
      const r = JSON.parse(sessionStorage.getItem(RELOAD_KEY) || 'null');
      return !!r && r.url === url && Date.now() - r.at < RELOAD_GUARD_MS;
    } catch (e) { return false; }
  }

  function rememberReload(url) {
    try { sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ url, at: Date.now() })); } catch (e) {}
  }

  const onTrackPage = (id) => new RegExp(`/track/${id}/?$`).test(location.pathname);

  // Каждый новый вызов отменяет предыдущий: иначе две попытки (из комнаты и из консоли)
  // жмут кнопки одновременно и мешают друг другу.
  let playGen = 0;

  async function playTrack({ id, albumId }) {
    if (!id) return { ok: false, error: 'нет id трека' };
    id = String(id);
    albumId = albumId ? String(albumId) : null;
    const gen = ++playGen;
    const cancelled = () => gen !== playGen;
    const CANCELLED = { ok: false, cancelled: true, error: 'отменено новой командой' };

    if (isPlaying(id)) return { ok: true, via: 'same-page', method: 'already' };

    const url = albumId ? `/album/${albumId}/track/${id}` : `/track/${id}`;
    let via = 'same-page';
    if (!onTrackPage(id)) {
      if (!(lastNav.url === url && Date.now() - lastNav.at < 6000)) {
        lastNav = { url, at: Date.now() };
        // Сразу после открытия вкладки роутер сайта ещё не готов — ждём его, а не перезагружаем.
        via = await waitFor(() => cancelled() || spaNavigate(url), SPA_WAIT_MS);
        if (cancelled()) return CANCELLED;
        if (!via) {
          if (reloadedRecently(url)) {
            return { ok: false, error: 'не открылась страница трека даже после перезагрузки' };
          }
          // полная перезагрузка: content.js переподключится и вызовет playTrack уже на нужной странице
          rememberReload(url);
          location.assign(url);
          return { ok: true, reload: true };
        }
      } else {
        via = 'pending';
      }
    }

    // 1. Кнопка нужного трека: «Слушать» в панели трека или кнопка в строке.
    //    Кнопка вверху страницы включает альбом с первого трека — её только запасным путём.
    await waitFor(() => cancelled() || trackLinks(id).length > 0 || titleNodes(id).length > 0, 6000);
    if (cancelled()) return CANCELLED;
    const buttons = (await waitFor(() => { const l = findTrackPlayButtons(id); return l.length ? l : null; }, 1500)) || [];
    const tried = [];
    for (const b of buttons.slice(0, 3)) {
      if (cancelled()) return CANCELLED;
      tried.push(labelOf(b));
      b.click();
      if (await waitFor(() => cancelled() || isPlaying(id), 4000)) {
        return cancelled() ? CANCELLED : { ok: true, via, method: 'track-button', button: labelOf(b) };
      }
    }
    if (cancelled()) return CANCELLED;

    // 2. Запасной путь: включить альбом и листать «следующий», пока не дойдём до нужного.
    //    Листаем, только пока играет этот альбом, и не по кругу.
    if (!albumId || location.pathname !== url) {
      return { ok: false, error: 'кнопка трека не сработала', via, tried };
    }
    const inAlbum = () => { const t = currentTrack(); return !!t && t.albumId === albumId; };
    if (!inAlbum()) {
      const btn = findPlayButton();
      if (!btn) return { ok: false, error: 'не нашёл кнопку воспроизведения на странице трека', via, tried };
      tried.push(labelOf(btn));
      btn.click();
      if (!(await waitFor(() => cancelled() || inAlbum(), 5000)) || cancelled()) {
        return cancelled() ? CANCELLED : { ok: false, error: 'альбом не включился', via, tried };
      }
    }
    if (!handlers.nexttrack) return { ok: isPlaying(id), via, method: 'album', tried };
    const seen = new Set();
    for (let skips = 0; skips < 30; skips++) {
      if (await waitFor(() => cancelled() || isPlaying(id), 1200)) {
        return cancelled() ? CANCELLED : { ok: true, via, method: 'album+next', skips, tried };
      }
      if (location.pathname !== url) return { ok: false, error: 'страницу сменили, перелистывание остановлено', via, tried };
      const t = currentTrack();
      if (!t || t.albumId !== albumId) return { ok: false, error: 'играет другой альбом, перелистывание остановлено', via, tried };
      if (seen.has(t.id)) return { ok: false, error: 'альбом пошёл по кругу, нужного трека нет', via, tried };
      seen.add(t.id);
      const before = metaKey(readMeta());
      handlers.nexttrack({ action: 'nexttrack' });
      await waitFor(() => metaKey(readMeta()) !== before, 3000);
    }
    return { ok: false, error: 'нужный трек не встретился в альбоме', via, tried };
  }

  function isPlaying(id) {
    const t = currentTrack();
    return !!t && t.id === String(id);
  }

  const linksTo = (a, id) => new RegExp(`/track/${id}(?:\\D|$)`).test(a.getAttribute('href') || '');

  function trackLinks(id) {
    return [...document.querySelectorAll(`a[href*="/track/${id}"]`)]
      .filter((a) => linksTo(a, id) && !inPlayerBar(a));
  }

  const labelOf = (b) => (b.getAttribute('aria-label') || b.textContent || '').trim();

  function hover(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
      el.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, opts) : new MouseEvent(type, opts));
    }
  }

  // Заголовки с названием трека: на странице трека справа открывается панель
  // «Трек: <название>» со своей кнопкой «Слушать» (видно на скриншоте от 6 октября).
  function titleNodes(id) {
    const t = known.get(String(id));
    if (!t || !t.title) return [];
    const want = norm(t.title);
    return [...document.querySelectorAll('h1, h2, h3, h4, [class*="title" i]')]
      .filter((el) => norm(el.textContent) === want && !inPlayerBar(el));
  }

  // Кнопки воспроизведения этого трека. От заголовка или ссылки на трек поднимаемся вверх,
  // пока в блоке нет ссылок на другие треки, и ищем в блоке кнопку воспроизведения.
  function findTrackPlayButtons(id) {
    const found = [];
    for (const start of [...titleNodes(id), ...trackLinks(id)]) {
      let block = start;
      for (let i = 0; i < 10 && block.parentElement; i++) {
        const parent = block.parentElement;
        const others = [...parent.querySelectorAll('a[href*="/track/"]')].some((x) => !linksTo(x, id));
        if (others) break;
        block = parent;
      }
      hover(block); // кнопка в строке может появляться только при наведении
      for (const b of block.querySelectorAll('button, [role="button"]')) {
        if (PLAY_LABEL.test(labelOf(b)) && visible(b) && !inPlayerBar(b) && !found.includes(b)) found.push(b);
      }
    }
    return found;
  }

  // ---------- 6. Команды ----------
  const api = () => window.externalAPI;

  const commands = {
    state() {
      const track = currentTrack();
      return {
        ok: true,
        track,
        next: nextTrack(track && track.id),
        ...snapshot(),
        hasMedia: !!activeMedia(),
      };
    },

    async pause() {
      const el = activeMedia();
      let via = 'audio';
      if (handlers.pause) { handlers.pause({ action: 'pause' }); via = 'mediaSession'; }
      else if (api() && api().togglePause) { if (api().isPlaying()) api().togglePause(); via = 'externalAPI'; }
      else if (el) el.pause();
      await sleep(300);
      if (el && !el.paused) { el.pause(); via += '+audio'; }
      return { ok: !el || el.paused, via };
    },

    async play() {
      const el = activeMedia();
      let via = 'audio';
      if (handlers.play) { handlers.play({ action: 'play' }); via = 'mediaSession'; }
      else if (api() && api().togglePause) { if (!api().isPlaying()) api().togglePause(); via = 'externalAPI'; }
      await sleep(400);
      if (el && el.paused) {
        try { await origPlay.call(el); via += '+audio'; }
        catch (e) {
          if (e.name === 'NotAllowedError') emit('autoplay-blocked');
          return { ok: false, error: e.name, via };
        }
      }
      return { ok: !!el && !el.paused, via };
    },

    async seek({ position }) {
      const el = activeMedia();
      let via = 'audio';
      if (handlers.seekto) { handlers.seekto({ action: 'seekto', seekTime: position, fastSeek: false }); via = 'mediaSession'; }
      else if (api() && api().setPosition) { api().setPosition(position); via = 'externalAPI'; }
      else if (el) el.currentTime = position;
      await sleep(300);
      if (el && Math.abs(el.currentTime - position) > 1.5) { el.currentTime = position; via += '+audio'; }
      return { ok: true, via };
    },

    next() {
      if (handlers.nexttrack) { handlers.nexttrack({ action: 'nexttrack' }); return { ok: true }; }
      if (api() && api().next) { api().next(); return { ok: true }; }
      return { ok: false };
    },

    prev() {
      if (handlers.previoustrack) { handlers.previoustrack({ action: 'previoustrack' }); return { ok: true }; }
      if (api() && api().prev) { api().prev(); return { ok: true }; }
      return { ok: false };
    },

    playTrack,

    diag() {
      const ext = api();
      const md = navigator.mediaSession && navigator.mediaSession.metadata;
      const btn = findPlayButton();
      const track = currentTrack();
      const meta = readMeta();
      return {
        ok: true,
        url: location.href,
        userAgent: navigator.userAgent,
        externalAPI: ext ? Object.keys(ext) : null,
        nextRouter: !!(window.next && window.next.router),
        media: [...media].map((a) => ({
          tag: a.tagName,
          current: a === current,
          paused: a.paused,
          time: +(a.currentTime || 0).toFixed(1),
          duration: +(a.duration || 0).toFixed(1),
          inDOM: a.isConnected,
          src: short(a.currentSrc || a.src),
        })),
        mediaSession: md ? { title: md.title, artist: md.artist, album: md.album } : null,
        handlers: Object.keys(handlers),
        track,
        next: nextTrack(track && track.id),
        idCandidates: meta ? {
          externalAPI: idsFromApi(),
          dom: idsFromDom(meta.title),
          api: idsFromIndex(meta),
          fileInfo: idsFromFileInfo(meta),
        } : null,
        tracksIndexed: known.size,
        fileInfo: fileInfo.slice(-10).map((f) => (f.batch ? 'batch ' : 'single ') + f.id),
        playerLinks: [...document.querySelectorAll('a[href*="/track/"]')]
          .filter(inPlayerBar)
          .map((a) => a.getAttribute('href'))
          .slice(0, 10),
        playButtonOnPage: btn ? labelOf(btn) : null,
        // на странице /album/A/track/T: какие кнопки воспроизведения этого трека нашлись
        trackPlayButtons: (() => {
          const m = location.pathname.match(ID_RE);
          if (!m) return 'не страница трека';
          return findTrackPlayButtons(m[2]).map((b) => labelOf(b) + ' <' + b.tagName.toLowerCase() + ' class="' + classOf(b) + '">');
        })(),
        requests: requests.slice(-25).map(short),
      };
    },
  };

  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data.source !== FROM_CS) return;
    const { id, cmd, args } = e.data;
    let result;
    try {
      result = commands[cmd] ? await commands[cmd](args || {}) : { ok: false, error: 'неизвестная команда ' + cmd };
    } catch (err) {
      result = { ok: false, error: String((err && err.message) || err) };
    }
    window.postMessage({ source: FROM_PAGE, type: 'reply', id, result }, location.origin);
  });

  // для ручной проверки из консоли
  window.ymJam = {
    diag: () => commands.diag(),
    state: () => commands.state(),
    pause: () => commands.pause(),
    play: () => commands.play(),
    seek: (s) => commands.seek({ position: s }),
    next: () => commands.next(),
    prev: () => commands.prev(),
    playTrack: (id, albumId) => playTrack({ id, albumId }),
  };
})();
