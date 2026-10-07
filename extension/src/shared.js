// Общее для content-скриптов и попапа: настройки по умолчанию, случайное имя, код комнаты.
// Подключается раньше остальных скриптов и объявляет глобальный YJam.

var YJam = (() => {
  const SERVER_URL = 'wss://141-11-197-57.sslip.io:8443';
  const OLD_DEFAULT_SERVER = 'ws://localhost:8787';
  const SETTINGS_VERSION = 2;

  const DEFAULTS = { serverUrl: SERVER_URL, name: '', room: '' };

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

  function inviteLink(code) {
    return `https://music.yandex.ru/?jam=${encodeURIComponent(code)}`;
  }

  // Дозаполняет настройки: случайное имя, сервер по умолчанию.
  // Старый адрес localhost из прошлых версий один раз меняется на общий сервер.
  async function ensureSettings() {
    const s = await chrome.storage.local.get({ ...DEFAULTS, settingsVersion: 0 });
    const patch = {};
    if (!s.name) patch.name = randomName();
    if (!s.serverUrl || (s.settingsVersion < SETTINGS_VERSION && s.serverUrl === OLD_DEFAULT_SERVER)) {
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

  // Локальная сборка (папка extension/) называется «babushkin-jam (local)», в магазине — без приписки.
  const IS_LOCAL = /\(local\)/.test(chrome.runtime.getManifest().name);

  return {
    SERVER_URL, DEFAULTS, randomName, randomCode, normalizeCode, inviteLink, ensureSettings,
    loadFonts, avatarColor, initial, IS_LOCAL,
  };
})();
