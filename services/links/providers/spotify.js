// Web API, токен client credentials. По документации, на живом API не проверено: ключа пока нет.
import { ProviderUnavailable, clientCredentials, getJson } from './common.js';

function searchText(query) {
  if (query.q) return query.q;
  const parts = [];
  if (query.kind === 'track') parts.push(`track:"${query.songname}"`);
  if (query.kind === 'album') parts.push(`album:"${query.album}"`);
  if (query.singer) parts.push(`artist:"${query.singer}"`);
  return parts.join(' ');
}

const firstImage = (images) => images && images[0] && images[0].url;

function toCandidate(kind, item) {
  const url = item.external_urls && item.external_urls.spotify;
  if (kind === 'artist') return { url, title: item.name, artists: [item.name], cover: firstImage(item.images) };
  const artists = (item.artists || []).map((a) => a.name);
  if (kind === 'album') return { url, title: item.name, artists, cover: firstImage(item.images) };
  return {
    url,
    title: item.name,
    artists,
    album: item.album && item.album.name,
    duration: item.duration_ms ? item.duration_ms / 1000 : null,
    explicit: !!item.explicit,
    cover: item.album && firstImage(item.album.images),
  };
}

export function spotify(config, doFetch) {
  const configured = config.spotifyClientId && config.spotifyClientSecret;
  const token = configured && clientCredentials({
    tokenUrl: 'https://accounts.spotify.com/api/token',
    clientId: config.spotifyClientId,
    clientSecret: config.spotifyClientSecret,
    fetch: doFetch,
  });
  return {
    id: 'spotify',
    hosts: ['open.spotify.com'],
    searchUrl: (text) => `https://open.spotify.com/search/${encodeURIComponent(text)}`,
    cached: true,
    async search(query, ctx) {
      if (!configured) throw new ProviderUnavailable('no_key');
      const params = new URLSearchParams({
        q: searchText(query), type: query.kind, limit: '10', market: config.spotifyMarket,
      });
      const data = await getJson(ctx, `https://api.spotify.com/v1/search?${params}`, {
        headers: { Authorization: 'Bearer ' + await token() },
      });
      const list = data[query.kind + 's'];
      return ((list && list.items) || []).filter(Boolean).map((item) => toCandidate(query.kind, item));
    },
  };
}
