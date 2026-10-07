// Проверка плеера Яндекс Музыки для будущего расширения "джем".
// Как запускать: открыть music.yandex.ru, включить любой трек,
// F12 -> Console, вставить весь этот файл и нажать Enter.
// Скрипт ничего никуда не отправляет, только пишет в консоль.

(() => {
  if (window.ymProbe) {
    console.log('[jam-probe] уже запущен, вызови ymProbe.report()');
    return;
  }

  const log = (...a) =>
    console.log('%c[jam-probe]', 'color:#e6a700;font-weight:bold', ...a);

  const audios = new Set();     // найденные <audio>/<video>
  const requests = [];          // интересные сетевые запросы
  const handlers = {};          // обработчики mediaSession (next/prev и т.д.)
  const short = (s) => (s && s.length > 90 ? s.slice(0, 90) + '…' : s);

  // ---------- 1. Медиа-элементы ----------
  // Плеер может создавать Audio без вставки в DOM, поэтому ловим через play().
  function track(el, how) {
    if (audios.has(el)) return;
    audios.add(el);
    log('найден медиа-элемент (' + how + ')', el.tagName, short(el.currentSrc || el.src));
    for (const ev of ['play', 'pause', 'seeked', 'ended', 'loadedmetadata']) {
      el.addEventListener(ev, () =>
        log('событие ' + ev, {
          time: +el.currentTime.toFixed(1),
          duration: +(el.duration || 0).toFixed(1),
          paused: el.paused,
          src: short(el.currentSrc || el.src),
        })
      );
    }
  }

  const proto = HTMLMediaElement.prototype;
  const origPlay = proto.play;
  proto.play = function (...args) {
    track(this, 'перехват play');
    return origPlay.apply(this, args);
  };
  document.querySelectorAll('audio, video').forEach((el) => track(el, 'из DOM'));

  // ---------- 2. Media Session ----------
  // Смена metadata = смена трека. Обработчики дают кнопки next/prev.
  const ms = navigator.mediaSession;
  if (ms) {
    try {
      const desc = Object.getOwnPropertyDescriptor(MediaSession.prototype, 'metadata');
      Object.defineProperty(ms, 'metadata', {
        configurable: true,
        get() { return desc.get.call(ms); },
        set(v) {
          desc.set.call(ms, v);
          if (v) log('СМЕНА ТРЕКА (mediaSession)', {
            title: v.title, artist: v.artist, album: v.album,
            artwork: v.artwork && v.artwork[0] && v.artwork[0].src,
          });
        },
      });
    } catch (e) {
      log('не удалось перехватить metadata:', e.message);
    }

    const origSet = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action, fn) => {
      handlers[action] = fn;
      log('сайт зарегистрировал обработчик mediaSession:', action);
      return origSet(action, fn);
    };
  }

  // ---------- 3. Сеть ----------
  // Ищем запросы, где видны id трека и очередь.
  const INTERESTING = /track|queue|plays|file-info|rotor|station/i;
  function noteRequest(method, url) {
    url = String(url);
    if (!INTERESTING.test(url)) return;
    requests.push(method + ' ' + url);
    if (requests.length > 60) requests.shift();
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      noteRequest((init && init.method) || (input && input.method) || 'GET', url);
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { noteRequest(method, url); } catch (e) {}
    return origOpen.apply(this, arguments);
  };

  // ---------- 4. Вспомогательное ----------
  function activeAudio() {
    const list = [...audios];
    return list.find((a) => !a.paused) || list.find((a) => a.currentSrc || a.src) || null;
  }

  function trackLinks() {
    // Ссылки на трек/альбом в панели плеера — оттуда берётся id трека.
    const out = new Set();
    document.querySelectorAll('a[href*="/track/"], a[href*="/album/"]').forEach((a) => {
      let p = a;
      for (let i = 0; i < 8 && p; i++, p = p.parentElement) {
        const cls = typeof p.className === 'string' ? p.className : '';
        if (/player/i.test(cls)) { out.add(a.getAttribute('href')); break; }
      }
    });
    return [...out];
  }

  // ---------- 5. Отчёт и управление ----------
  window.ymProbe = {
    report() {
      console.log('========== JAM PROBE: ОТЧЁТ ==========');

      const api = window.externalAPI;
      console.log('1) externalAPI:', api ? 'ЕСТЬ' : 'нет');
      if (api) {
        console.log('   методы:', Object.keys(api).join(', '));
        try { console.log('   getCurrentTrack:', api.getCurrentTrack && api.getCurrentTrack()); } catch (e) { console.log('   ошибка:', e.message); }
        try { console.log('   getProgress:', api.getProgress && api.getProgress()); } catch (e) {}
        try { console.log('   isPlaying:', api.isPlaying && api.isPlaying()); } catch (e) {}
      }

      console.log('2) медиа-элементов найдено:', audios.size);
      [...audios].forEach((a, i) =>
        console.log('   #' + i, {
          paused: a.paused,
          time: +a.currentTime.toFixed(1),
          duration: +(a.duration || 0).toFixed(1),
          inDOM: a.isConnected,
          src: short(a.currentSrc || a.src),
        })
      );

      const md = ms && ms.metadata;
      console.log('3) mediaSession.metadata:', md
        ? { title: md.title, artist: md.artist, album: md.album }
        : 'пусто');
      console.log('   перехваченные обработчики:', Object.keys(handlers).join(', ') || 'нет (переключи трек и повтори)');

      console.log('4) ссылки на трек в панели плеера:', trackLinks());
      console.log('   адрес страницы:', location.href);

      console.log('5) последние запросы (' + requests.length + '):');
      requests.slice(-25).forEach((r) => console.log('   ' + short(r)));

      console.log('======================================');
      console.log('Скопируй всё от первой до последней строки === и пришли.');
    },

    pause() {
      const a = activeAudio();
      if (!a) return log('медиа-элемент не найден');
      a.pause();
      log('pause() вызван — музыка остановилась? кнопка на сайте изменилась?');
    },

    play() {
      const a = activeAudio();
      if (!a) return log('медиа-элемент не найден');
      a.play().then(
        () => log('play() сработал'),
        (e) => log('play() отклонён:', e.message)
      );
    },

    seek(sec) {
      const a = activeAudio();
      if (!a) return log('медиа-элемент не найден');
      a.currentTime = sec;
      log('перемотка на ' + sec + ' с — ползунок на сайте сдвинулся?');
    },

    next() {
      if (handlers.nexttrack) { handlers.nexttrack({ action: 'nexttrack' }); return log('next через mediaSession'); }
      if (window.externalAPI && window.externalAPI.next) { window.externalAPI.next(); return log('next через externalAPI'); }
      log('не знаю, как переключить: обработчик не перехвачен');
    },

    prev() {
      if (handlers.previoustrack) { handlers.previoustrack({ action: 'previoustrack' }); return log('prev через mediaSession'); }
      if (window.externalAPI && window.externalAPI.prev) { window.externalAPI.prev(); return log('prev через externalAPI'); }
      log('не знаю, как переключить: обработчик не перехвачен');
    },
  };

  log('запущен. Дальше: 1) переключи трек вручную, 2) поставь паузу и сними,');
  log('3) перемотай, 4) вызови ymProbe.report()');
  log('потом попробуй ymProbe.pause(), ymProbe.play(), ymProbe.seek(60), ymProbe.next()');
})();
