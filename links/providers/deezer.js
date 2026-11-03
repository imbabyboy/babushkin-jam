// Публичный API без ключа.
import { getJson } from './common.js';

const API = 'https://api.deezer.com/search';
// Обычный текст, а не artist:"…" track:"…": строгий запрос не находил даже известные песни (Hey Jude, TROOPER).
// Лишнее отсеивает match.js.
function searchText(query) {
  if (query.q) return query.q;
  return [query.singer, query.kind === 'album' ? query.album : query.songname].filter(Boolean).join(' ');
}

const PATHS = { track: 'track', album: 'album', artist: 'artist' };

function toCandidate(kind, item) {
  if (kind === 'artist') return { url: item.link, title: item.name, artists: [item.name], cover: item.picture_medium };
  if (kind === 'album') {
    return {
      url: item.link, title: item.title, artists: item.artist ? [item.artist.name] : [],
      explicit: !!item.explicit_lyrics, cover: item.cover_medium,
    };
  }
  return {
    url: item.link,
    title: item.title,
    version: item.title_version,
    artists: item.artist ? [item.artist.name] : [],
    album: item.album && item.album.title,
    duration: item.duration,
    explicit: !!item.explicit_lyrics,
    cover: item.album && item.album.cover_medium,
  };
}

export function deezer() {
  return {
    id: 'deezer',
    hosts: ['www.deezer.com'],
    searchUrl: (text) => `https://www.deezer.com/search/${encodeURIComponent(text)}`,
    cached: true,
    async search(query, ctx) {
      const url = `${API}/${PATHS[query.kind]}?limit=15&q=${encodeURIComponent(searchText(query))}`;
      const data = await getJson(ctx, url);
      return (data.data || []).map((item) => toCandidate(query.kind, item));
    },
  };
}
