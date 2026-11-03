// У YouTube Music нет публичного API поиска, поэтому разбираем его страницу. Условия сервиса автоматический
// доступ запрещают (см. PAGE_SEARCH в config.js). В отличие от обычного YouTube, здесь есть сами треки: песня
// исполнителя, а не чужая загрузка или клип. Разметка проверена по ответам от 3 ноября 2026.
import { ProviderUnavailable, getPage, partial } from './common.js';

const BASE = 'https://music.youtube.com';
const SEARCH_BLOCK = /initialData\.push\(\{path:\s*'\\\/search',\s*params:[\s\S]*?,\s*data:\s*'((?:[^'\\]|\\.)*)'\}\)/;
const SEPARATOR = ' • ';
const DURATION = /^\d+(:\d+)+$/;
const COUNTER = /\b(plays|views|monthly audience|subscribers)\b/i;
const ALBUM_TYPES = /^(album|single|ep)$/i;

// Данные лежат внутри строки JS: сначала разбираем её экранирование, потом сам JSON.
const unescapeJs = (value) => value.replace(/\\(x[0-9a-fA-F]{2}|[\s\S])/g, (_, code) => (
  code[0] === 'x' && code.length === 3 ? String.fromCharCode(parseInt(code.slice(1), 16)) : code
));

const joinRuns = (value) => ((value && value.runs) || []).map((r) => r.text).join('');
const lastThumbnail = (owner) => {
  const list = owner && owner.musicThumbnailRenderer && owner.musicThumbnailRenderer.thumbnail.thumbnails;
  return list && list.length ? list[list.length - 1].url : undefined;
};
const seconds = (label) => label.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
const hasExplicitBadge = (badges) => JSON.stringify(badges || []).includes('MUSIC_EXPLICIT_BADGE');

// «Song • kizaru • 3:00»: тип, исполнитель и длительность. Внутри карточки исполнителя его имя опущено.
function readSubtitle(text) {
  const [type = '', ...rest] = text.split(SEPARATOR).map((part) => part.trim());
  const artists = rest.filter((part) => !DURATION.test(part) && !COUNTER.test(part) && !/^\d{4}$/.test(part));
  const length = rest.find((part) => DURATION.test(part));
  return { type, artist: artists[0] || '', duration: length ? seconds(length) : null };
}

function toCandidate({ title, subtitle, videoId, browseId, cover, explicit, fallbackArtist }) {
  const { type, artist, duration } = readSubtitle(subtitle);
  const artists = [artist || fallbackArtist].filter(Boolean);
  if (videoId && /^(song|video)$/i.test(type)) {
    return {
      kind: 'track',
      url: `${BASE}/watch?v=${videoId}`,
      title,
      artists,
      duration,
      explicit,
      official: /^song$/i.test(type), // настоящий трек важнее клипа и чужой загрузки
      isVideo: /^video$/i.test(type),
      cover,
    };
  }
  if (browseId && ALBUM_TYPES.test(type)) {
    return { kind: 'album', url: `${BASE}/browse/${browseId}`, title, artists, explicit, cover };
  }
  if (browseId && /^artist$/i.test(type)) {
    return { kind: 'artist', url: `${BASE}/channel/${browseId}`, title, artists: [title], cover };
  }
  return null;
}

function readRow(row, fallbackArtist) {
  const columns = (row.flexColumns || []).map((c) => joinRuns(c.musicResponsiveListItemFlexColumnRenderer.text));
  const browse = row.navigationEndpoint && row.navigationEndpoint.browseEndpoint;
  return toCandidate({
    title: columns[0] || '',
    subtitle: columns.slice(1).join(SEPARATOR),
    videoId: row.playlistItemData && row.playlistItemData.videoId,
    browseId: browse && browse.browseId,
    cover: lastThumbnail(row.thumbnail),
    explicit: hasExplicitBadge(row.badges),
    fallbackArtist,
  });
}

function readCard(card) {
  const run = (card.title && card.title.runs && card.title.runs[0]) || {};
  const endpoint = run.navigationEndpoint || {};
  return toCandidate({
    title: joinRuns(card.title),
    subtitle: joinRuns(card.subtitle),
    videoId: endpoint.watchEndpoint && endpoint.watchEndpoint.videoId,
    browseId: endpoint.browseEndpoint && endpoint.browseEndpoint.browseId,
    cover: lastThumbnail(card.thumbnail),
    explicit: hasExplicitBadge(card.subtitleBadges),
  });
}

function collect(value, found, fallbackArtist, budget) {
  if (!value || typeof value !== 'object' || --budget.left < 0) return;
  if (value.musicCardShelfRenderer) {
    const card = readCard(value.musicCardShelfRenderer);
    if (card) found.push(card);
    // Строки под карточкой исполнителя — его песни, имя в них не повторяется.
    const owner = card && card.kind === 'artist' ? card.title : fallbackArtist;
    collect(value.musicCardShelfRenderer.contents, found, owner, budget);
    return;
  }
  if (value.musicResponsiveListItemRenderer) {
    const row = readRow(value.musicResponsiveListItemRenderer, fallbackArtist);
    if (row) found.push(row);
    return;
  }
  for (const key in value) collect(value[key], found, fallbackArtist, budget);
}

export function parseSearchPage(html) {
  const block = html.match(SEARCH_BLOCK);
  if (!block) throw new ProviderUnavailable('blocked');
  let data;
  try {
    data = JSON.parse(unescapeJs(block[1]));
  } catch {
    throw new ProviderUnavailable('page_changed');
  }
  const found = [];
  collect(data, found, '', { left: 200000 });
  return found;
}

function term(query) {
  if (query.q) return query.q;
  return [query.singer, query.kind === 'album' ? query.album : query.songname].filter(Boolean).join(' ');
}

export function ytmusic(config, pageBudget) {
  return {
    id: 'ytmusic',
    hosts: ['music.youtube.com'],
    searchUrl: (text) => `${BASE}/search?q=${encodeURIComponent(text)}`,
    cached: true,
    async search(query, ctx) {
      if (!config.pageSearch) throw new ProviderUnavailable('page_search_off');
      if (!pageBudget.take()) throw new ProviderUnavailable('quota');
      const html = await getPage(ctx, `${BASE}/search?q=${encodeURIComponent(term(query))}`);
      return partial(parseSearchPage(html).filter((c) => c.kind === query.kind));
    },
  };
}
