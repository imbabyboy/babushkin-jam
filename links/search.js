// Опрашивает сервисы параллельно. Сбой одного не влияет на остальные.
import { cacheKey, searchText } from './query.js';
import { pickBest } from './match.js';
import { apple } from './providers/apple.js';
import { deezer } from './providers/deezer.js';
import { soundcloud } from './providers/soundcloud.js';
import { spotify } from './providers/spotify.js';
import { yandex } from './providers/yandex.js';
import { youtube } from './providers/youtube.js';
import { ytmusic } from './providers/ytmusic.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const FOUND_TTL_MS = 30 * DAY_MS;
const NOT_FOUND_TTL_MS = DAY_MS;
// Откуда брать название и обложку: у загрузок на YouTube и SoundCloud подписи менее надёжные.
const META_ORDER = ['spotify', 'apple', 'deezer', 'ytmusic', 'soundcloud', 'youtube'];

export function createProviders(config, doFetch, budgets) {
  return [
    yandex(),
    spotify(config, doFetch),
    apple(config),
    deezer(),
    soundcloud(config, doFetch, budgets.soundcloudPage),
    youtube(config, budgets.youtube, budgets.youtubePage),
    ytmusic(config, budgets.ytmusicPage),
  ];
}

function isAllowedUrl(url, hosts) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && hosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

function toResult(provider, query, candidates) {
  const usable = candidates.filter((c) => isAllowedUrl(c.url, provider.hosts));
  const best = usable.find((c) => c.trusted) || pickBest(query, usable.filter((c) => !c.trusted));
  if (!best) {
    if (candidates.partial) {
      return { service: provider.id, status: 'unavailable', reason: 'no_match', searchUrl: provider.searchUrl(searchText(query)) };
    }
    return { service: provider.id, status: 'not_found' };
  }
  return {
    service: provider.id,
    status: 'found',
    url: best.url,
    ...(best.explicit ? { explicit: true } : {}),
    ...(best.clean ? { clean: true } : {}),
    meta: { title: best.title, artist: (best.artists || []).filter(Boolean).join(', '), cover: best.cover },
  };
}

async function askProvider(provider, query, { cache, doFetch, timeoutMs }) {
  const key = `${provider.id}:${cacheKey(query)}`;
  if (provider.cached) {
    const hit = cache.get(key);
    if (hit) return { ...hit, fromCache: true };
  }
  try {
    const candidates = await provider.search(query, {
      fetch: doFetch,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const result = toResult(provider, query, candidates);
    if (provider.cached) cache.set(key, result, result.status === 'found' ? FOUND_TTL_MS : NOT_FOUND_TTL_MS);
    return result;
  } catch (error) {
    // Сбой не кэшируем: при следующем запросе сервис спросим снова.
    const reason = error.reason || (error.name === 'TimeoutError' ? 'timeout' : 'error');
    return { service: provider.id, status: 'unavailable', reason, searchUrl: provider.searchUrl(searchText(query)) };
  }
}

function buildResponse(query, results) {
  const byService = new Map(results.map((r) => [r.service, r]));
  const metas = META_ORDER.map((id) => byService.get(id)).filter((r) => r && r.meta).map((r) => r.meta);
  return {
    query: Object.fromEntries(['q', 'singer', 'songname', 'album', 'year', 'duration', 'ym']
      .filter((k) => query[k]).map((k) => [k, query[k]])),
    kind: query.kind,
    title: (metas[0] && metas[0].title) || query.songname || query.album || query.q || query.singer,
    artist: (metas[0] && metas[0].artist) || query.singer,
    cover: (metas.find((m) => m.cover) || {}).cover || null,
    results: results.map(({ meta, fromCache, ...rest }) => rest),
    cached: results.every((r) => r.fromCache || r.service === 'yandex'),
  };
}

export function createSearch({ providers, cache, doFetch, timeoutMs }) {
  const shared = { cache, doFetch, timeoutMs };
  return {
    async run(query) {
      const results = await Promise.all(providers.map((p) => askProvider(p, query, shared)));
      return buildResponse(query, results);
    },
    // Для карточки Telegram: только из кэша, без внешних запросов.
    peekCover(query) {
      for (const id of META_ORDER) {
        const hit = cache.get(`${id}:${cacheKey(query)}`);
        if (hit && hit.meta && hit.meta.cover) return hit.meta.cover;
      }
      return null;
    },
  };
}
