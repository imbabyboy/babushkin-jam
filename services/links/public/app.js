// Страница сервиса: читает параметры из адреса, спрашивает API и показывает ссылки.
(() => {
  const SERVICES = {
    yandex: 'Яндекс Музыка',
    spotify: 'Spotify',
    apple: 'Apple Music',
    deezer: 'Deezer',
    soundcloud: 'SoundCloud',
    youtube: 'YouTube',
    ytmusic: 'YouTube Music',
  };
  const QUERY_PARAMS = ['q', 'singer', 'songname', 'album', 'year', 'duration', 'ym'];
  const COPIED_MS = 1200;
  const SHORT_PATH = /\/[0-9A-Za-z]{7}$/;
  const $ = (id) => document.getElementById(id);
  let requestId = 0;
  let shortening = Promise.resolve();

  // На короткой ссылке параметров в адресе нет: при переходах по истории они в history.state,
  // при первом открытии — в мета-теге от сервера.
  function params() {
    if (location.search) return new URLSearchParams(location.search);
    if (history.state && history.state.search) return new URLSearchParams(history.state.search);
    const meta = document.querySelector('meta[name="song-query"]');
    return new URLSearchParams(meta && SHORT_PATH.test(location.pathname) ? meta.content : '');
  }
  const hasText = (p) => ['q', 'singer', 'songname', 'album'].some((name) => p.get(name));

  function queryLine(p) {
    return p.get('q') || [p.get('singer'), p.get('songname') || p.get('album')].filter(Boolean).join(' ');
  }

  function showStatus(text) {
    $('status').textContent = text;
    $('status').hidden = !text;
  }

  async function copy(text, button) {
    await navigator.clipboard.writeText(text);
    const label = button.textContent;
    button.textContent = 'Скопировано';
    button.disabled = true;
    setTimeout(() => {
      button.textContent = label;
      button.disabled = false;
    }, COPIED_MS);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function serviceRow(result) {
    const li = element('li', 'service');
    const name = element('span', 'service-name', SERVICES[result.service] || result.service);
    if (result.explicit) {
      const mark = element('span', 'explicit', 'E');
      mark.title = 'Версия без цензуры';
      name.append(mark);
    }
    // Сервис отдал только версию с цензурой: лучше предупредить, чем выдать её за оригинал.
    if (result.clean) {
      const mark = element('span', 'clean', 'с цензурой');
      mark.title = 'Другой версии сервис не отдал';
      name.append(mark);
    }
    li.append(name);

    if (result.status === 'found') {
      const actions = element('span', 'actions');
      const open = element('a', 'open', 'Открыть');
      open.href = result.url;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      const copyButton = element('button', 'ghost', 'Скопировать');
      copyButton.type = 'button';
      copyButton.onclick = () => copy(result.url, copyButton);
      actions.append(open, copyButton);
      li.append(actions);
    } else if (result.searchUrl) {
      // Сервис не проверяли: прочерк соврал бы, что песни там нет.
      const find = element('a', 'find', 'Искать');
      find.href = result.searchUrl;
      find.target = '_blank';
      find.rel = 'noopener noreferrer';
      find.title = 'Проверить этот сервис не удалось: откроется поиск на нём';
      li.append(find);
    } else {
      li.append(element('span', 'dash', '—'));
    }
    return li;
  }

  function renderResult(data) {
    $('title').textContent = data.title || '';
    $('artist').textContent = data.artist || '';
    $('cover').hidden = !data.cover;
    if (data.cover) $('cover').src = data.cover;
    else $('cover').removeAttribute('src');
    $('services').replaceChildren(...data.results.map(serviceRow));
    $('result').hidden = false;
  }

  // Длинный адрес с параметрами меняем на короткий, чтобы делиться было удобно. Не вышло — остаётся длинный.
  async function shorten(search, id) {
    try {
      const res = await fetch('api/short?' + search);
      if (!res.ok) return;
      const { code } = await res.json();
      if (id === requestId && SHORT_PATH.test('/' + code)) history.replaceState({ search: String(search) }, '', code);
    } catch {}
  }

  async function load() {
    const p = params();
    const id = ++requestId;
    $('q').value = queryLine(p);
    $('result').hidden = true;
    if (!hasText(p)) {
      showStatus('');
      return;
    }
    showStatus('Ищем на сервисах…');
    const search = new URLSearchParams();
    for (const name of QUERY_PARAMS) if (p.get(name)) search.set(name, p.get(name));
    shortening = location.search ? shorten(search, id) : Promise.resolve();
    try {
      const res = await fetch('api/search?' + search);
      const data = await res.json();
      if (id !== requestId) return; // пока ждали, начали новый поиск
      if (!res.ok) {
        showStatus(data.error || 'Не получилось выполнить поиск');
        return;
      }
      showStatus('');
      renderResult(data);
    } catch {
      if (id === requestId) showStatus('Не получилось выполнить поиск. Проверьте интернет и попробуйте ещё раз.');
    }
  }

  $('form').onsubmit = (e) => {
    e.preventDefault();
    const text = $('q').value.trim();
    // С короткой ссылки уходим на корень сервиса, иначе пустой поиск снова покажет её песню.
    const base = location.pathname.replace(SHORT_PATH, '/');
    history.pushState(null, '', base + (text ? '?' + new URLSearchParams({ q: text }) : ''));
    load();
  };
  $('share').onclick = async (e) => {
    const button = e.currentTarget;
    await shortening;
    copy(location.href, button);
  };
  window.addEventListener('popstate', load);
  load();
})();
