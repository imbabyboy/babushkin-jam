// iTunes Search API без ключа, около 20 запросов в минуту. explicit=Yes: песни с ненормативной лексикой не скрываем.
import { getJson } from './common.js';

const ENTITIES = { track: 'song', album: 'album', artist: 'musicArtist' };

function term(query) {
  if (query.q) return query.q;
  return [query.singer, query.kind === 'album' ? query.album : query.songname].filter(Boolean).join(' ');
}

const bigCover = (url) => url && url.replace('100x100bb', '300x300bb');

function toCandidate(kind, item) {
  if (kind === 'artist') return { url: item.artistLinkUrl, title: item.artistName, artists: [item.artistName] };
  if (kind === 'album') {
    return {
      url: item.collectionViewUrl, title: item.collectionName, artists: [item.artistName],
      explicit: item.collectionExplicitness === 'explicit', clean: item.collectionExplicitness === 'cleaned',
      cover: bigCover(item.artworkUrl100),
    };
  }
  return {
    url: item.trackViewUrl,
    title: item.trackName,
    artists: [item.artistName],
    album: item.collectionName,
    duration: item.trackTimeMillis ? item.trackTimeMillis / 1000 : null,
    explicit: item.trackExplicitness === 'explicit',
    clean: item.trackExplicitness === 'cleaned',
    cover: bigCover(item.artworkUrl100),
  };
}

export function apple(config) {
  return {
    id: 'apple',
    hosts: ['music.apple.com'],
    searchUrl: (text) => `https://music.apple.com/search?term=${encodeURIComponent(text)}`,
    cached: true,
    async search(query, ctx) {
      const params = new URLSearchParams({
        term: term(query), entity: ENTITIES[query.kind], limit: '15', explicit: 'Yes', country: config.appleCountry,
      });
      const data = await getJson(ctx, `https://itunes.apple.com/search?${params}`);
      return (data.results || []).map((item) => toCandidate(query.kind, item));
    },
  };
}
