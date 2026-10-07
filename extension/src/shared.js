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

  return { SERVER_URL, DEFAULTS, randomName, randomCode, normalizeCode, inviteLink, ensureSettings };
})();
