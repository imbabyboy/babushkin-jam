// Ссылка на песню, альбом или исполнителя на сервисе → параметры поиска (singer, songname, album, ym, duration).
// Дальше страница ищет по ним как по обычному тексту. Ходим только на известные адреса: ссылку присылает кто угодно.
import { ProviderUnavailable, getJson, splitArtistTitle } from './providers/common.js';
import { channelName, cleanTitle } from './providers/youtube.js';

export const MAX_LINK_LENGTH = 1000;

// Яндекс Музыка и Spotify отдают название в мета-тегах только ботам, браузеру — пустую заготовку под JS
// (проверено 26 ноября 2026, в том числе с VPS).
const BOT_HEADERS = { 'User-Agent': 'TelegramBot (like TwitterBot)', 'Accept-Language': 'ru' };
const YANDEX_HOST = /^music\.yandex\.(ru|com|by|kz|uz)$/;
const YOUTUBE_HOSTS = ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com'];
const SOUNDCLOUD_HOSTS = ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'];
// Короткие ссылки отвечают редиректом на обычную: идём по нему вручную и проверяем, куда он ведёт.
const SHORT_HOSTS = ['link.deezer.com', 'deezer.page.link', 'on.soundcloud.com'];
const ID = /^\d+$/;
const MEDIA_ID = /^[\w-]{6,40}$/;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (value) => String(value || '').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, code) => {
  if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
  return ENTITIES[code.toLowerCase()] ?? m;
});

// Пользователь вставляет ссылку как есть: без https://, с пробелами вокруг, с хвостом ?si=…
export function toUrl(text) {
  const value = String(text || '').trim();
  if (!value || value.length > MAX_LINK_LENGTH || /\s/.test(value)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    return /^https?:$/.test(url.protocol) && url.hostname.includes('.') ? url : null;
  } catch {
    return null;
  }
}

const segments = (url) => url.pathname.split('/').filter(Boolean);

// Разбор адреса без запросов в сеть. null — такие ссылки не понимаем.
export function parseLink(url) {
  const host = url.hostname.toLowerCase();
  const parts = segments(url);

  if (YANDEX_HOST.test(host)) {
    const [a, b, c, d] = parts;
    if (a === 'album' && ID.test(b) && c === 'track' && ID.test(d)) return { service: 'yandex', kind: 'track', path: `/album/${b}/track/${d}`, ym: `${b}/${d}` };
    if (a === 'track' && ID.test(b)) return { service: 'yandex', kind: 'track', path: `/track/${b}`, ym: b };
    if (a === 'album' && ID.test(b)) return { service: 'yandex', kind: 'album', path: `/album/${b}` };
    if (a === 'artist' && ID.test(b)) return { service: 'yandex', kind: 'artist', path: `/artist/${b}` };
    return null;
  }

  if (host === 'open.spotify.com') {
    const [type, id] = /^intl-/.test(parts[0] || '') ? parts.slice(1) : parts;
    return ['track', 'album', 'artist'].includes(type) && MEDIA_ID.test(id || '') ? { service: 'spotify', kind: type, id } : null;
  }

  if (host === 'music.apple.com' || host === 'itunes.apple.com') {
    const country = /^[a-z]{2}$/.test(parts[0] || '') ? parts[0] : 'us';
    const rest = country === parts[0] ? parts.slice(1) : parts;
    const type = rest[0];
    const id = (rest.at(-1) || '').replace(/^id/, '');
    if (!ID.test(id)) return null;
    const track = url.searchParams.get('i');
    if (type === 'album' && track && ID.test(track)) return { service: 'apple', kind: 'track', id: track, country };
    const kinds = { song: 'track', album: 'album', artist: 'artist' };
    return kinds[type] ? { service: 'apple', kind: kinds[type], id, country } : null;
  }

  if (host === 'www.deezer.com' || host === 'deezer.com') {
    const [type, id] = /^[a-z]{2}$/.test(parts[0] || '') ? parts.slice(1) : parts;
    return ['track', 'album', 'artist'].includes(type) && ID.test(id || '') ? { service: 'deezer', kind: type, id } : null;
  }

  if (host === 'youtu.be') return MEDIA_ID.test(parts[0] || '') ? { service: 'youtube', kind: 'track', id: parts[0] } : null;
  if (YOUTUBE_HOSTS.includes(host)) {
    const id = parts[0] === 'watch' ? url.searchParams.get('v') : ['shorts', 'live', 'embed'].includes(parts[0]) ? parts[1] : null;
    if (!MEDIA_ID.test(id || '')) return null;
    return { service: host === 'music.youtube.com' ? 'ytmusic' : 'youtube', kind: 'track', id };
  }

  if (SOUNDCLOUD_HOSTS.includes(host)) {
    const path = '/' + parts.join('/');
    if (parts.length === 2 && parts[1] !== 'sets') return { service: 'soundcloud', kind: 'track', path };
    if (parts.length === 3 && parts[1] === 'sets') return { service: 'soundcloud', kind: 'album', path };
    if (parts.length === 1) return { service: 'soundcloud', kind: 'artist', path };
    return null;
  }

  if (SHORT_HOSTS.includes(host)) return { service: 'short', kind: null, url: url.href };
  return null;
}

async function getBotPage(ctx, url) {
  const res = await ctx.fetch(url, { headers: BOT_HEADERS, signal: ctx.signal });
  if (res.status === 404) throw new ProviderUnavailable('not_found');
  if (!res.ok) throw new ProviderUnavailable('http_' + res.status);
  return res.text();
}

// Атрибуты встречаются в любом порядке: property="og:title" content="…" и наоборот.
export function metaTags(html) {
  const tags = {};
  for (const [tag] of html.matchAll(/<meta\s[^>]*>/gi)) {
    const name = tag.match(/\s(?:property|name)="([^"]+)"/i);
    const content = tag.match(/\scontent="([^"]*)"/i);
    if (name && content && !(name[1] in tags)) tags[name[1]] = decode(content[1]).trim();
  }
  return tags;
}

const firstPart = (value, separator) => String(value || '').split(separator)[0].trim();
const seconds = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : null);

async function yandex(link, ctx) {
  const meta = metaTags(await getBotPage(ctx, 'https://music.yandex.ru' + link.path));
  const title = meta['og:title'];
  // Описание: «Исполнитель • Трек • 2026» или «Исполнитель • Альбом • 2019».
  const singer = firstPart(meta['og:description'], ' • ');
  if (!title) throw new ProviderUnavailable('page_changed');
  if (link.kind === 'track') return { singer, songname: title, ym: link.ym };
  if (link.kind === 'album') return { singer, album: title };
  return { singer: title };
}

async function spotify(link, ctx) {
  const meta = metaTags(await getBotPage(ctx, `https://open.spotify.com/${link.kind}/${link.id}`));
  const title = meta['og:title'];
  if (!title) throw new ProviderUnavailable('page_changed');
  // Описание: «Исполнитель · Альбом · Song · 1987» у трека, «Исполнитель · album · 1987 · 10 songs» у альбома.
  const singer = meta['music:musician_description'] || firstPart(meta['og:description'], ' · ');
  if (link.kind === 'track') return { singer, songname: title, duration: seconds(Number(meta['music:duration'])) };
  if (link.kind === 'album') {
    const name = title.match(/^(?:Listen to )?(.+?) - (?:Album|Single|EP|Compilation) by .+$/);
    return { singer, album: name ? name[1] : title.replace(/\s*\|\s*Spotify$/, '') };
  }
  return { singer: title };
}

async function apple(link, ctx) {
  const params = new URLSearchParams({ id: link.id, country: link.country });
  const data = await getJson(ctx, `https://itunes.apple.com/lookup?${params}`);
  const item = (data.results || [])[0];
  if (!item) throw new ProviderUnavailable('not_found');
  if (link.kind === 'track') {
    return { singer: item.artistName, songname: item.trackName, album: item.collectionName, duration: seconds(item.trackTimeMillis / 1000) };
  }
  if (link.kind === 'album') return { singer: item.artistName, album: item.collectionName };
  return { singer: item.artistName };
}

async function deezer(link, ctx) {
  const data = await getJson(ctx, `https://api.deezer.com/${link.kind}/${link.id}`);
  // Deezer отвечает 200 и на несуществующий номер, ошибка — в теле.
  if (data.error) throw new ProviderUnavailable('not_found');
  const singer = data.artist && data.artist.name;
  if (link.kind === 'track') return { singer, songname: data.title, album: data.album && data.album.title, duration: seconds(data.duration) };
  if (link.kind === 'album') return { singer, album: data.title };
  return { singer: data.name };
}

async function youtube(link, ctx) {
  const watch = `https://www.youtube.com/watch?v=${link.id}`;
  const data = await getJson(ctx, `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`);
  // Скобки у клипов — почти всегда «(Official Video)», «[4K Remaster]» и подобное: для поиска они лишние.
  const title = cleanTitle(decode(data.title).replace(/\s*[([][^)\]]*[)\]]/g, ' '));
  const split = splitArtistTitle(title);
  if (split) return { singer: split.artist, songname: split.title };
  // Канал «Исполнитель - Topic» и VEVO — сам исполнитель. У остальных каналов имя может быть любым.
  const author = String(data.author_name || '');
  if (/\s+-\s+topic$/i.test(author) || /VEVO$/.test(author)) return { singer: channelName(author), songname: title };
  return { q: title };
}

async function soundcloud(link, ctx) {
  const page = 'https://soundcloud.com' + link.path;
  const data = await getJson(ctx, `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(page)}`);
  const author = decode(data.author_name).trim();
  if (link.kind === 'artist') return { singer: author };
  // Заголовок: «Песня by Автор». Загружают как угодно: исполнитель бывает и в начале названия.
  const by = ' by ' + author;
  const raw = decode(data.title).trim();
  const name = raw.endsWith(by) ? raw.slice(0, -by.length).trim() : raw;
  const split = splitArtistTitle(name);
  const singer = split ? split.artist : author;
  const title = split ? split.title : name;
  return link.kind === 'album' ? { singer, album: title } : { singer, songname: title };
}

const RESOLVERS = { yandex, spotify, apple, deezer, youtube, ytmusic: youtube, soundcloud };

// Адрес, собранный заново из разобранных частей: в результат попадает только он, а не то, что прислали.
const APPLE_PATHS = { track: 'song', album: 'album', artist: 'artist' };
const CANONICAL = {
  yandex: (l) => 'https://music.yandex.ru' + l.path,
  spotify: (l) => `https://open.spotify.com/${l.kind}/${l.id}`,
  apple: (l) => `https://music.apple.com/${l.country}/${APPLE_PATHS[l.kind]}/${l.id}`,
  deezer: (l) => `https://www.deezer.com/${l.kind}/${l.id}`,
  youtube: (l) => `https://www.youtube.com/watch?v=${l.id}`,
  ytmusic: (l) => `https://music.youtube.com/watch?v=${l.id}`,
  soundcloud: (l) => 'https://soundcloud.com' + l.path,
};

// Ссылка-источник: строка её сервиса на странице сразу «найдена». Короткие ссылки не годятся — в адрес
// страницы попадает уже обычная. null — ссылку не понимаем.
export function sourceLink(text) {
  const url = toUrl(text);
  const link = url && parseLink(url);
  if (!link || !CANONICAL[link.service]) return null;
  return { service: link.service, kind: link.kind, url: CANONICAL[link.service](link) };
}

async function followShort(link, ctx) {
  const res = await ctx.fetch(link.url, { redirect: 'manual', headers: BOT_HEADERS, signal: ctx.signal });
  const location = res.headers && res.headers.get('location');
  const target = location && toUrl(new URL(location, link.url).href);
  const parsed = target && parseLink(target);
  if (!parsed || parsed.service === 'short') throw new ProviderUnavailable('unknown_link');
  return parsed;
}

const clean = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);

const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// run(text) возвращает { service, kind, query } или бросает ProviderUnavailable: unknown_link — ссылку не понимаем.
// Ответ кэшируем по разобранной ссылке: хвосты вроде ?si=… на него не влияют.
export function createResolver({ cache, doFetch, timeoutMs }) {
  return {
    async run(text) {
      const url = toUrl(text);
      let link = url && parseLink(url);
      if (!link) throw new ProviderUnavailable('unknown_link');
      const ctx = { fetch: doFetch, signal: AbortSignal.timeout(timeoutMs) };
      if (link.service === 'short') link = await followShort(link, ctx);
      const key = 'link:' + JSON.stringify(link);
      const hit = cache.get(key);
      if (hit) return hit;
      const found = await RESOLVERS[link.service](link, ctx);
      // У трека Яндекса ссылку и так строит ym.
      if (!(link.service === 'yandex' && link.kind === 'track')) found.link = CANONICAL[link.service](link);
      const query = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, clean(v)]).filter(([, v]) => v));
      if (!query.songname && !query.album && !query.singer && !query.q) throw new ProviderUnavailable('page_changed');
      const result = { service: link.service, kind: link.kind, query };
      cache.set(key, result, LINK_TTL_MS);
      return result;
    },
  };
}
