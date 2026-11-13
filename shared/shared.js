// Общее для content-скриптов, попапа и фонового скрипта: настройки по умолчанию, случайное имя, код комнаты.
// Подключается раньше остальных скриптов и объявляет глобальный YJam.

var YJam = (() => {
  const SERVER_URL = 'wss://sync.babushkin-jam.store';
  const OLD_LOCAL_SERVER = 'ws://localhost:8787'; // умолчание до настроек версии 2
  const OLD_PROD_SERVER = 'wss://141-11-197-57.sslip.io:8443'; // умолчание до настроек версии 3, тот VPS удалён
  const OLD_IP_SERVER = 'wss://141-11-197-134.sslip.io:9443'; // умолчание до настроек версии 4, адрес без домена
  const OLD_ROOT_SERVER = 'wss://babushkin-jam.store'; // умолчание до настроек версии 5, синхронизация переехала на поддомен
  const SETTINGS_VERSION = 5;

  const DEFAULTS = { serverUrl: SERVER_URL, name: '', room: '' };

  // Вкладки Яндекс Музыки — дублирует matches в manifest.json, при добавлении домена править оба места.
  const YM_URLS = [
    'https://*.music.yandex.ru/*',
    'https://*.music.yandex.com/*',
    'https://*.music.yandex.by/*',
    'https://*.music.yandex.kz/*',
  ];
  // «Виджет на всех сайтах» — необязательное разрешение (optional_host_permissions в manifest.json).
  const ALL_SITES = ['https://*/*', 'http://*/*'];

  const ANIMALS = [
    'Суслик', 'Волк', 'Ёж', 'Енот', 'Барсук', 'Лис', 'Бобр', 'Хомяк', 'Сурок', 'Тюлень',
    'Пингвин', 'Филин', 'Сова', 'Рысь', 'Медведь', 'Заяц', 'Олень', 'Лось', 'Кит', 'Дельфин',
    'Выдра', 'Белка', 'Бурундук', 'Панда', 'Коала', 'Ленивец', 'Капибара', 'Альпака', 'Лама', 'Жираф',
    'Зебра', 'Тигр', 'Лев', 'Гепард', 'Ягуар', 'Сокол', 'Ворон', 'Попугай', 'Фламинго', 'Тукан',
    'Хорёк', 'Ласка', 'Песец', 'Морж', 'Краб', 'Осьминог', 'Кальмар', 'Утконос', 'Броненосец', 'Муравьед',
  ];

  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function randomName() {
    return pick(ANIMALS);
  }

  function randomCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += pick(abc);
    return s;
  }

  const normalizeCode = (code) => String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

  // Сервис ссылок на песню.
  const LINKS_URL = 'https://share.babushkin-jam.store/';

  const SHORT_LINK_TIMEOUT_MS = 3000;

  function songPageParams({ artist, title, album, duration, id, albumId }) {
    const params = new URLSearchParams();
    if (artist) params.set('singer', artist);
    if (title) params.set('songname', title);
    if (album) params.set('album', album);
    if (duration > 0) params.set('duration', String(Math.round(duration)));
    if (/^\d+$/.test(id)) params.set('ym', /^\d+$/.test(albumId) ? `${albumId}/${id}` : id);
    return params;
  }

  const songPageUrl = (track) => LINKS_URL + '?' + songPageParams(track);

  // Короткая ссылка для копирования: share.babushkin-jam.store/Ab3dE9x. Сервис не ответил — отдаём длинную.
  async function shortSongPageUrl(track) {
    try {
      const res = await fetch(LINKS_URL + 'api/short?' + songPageParams(track), { signal: AbortSignal.timeout(SHORT_LINK_TIMEOUT_MS) });
      const { code } = res.ok ? await res.json() : {};
      if (/^[0-9A-Za-z]{7}$/.test(code)) return LINKS_URL + code;
    } catch (e) {}
    return songPageUrl(track);
  }

  const trackLink = ({ id, albumId }) =>
    'https://music.yandex.ru' + (albumId ? `/album/${albumId}/track/${id}` : `/track/${id}`);

  function inviteLink(code) {
    return `https://music.yandex.ru/?jam=${encodeURIComponent(code)}`;
  }

  // Дозаполняет настройки: случайное имя, сервер по умолчанию.
  // Старые адреса по умолчанию один раз меняются на общий сервер. Адрес, вписанный вручную, не трогаем:
  // localhost, вписанный уже после версии 2, остаётся.
  async function ensureSettings() {
    const s = await chrome.storage.local.get({ ...DEFAULTS, settingsVersion: 0 });
    const patch = {};
    if (!s.name) patch.name = randomName();
    const stale = (s.settingsVersion < 2 && s.serverUrl === OLD_LOCAL_SERVER)
      || (s.settingsVersion < 3 && s.serverUrl === OLD_PROD_SERVER)
      || (s.settingsVersion < 4 && s.serverUrl === OLD_IP_SERVER)
      || (s.settingsVersion < 5 && s.serverUrl === OLD_ROOT_SERVER);
    if (!s.serverUrl || stale) {
      patch.serverUrl = SERVER_URL;
    }
    if (s.settingsVersion !== SETTINGS_VERSION) patch.settingsVersion = SETTINGS_VERSION;
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
    return { serverUrl: s.serverUrl, name: s.name, room: s.room, ...patch };
  }

  // ---------- оформление: общее для попапа и панели на сайте ----------

  // Шрифты лежат в расширении (fonts/, лицензия OFL) — ни к каким CDN не ходим.
  // Регистрируем через FontFace: @font-face внутри Shadow DOM панели не работает.
  // Свои имена семейств, чтобы не пересечься со шрифтами сайта.
  const CYRILLIC = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116';
  const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, ' +
    'U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
  const FONTS = [
    ['YJam Golos', 'golos-cyrillic.woff2', '400 700', CYRILLIC],
    ['YJam Golos', 'golos-latin.woff2', '400 700', LATIN],
    ['YJam Mono', 'jbmono-cyrillic.woff2', '500 700', CYRILLIC],
    ['YJam Mono', 'jbmono-latin.woff2', '500 700', LATIN],
  ];

  let fontsLoaded = false;
  function loadFonts() {
    if (fontsLoaded || typeof FontFace === 'undefined') return;
    fontsLoaded = true;
    for (const [family, file, weight, unicodeRange] of FONTS) {
      try {
        const url = chrome.runtime.getURL('fonts/' + file);
        document.fonts.add(new FontFace(family, `url("${url}") format("woff2")`, { weight, unicodeRange }));
      } catch (e) {}
    }
  }

  // Цвет кружка участника — по его месту в списке комнаты, одинаково в попапе и на панели.
  const AVATAR_COLORS = ['#FFDB4D', '#8FD3FF', '#B9F28C', '#FFB38A', '#D9B8FF', '#FF9EC4', '#9EF0E0'];
  const avatarColor = (i) => AVATAR_COLORS[i % AVATAR_COLORS.length];
  const initial = (name) => (Array.from(String(name || '?').trim())[0] || '?').toUpperCase();

  // Локальная сборка (папка dist/extension/) называется «babushkin-jam (local)», в магазине — без приписки.
  const IS_LOCAL = /\(local\)/.test(chrome.runtime.getManifest().name);

  return {
    SERVER_URL, DEFAULTS, YM_URLS, ALL_SITES, randomName, randomCode, normalizeCode, inviteLink, songPageUrl, shortSongPageUrl, trackLink, ensureSettings,
    loadFonts, avatarColor, initial, IS_LOCAL,
  };
})();
