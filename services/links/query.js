// Разбор параметров ссылки. Неизвестные параметры игнорируем, чтобы старые ссылки не ломались.
const MAX_LENGTH = 200;
const MAX_DURATION_SEC = 36000;

function text(params, name) {
  return (params.get(name) || '').trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH);
}

function integer(params, name, min, max) {
  const value = Number(params.get(name));
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function parseQuery(params) {
  const query = {
    q: text(params, 'q'),
    singer: text(params, 'singer'),
    songname: text(params, 'songname'),
    album: text(params, 'album'),
    year: integer(params, 'year', 1000, 3000),
    duration: integer(params, 'duration', 1, MAX_DURATION_SEC),
    ym: /^(\d+\/)?\d+$/.test(params.get('ym') || '') ? params.get('ym') : '',
  };
  query.kind = kindOf(query);
  return query;
}

function kindOf({ q, singer, songname, album }) {
  if (songname || q) return 'track';
  if (album) return 'album';
  if (singer) return 'artist';
  return null;
}

// Что подпись на странице и в карточке Telegram говорит об этом запросе.
export function describe(query) {
  const name = query.songname || query.album || query.q;
  return [query.singer, name].filter(Boolean).join(' — ');
}

// Текст для поиска на самом сервисе.
export function searchText({ q, singer, songname, album, kind }) {
  return q || [singer, kind === 'album' ? album : songname].filter(Boolean).join(' ');
}

export const cacheKey = ({ kind, q, singer, songname, album, year, duration }) =>
  JSON.stringify([kind, q, singer, songname, album, year, duration]).toLowerCase();
