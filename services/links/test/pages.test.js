// Разбор страниц поиска без ключа. Разметка повторяет настоящие ответы от 3 ноября 2026.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCache, dailyBudget } from '../cache.js';
import { pickBest } from '../match.js';
import { parseSearchPage as parseSoundcloud } from '../providers/soundcloud.js';
import { parseSearchPage as parseYoutube } from '../providers/youtube.js';
import { parseQuery } from '../query.js';
import { createProviders, createSearch } from '../search.js';
import { CONFIG, json, page } from './helpers.js';

const q = (params) => parseQuery(new URLSearchParams(params));
const video = (videoId, title, channel, length) => ({ videoRenderer: {
  videoId, title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: channel }] }, lengthText: { simpleText: length },
  thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/small.jpg' }, { url: 'https://i.ytimg.com/big.jpg' }] },
} });
const ytPage = (videos) => `<html><script>var ytInitialData = ${JSON.stringify({ contents: { list: videos } })};</script></html>`;
const YT = ytPage([
  video('nightcore11', 'Nightcore - Song (Max & Tob Remix)', 'Night', '2:40'),
  video('other000001', 'Alice - Song [Max & Tob] (Lyrics)', 'Tee', '2:58'),
  video('right000001', 'Max & Tob - Song', 'House Cloud', '2:58'),
  video('later000001', 'Max, Tob - Song', 'Rain', '2:55'),
]);
const SC = `<noscript><ul><li><h2><a href="/fan/mix">Max Pavlov - Song (Original Mix)</a></h2></li>
<li><h2><a href="/fhc/max-tob-song">Max &amp; Tob - Song</a></h2></li>
<li><h2><a href="/later/song">Max - Song</a></h2></li></ul></noscript>`;

test('YouTube: первый подходящий результат, а не просто первый', () => {
  const candidates = parseYoutube(YT);
  assert.equal(candidates.length, 4);
  assert.equal(candidates[2].duration, 178);
  assert.equal(candidates[2].cover, 'https://i.ytimg.com/big.jpg');
  const best = pickBest(q({ singer: 'Max', songname: 'Song' }), candidates);
  assert.equal(best.url, 'https://www.youtube.com/watch?v=right000001');
});

test('YouTube: страница без данных или с битыми данными — это сбой, а не «нет песни»', () => {
  assert.throws(() => parseYoutube('<html>Before you continue</html>'), { reason: 'blocked' });
  assert.throws(() => parseYoutube('<script>var ytInitialData = {oops};</script>'), { reason: 'page_changed' });
});

test('SoundCloud: название и исполнитель со страницы', () => {
  const candidates = parseSoundcloud(SC);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates[1].artists, ['fhc', 'Max & Tob']);
  assert.equal(candidates[1].title, 'Song');
  const best = pickBest(q({ singer: 'Max', songname: 'Song' }), candidates);
  assert.equal(best.url, 'https://soundcloud.com/fhc/max-tob-song');
  assert.throws(() => parseSoundcloud('<html></html>'), { reason: 'page_changed' });
});

function setup(doFetch, config = {}) {
  const merged = { ...CONFIG, pageSearch: true, ...config };
  const cache = createCache(':memory:');
  const budgets = {
    youtube: dailyBudget(cache, 'youtube', 90),
    youtubePage: dailyBudget(cache, 'youtube-page', merged.pageSearchesPerDay),
    soundcloudPage: dailyBudget(cache, 'soundcloud-page', merged.pageSearchesPerDay),
    ytmusicPage: dailyBudget(cache, 'ytmusic-page', merged.pageSearchesPerDay),
  };
  return createSearch({ providers: createProviders(merged, doFetch, budgets), cache, doFetch, timeoutMs: 200 });
}
const by = (r) => Object.fromEntries(r.results.map((x) => [x.service, x]));
const site = (yt, sc) => async (url) => {
  if (url.includes('www.youtube.com')) return page(yt);
  if (url.includes('soundcloud.com')) return page(sc);
  return url.includes('deezer') ? json({ data: [] }) : json({ results: [] });
};

test('без ключа находятся точные ссылки', async () => {
  const r = by(await setup(site(YT, SC)).run(q({ singer: 'Max', songname: 'Song' })));
  assert.equal(r.youtube.url, 'https://www.youtube.com/watch?v=right000001');
  assert.equal(r.soundcloud.url, 'https://soundcloud.com/fhc/max-tob-song');
  assert.equal(r.spotify.reason, 'no_key');
});

test('совпадения нет: остаётся «Искать», а не прочерк, и повторно страницу не грузим', async () => {
  let loads = 0;
  const doFetch = async (url) => {
    if (url.includes('www.youtube.com')) { loads += 1; return page(YT); }
    if (url.includes('soundcloud.com')) return page(SC);
    return url.includes('deezer') ? json({ data: [] }) : json({ results: [] });
  };
  const search = setup(doFetch);
  const query = q({ singer: 'Кто-то другой', songname: 'Другая' });
  const r = by(await search.run(query));
  assert.equal(r.youtube.status, 'unavailable');
  assert.equal(r.youtube.reason, 'no_match');
  assert.ok(r.youtube.searchUrl.startsWith('https://www.youtube.com/results'));
  await search.run(query);
  assert.equal(loads, 1);
});

test('блокировка и сбой дают «Искать» и не кэшируются', async () => {
  let blocked = true;
  const doFetch = async (url) => {
    if (url.includes('www.youtube.com')) return blocked ? page('', 429) : page(YT);
    if (url.includes('soundcloud.com')) return page('<html>капча</html>');
    return url.includes('deezer') ? json({ data: [] }) : json({ results: [] });
  };
  const search = setup(doFetch);
  const query = q({ singer: 'Max', songname: 'Song' });
  let r = by(await search.run(query));
  assert.deepEqual([r.youtube.status, r.youtube.reason], ['unavailable', 'blocked']);
  assert.equal(r.soundcloud.reason, 'page_changed');
  assert.ok(r.soundcloud.searchUrl);
  blocked = false;
  r = by(await search.run(query));
  assert.equal(r.youtube.status, 'found');
});

test('дневной предел и выключатель', async () => {
  let loads = 0;
  const doFetch = async (url) => {
    if (url.includes('www.youtube.com')) { loads += 1; return page(YT); }
    if (url.includes('soundcloud.com')) return page(SC);
    return url.includes('deezer') ? json({ data: [] }) : json({ results: [] });
  };
  const limited = setup(doFetch, { pageSearchesPerDay: 1 });
  await limited.run(q({ singer: 'Max', songname: 'Song' }));
  const r = by(await limited.run(q({ singer: 'Max', songname: 'Другая' })));
  assert.equal(r.youtube.reason, 'quota');
  assert.equal(loads, 1);
  loads = 0;
  const off = by(await setup(doFetch, { pageSearch: false }).run(q({ singer: 'Max', songname: 'Song' })));
  assert.equal(off.youtube.reason, 'no_key');
  assert.equal(loads, 0);
});

test('альбом и исполнитель со страниц не читаем', async () => {
  const r = by(await setup(site(YT, SC)).run(q({ singer: 'Max', album: 'Диск' })));
  assert.equal(r.youtube.reason, 'no_key');
  assert.equal(r.soundcloud.reason, 'no_key');
});
