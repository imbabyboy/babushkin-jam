import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCache, dailyBudget } from '../cache.js';
import { parseQuery } from '../query.js';
import { createProviders, createSearch } from '../search.js';
import { CONFIG, json } from './helpers.js';

const q = (params) => parseQuery(new URLSearchParams(params));
const byService = (response) => Object.fromEntries(response.results.map((r) => [r.service, r]));
const DEEZER_HIT = { data: [{
  link: 'https://www.deezer.com/track/1', title: 'Song', artist: { name: 'A' },
  album: { title: 'Disc', cover_medium: 'https://cdn.example/c.jpg' }, explicit_lyrics: true,
}] };

function setup(doFetch, config = {}, now) {
  const merged = { ...CONFIG, ...config };
  const cache = createCache(':memory:', now);
  const budgets = {
    youtube: dailyBudget(cache, 'youtube', merged.youtubeDailySearches, now),
    youtubePage: dailyBudget(cache, 'youtube-page', merged.pageSearchesPerDay, now),
    soundcloudPage: dailyBudget(cache, 'soundcloud-page', merged.pageSearchesPerDay, now),
    ytmusicPage: dailyBudget(cache, 'ytmusic-page', merged.pageSearchesPerDay, now),
  };
  return createSearch({ providers: createProviders(merged, doFetch, budgets), cache, doFetch, timeoutMs: merged.providerTimeoutMs });
}

const onlyDeezer = (body) => async (url) => {
  if (url.includes('deezer')) return json(body);
  if (url.includes('itunes')) return json({ results: [] });
  throw new Error('неожиданный запрос ' + url);
};

test('статусы: нашли, не нашли и не удалось проверить', async () => {
  const r = byService(await setup(onlyDeezer(DEEZER_HIT)).run(q({ singer: 'A', songname: 'Song' })));
  assert.equal(r.deezer.status, 'found');
  assert.equal(r.deezer.url, 'https://www.deezer.com/track/1');
  assert.equal(r.deezer.explicit, true);
  assert.equal(r.apple.status, 'not_found');
  assert.deepEqual([r.spotify.status, r.spotify.reason], ['unavailable', 'no_key']);
  assert.deepEqual([r.yandex.status, r.yandex.reason], ['unavailable', 'search_unavailable']);
});

test('непроверенному сервису даётся ссылка на поиск, а там, где песни нет, её нет', async () => {
  const r = byService(await setup(onlyDeezer(DEEZER_HIT)).run(q({ singer: 'A B', songname: 'C&D' })));
  assert.equal(r.youtube.searchUrl, 'https://www.youtube.com/results?search_query=A%20B%20C%26D');
  assert.equal(r.spotify.searchUrl, 'https://open.spotify.com/search/A%20B%20C%26D');
  assert.equal(r.soundcloud.searchUrl, 'https://soundcloud.com/search?q=A%20B%20C%26D');
  assert.equal(r.yandex.searchUrl, 'https://music.yandex.ru/search?text=A%20B%20C%26D');
  assert.equal(r.apple.status, 'not_found');
  assert.equal(r.apple.searchUrl, undefined);
  const album = byService(await setup(onlyDeezer({ data: [] })).run(q({ singer: 'A', album: 'D' })));
  assert.equal(album.youtube.searchUrl, 'https://www.youtube.com/results?search_query=A%20D');
});

test('название и обложка берутся у сервиса', async () => {
  const response = await setup(onlyDeezer(DEEZER_HIT)).run(q({ singer: 'a', songname: 'song' }));
  assert.equal(response.title, 'Song');
  assert.equal(response.artist, 'A');
  assert.equal(response.cover, 'https://cdn.example/c.jpg');
  assert.equal(JSON.stringify(response).includes('"meta"'), false);
});

test('ym сразу даёт ссылку на Яндекс без сети', async () => {
  const search = setup(onlyDeezer({ data: [] }));
  const a = byService(await search.run(q({ singer: 'A', songname: 'S', ym: '12/34' })));
  assert.equal(a.yandex.url, 'https://music.yandex.ru/album/12/track/34');
  const b = byService(await search.run(q({ singer: 'A', songname: 'S', ym: '34' })));
  assert.equal(b.yandex.url, 'https://music.yandex.ru/track/34');
});

test('сбой одного сервиса не ломает остальные и не кэшируется', async () => {
  let fail = true;
  const doFetch = async (url) => {
    if (url.includes('itunes')) {
      if (fail) throw new Error('сеть');
      return json({ results: [] });
    }
    return json(DEEZER_HIT);
  };
  const search = setup(doFetch);
  const query = q({ singer: 'A', songname: 'Song' });
  let r = byService(await search.run(query));
  assert.equal(r.apple.status, 'unavailable');
  assert.equal(r.deezer.status, 'found');
  fail = false;
  r = byService(await search.run(query));
  assert.equal(r.apple.status, 'not_found');
});

test('зависший сервис отваливается по таймауту', async () => {
  const doFetch = (url, { signal }) => {
    if (url.includes('deezer')) return Promise.resolve(json(DEEZER_HIT));
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  };
  const started = Date.now();
  // Таймер AbortSignal.timeout не держит процесс: без этого Node 22 решит, что ждать нечего, и отменит тесты.
  const keepAlive = setTimeout(() => {}, 1000);
  const r = byService(await setup(doFetch, { providerTimeoutMs: 50 }).run(q({ singer: 'A', songname: 'Song' })));
  clearTimeout(keepAlive);
  assert.deepEqual([r.apple.status, r.apple.reason], ['unavailable', 'timeout']);
  assert.equal(r.deezer.status, 'found');
  assert.ok(Date.now() - started < 1000);
});

test('повторный запрос идёт из кэша, а не на сервис', async () => {
  let calls = 0;
  const doFetch = async (url) => { calls += 1; return url.includes('deezer') ? json(DEEZER_HIT) : json({ results: [] }); };
  const search = setup(doFetch);
  const query = q({ singer: 'A', songname: 'Song' });
  await search.run(query);
  const first = calls;
  const again = await search.run(q({ singer: 'a', songname: 'SONG' }));
  assert.equal(calls, first);
  assert.equal(byService(again).deezer.status, 'found');
});

test('срок кэша: прочерк живёт сутки, найденное 30 дней', async () => {
  let time = 1000;
  let calls = 0;
  const doFetch = async (url) => { if (url.includes('itunes')) calls += 1; return url.includes('deezer') ? json(DEEZER_HIT) : json({ results: [] }); };
  const search = setup(doFetch, {}, () => time);
  const query = q({ singer: 'A', songname: 'Song' });
  await search.run(query);
  time += 25 * 60 * 60 * 1000;
  await search.run(query);
  assert.equal(calls, 2);
});

test('ссылка с чужого домена не проходит', async () => {
  const evil = { data: [{ ...DEEZER_HIT.data[0], link: 'https://evil.example/track/1' }] };
  const r = byService(await setup(onlyDeezer(evil)).run(q({ singer: 'A', songname: 'Song' })));
  assert.equal(r.deezer.status, 'not_found');
  const http = { data: [{ ...DEEZER_HIT.data[0], link: 'http://www.deezer.com/track/1' }] };
  assert.equal(byService(await setup(onlyDeezer(http)).run(q({ singer: 'A', songname: 'Song' }))).deezer.status, 'not_found');
});

test('пометка «с цензурой» доходит до ответа', async () => {
  const doFetch = async (url) => (url.includes('itunes')
    ? json({ results: [{ trackViewUrl: 'https://music.apple.com/x', trackName: 'Song', artistName: 'A', trackExplicitness: 'cleaned' }] })
    : json({ data: [] }));
  const r = byService(await setup(doFetch).run(q({ singer: 'A', songname: 'Song' })));
  assert.equal(r.apple.clean, true);
});

const YT_HIT = { items: [{
  id: { videoId: 'abc' },
  snippet: { title: 'A - Song (Official Video)', channelTitle: 'A - Topic', thumbnails: { high: { url: 'https://i.ytimg.com/a.jpg' } } },
}] };

test('YouTube: без цензуры, название клипа очищено, дневной предел', async () => {
  const urls = [];
  const doFetch = async (url) => {
    if (url.includes('googleapis')) { urls.push(url); return json(YT_HIT); }
    return url.includes('deezer') ? json({ data: [] }) : json({ results: [] });
  };
  const search = setup(doFetch, { youtubeApiKey: 'key', youtubeDailySearches: 1 });
  let r = byService(await search.run(q({ singer: 'A', songname: 'Song' })));
  assert.equal(r.youtube.url, 'https://www.youtube.com/watch?v=abc');
  assert.ok(urls[0].includes('safeSearch=none'));
  r = byService(await search.run(q({ singer: 'A', songname: 'Другая' })));
  assert.deepEqual([r.youtube.status, r.youtube.reason], ['unavailable', 'quota']);
  assert.equal(urls.length, 1);
});

test('Spotify: токен один на несколько запросов', async () => {
  let tokens = 0;
  const doFetch = async (url, options) => {
    if (url.includes('accounts.spotify')) { tokens += 1; return json({ access_token: 'T', expires_in: 3600 }); }
    if (url.includes('api.spotify')) {
      assert.equal(options.headers.Authorization, 'Bearer T');
      return json({ tracks: { items: [{
        name: 'Song', artists: [{ name: 'A' }], explicit: true, duration_ms: 180000,
        external_urls: { spotify: 'https://open.spotify.com/track/1' }, album: { name: 'D', images: [{ url: 'https://i.scdn.co/1' }] },
      }] } });
    }
    return url.includes('deezer') ? json({ data: [] }) : json({ results: [] });
  };
  const search = setup(doFetch, { spotifyClientId: 'i', spotifyClientSecret: 's' });
  const r = byService(await search.run(q({ singer: 'A', songname: 'Song' })));
  await search.run(q({ singer: 'A', songname: 'Другая' }));
  assert.equal(r.spotify.url, 'https://open.spotify.com/track/1');
  assert.equal(tokens, 1);
});

test('SoundCloud: заголовок OAuth и исполнитель из названия', async () => {
  const doFetch = async (url, options) => {
    if (url.includes('secure.soundcloud')) return json({ access_token: 'T', expires_in: 3600 });
    if (url.includes('api.soundcloud')) {
      assert.equal(options.headers.Authorization, 'OAuth T');
      return json([{ title: 'A - Song', user: { username: 'label' }, permalink_url: 'https://soundcloud.com/x/y', duration: 180000 }]);
    }
    return url.includes('deezer') ? json({ data: [] }) : json({ results: [] });
  };
  const r = byService(await setup(doFetch, { soundcloudClientId: 'i', soundcloudClientSecret: 's' }).run(q({ singer: 'A', songname: 'Song' })));
  assert.equal(r.soundcloud.url, 'https://soundcloud.com/x/y');
});

test('отказ сервиса с кодом 429 или 403 показан как недоступность', async () => {
  const doFetch = async (url) => (url.includes('deezer') ? json({}, 429) : json({}, 403));
  const r = byService(await setup(doFetch).run(q({ singer: 'A', songname: 'Song' })));
  assert.deepEqual([r.deezer.status, r.deezer.reason], ['unavailable', 'rate_limit']);
  assert.deepEqual([r.apple.status, r.apple.reason], ['unavailable', 'denied']);
});
