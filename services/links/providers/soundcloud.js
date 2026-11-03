// Официальный API, токен client credentials. По документации, на живом API не проверено: ключа пока нет.
// Без ключа разбираем страницу поиска: сайт кладёт начало выдачи прямо в HTML для браузеров без JS.
import { ProviderUnavailable, clientCredentials, getJson, getPage, partial, splitArtistTitle } from './common.js';

const PATHS = { track: 'tracks', album: 'playlists', artist: 'users' };

function term(query) {
  if (query.q) return query.q;
  return [query.singer, query.kind === 'album' ? query.album : query.songname].filter(Boolean).join(' ');
}

function toCandidate(kind, item) {
  const user = item.user && item.user.username;
  if (kind === 'artist') return { url: item.permalink_url, title: item.username, artists: [item.username], cover: item.avatar_url };
  if (kind === 'album') return { url: item.permalink_url, title: item.title, artists: [user], cover: item.artwork_url };
  // Загружают как угодно: исполнитель может быть и в имени аккаунта, и в начале названия.
  const split = splitArtistTitle(item.title);
  return {
    url: item.permalink_url,
    title: split ? split.title : item.title,
    artists: [user, split && split.artist].filter(Boolean),
    duration: item.duration ? item.duration / 1000 : null,
    cover: item.artwork_url,
  };
}

const PAGE_RESULT = /<li><h2><a href="(\/[^"/]+\/[^"/]+)">([^<]*)<\/a>/g;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };
const decode = (value) => value.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITIES[m]);

export function parseSearchPage(html) {
  if (!/<noscript/.test(html)) throw new ProviderUnavailable('page_changed');
  return [...html.matchAll(PAGE_RESULT)].map(([, path, rawTitle]) => {
    const title = decode(rawTitle);
    const split = splitArtistTitle(title);
    return {
      url: 'https://soundcloud.com' + path,
      title: split ? split.title : title,
      artists: [path.split('/')[1].replace(/[-_]+/g, ' '), split && split.artist].filter(Boolean),
    };
  });
}

export function soundcloud(config, doFetch, pageBudget) {
  const configured = config.soundcloudClientId && config.soundcloudClientSecret;
  const token = configured && clientCredentials({
    tokenUrl: 'https://secure.soundcloud.com/oauth/token',
    clientId: config.soundcloudClientId,
    clientSecret: config.soundcloudClientSecret,
    fetch: doFetch,
  });
  return {
    id: 'soundcloud',
    hosts: ['soundcloud.com'],
    searchUrl: (text) => `https://soundcloud.com/search?q=${encodeURIComponent(text)}`,
    cached: true,
    async search(query, ctx) {
      if (!configured) {
        if (!config.pageSearch || query.kind !== 'track') throw new ProviderUnavailable('no_key');
        if (!pageBudget.take()) throw new ProviderUnavailable('quota');
        const html = await getPage(ctx, `https://soundcloud.com/search/sounds?q=${encodeURIComponent(term(query))}`);
        return partial(parseSearchPage(html));
      }
      const params = new URLSearchParams({ q: term(query), limit: '15' });
      const data = await getJson(ctx, `https://api.soundcloud.com/${PATHS[query.kind]}?${params}`, {
        headers: { Authorization: 'OAuth ' + await token() },
      });
      const list = Array.isArray(data) ? data : data.collection || [];
      return list.map((item) => toCandidate(query.kind, item));
    },
  };
}
