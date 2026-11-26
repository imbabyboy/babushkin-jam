import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCache } from '../cache.js';
import { createResolver, metaTags, parseLink, sourceLink, toUrl } from '../resolve.js';
import { json, page } from './helpers.js';

const parse = (text) => parseLink(toUrl(text));

function resolver(routes) {
  const calls = [];
  const doFetch = async (url, options = {}) => {
    calls.push({ url, options });
    for (const [part, reply] of Object.entries(routes)) if (url.includes(part)) return reply(url, options);
    throw new Error('неожиданный запрос ' + url);
  };
  return { calls, run: createResolver({ cache: createCache(':memory:'), doFetch, timeoutMs: 200 }).run };
}

test('ссылки разбираются без сети', () => {
  assert.deepEqual(parse('https://music.yandex.ru/album/42196185/track/151655827?utm_source=x'),
    { service: 'yandex', kind: 'track', path: '/album/42196185/track/151655827', ym: '42196185/151655827' });
  assert.deepEqual(parse('music.yandex.com/track/151655827'), { service: 'yandex', kind: 'track', path: '/track/151655827', ym: '151655827' });
  assert.equal(parse('https://music.yandex.ru/artist/41191/tracks').kind, 'artist');
  assert.deepEqual(parse('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=abc'),
    { service: 'spotify', kind: 'track', id: '4uLU6hMCjMI75M1A2tKUQC' });
  assert.deepEqual(parse('https://music.apple.com/ru/album/the-best-of-me/1478452829?i=1478452837'),
    { service: 'apple', kind: 'track', id: '1478452837', country: 'ru' });
  assert.deepEqual(parse('https://music.apple.com/us/song/never-gonna-give-you-up/1559523359'),
    { service: 'apple', kind: 'track', id: '1559523359', country: 'us' });
  assert.deepEqual(parse('https://www.deezer.com/fr/album/302127'), { service: 'deezer', kind: 'album', id: '302127' });
  assert.equal(parse('https://youtu.be/dQw4w9WgXcQ?t=10').id, 'dQw4w9WgXcQ');
  assert.deepEqual(parse('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD'), { service: 'ytmusic', kind: 'track', id: 'dQw4w9WgXcQ' });
  assert.equal(parse('https://www.youtube.com/shorts/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.deepEqual(parse('https://soundcloud.com/forss/flickermood'), { service: 'soundcloud', kind: 'track', path: '/forss/flickermood' });
  assert.equal(parse('https://soundcloud.com/forss/sets/soulhack').kind, 'album');
  assert.equal(parse('https://on.soundcloud.com/abc').service, 'short');
});

test('чужие и непонятные адреса не разбираются', () => {
  assert.equal(toUrl('kizaru trooper'), null);
  assert.equal(toUrl('javascript:alert(1)'), null);
  assert.equal(parse('https://example.com/track/1'), null);
  assert.equal(parse('https://music.yandex.ru/home'), null);
  assert.equal(parse('https://www.youtube.com/@RickAstleyYT'), null);
  assert.equal(parse('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'), null);
});

test('мета-теги: порядок атрибутов и сущности', () => {
  const tags = metaTags('<meta content="A &amp; B &#x27;x&#39;" property="og:title"/><meta name="music:duration" content="214">');
  assert.deepEqual(tags, { 'og:title': "A & B 'x'", 'music:duration': '214' });
});

test('Яндекс Музыка: исполнитель из описания, номер трека для ym, страница для бота', async () => {
  const html = '<meta property="og:title" content="Встретить тебя"/><meta property="og:description" content="Код одиночества • Трек • 2026"/>';
  const { run, calls } = resolver({ 'music.yandex.ru': () => page(html) });
  const result = await run('https://music.yandex.com/album/42196185/track/151655827');
  assert.deepEqual(result.query, { singer: 'Код одиночества', songname: 'Встретить тебя', ym: '42196185/151655827' });
  assert.equal(calls[0].url, 'https://music.yandex.ru/album/42196185/track/151655827');
  assert.match(calls[0].options.headers['User-Agent'], /TelegramBot/);
});

test('Spotify: трек с длительностью и альбом без «Listen to»', async () => {
  const track = '<meta property="og:title" content="Never Gonna Give You Up"/><meta property="og:description" content="Rick Astley · Whenever You Need Somebody · Song · 1987"/><meta name="music:duration" content="214"/><meta name="music:musician_description" content="Rick Astley"/>';
  const album = '<meta property="og:title" content="Listen to Whenever You Need Somebody - Album by Rick Astley | Spotify"/><meta property="og:description" content="Rick Astley · album · 1987 · 10 songs"/>';
  const { run } = resolver({ '/track/': () => page(track), '/album/': () => page(album) });
  assert.deepEqual((await run('open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).query,
    { singer: 'Rick Astley', songname: 'Never Gonna Give You Up', duration: 214, link: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' });
  assert.deepEqual((await run('https://open.spotify.com/album/6N9PS4QXF1D0OWPk0Sxtb4')).query,
    { singer: 'Rick Astley', album: 'Whenever You Need Somebody', link: 'https://open.spotify.com/album/6N9PS4QXF1D0OWPk0Sxtb4' });
});

test('Apple Music и Deezer: по API', async () => {
  const { run, calls } = resolver({
    'itunes.apple.com': () => json({ results: [{ wrapperType: 'track', artistName: 'Rick Astley', trackName: 'Never Gonna Give You Up', collectionName: 'Whenever You Need Somebody', trackTimeMillis: 213573 }] }),
    'api.deezer.com/track/': () => json({ title: 'Song', duration: 200, artist: { name: 'A' }, album: { title: 'Disc' } }),
    'api.deezer.com/album/': () => json({ error: { type: 'DataException', code: 800 } }),
  });
  assert.deepEqual((await run('https://music.apple.com/ru/album/x/1?i=1559523359')).query,
    { singer: 'Rick Astley', songname: 'Never Gonna Give You Up', album: 'Whenever You Need Somebody', duration: 214, link: 'https://music.apple.com/ru/song/1559523359' });
  assert.match(calls[0].url, /lookup\?id=1559523359&country=ru$/);
  assert.deepEqual((await run('https://www.deezer.com/track/1')).query, { singer: 'A', songname: 'Song', album: 'Disc', duration: 200, link: 'https://www.deezer.com/track/1' });
  await assert.rejects(run('https://www.deezer.com/album/1'), { reason: 'not_found' });
});

test('YouTube: «Исполнитель - Песня», канал Topic, иначе свободный текст', async () => {
  const replies = {
    aaaaaaaaaaa: { title: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)', author_name: 'Rick Astley' },
    bbbbbbbbbbb: { title: 'Never Gonna Give You Up', author_name: 'Rick Astley - Topic' },
    ccccccccccc: { title: 'Never Gonna Give You Up official video', author_name: 'Random Channel' },
  };
  const { run } = resolver({ 'youtube.com/oembed': (url) => json(replies[decodeURIComponent(url).slice(-11)]) });
  assert.deepEqual((await run('https://youtu.be/aaaaaaaaaaa')).query,
    { singer: 'Rick Astley', songname: 'Never Gonna Give You Up', link: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
  assert.deepEqual((await run('https://music.youtube.com/watch?v=bbbbbbbbbbb')).query,
    { singer: 'Rick Astley', songname: 'Never Gonna Give You Up', link: 'https://music.youtube.com/watch?v=bbbbbbbbbbb' });
  assert.deepEqual((await run('https://www.youtube.com/watch?v=ccccccccccc')).query,
    { q: 'Never Gonna Give You Up', link: 'https://www.youtube.com/watch?v=ccccccccccc' });
});

test('SoundCloud: короткая ссылка через редирект, «by Автор» отрезается', async () => {
  const { run, calls } = resolver({
    'on.soundcloud.com': () => ({ ok: false, status: 302, headers: new Headers({ location: 'https://soundcloud.com/forss/flickermood?utm=1' }) }),
    'soundcloud.com/oembed': () => json({ title: 'Flickermood by Forss', author_name: 'Forss' }),
  });
  assert.deepEqual((await run('https://on.soundcloud.com/AbC')).query,
    { singer: 'Forss', songname: 'Flickermood', link: 'https://soundcloud.com/forss/flickermood' });
  assert.equal(calls[0].options.redirect, 'manual');
});

test('редирект короткой ссылки на чужой сайт не разбираем', async () => {
  const { run, calls } = resolver({
    'link.deezer.com': () => ({ ok: false, status: 302, headers: new Headers({ location: 'http://127.0.0.1:8787/x' }) }),
  });
  await assert.rejects(run('https://link.deezer.com/s/abc'), { reason: 'unknown_link' });
  assert.equal(calls.length, 1);
});

test('повторная ссылка с другим хвостом берётся из кэша', async () => {
  const { run, calls } = resolver({ 'api.deezer.com': () => json({ title: 'Song', artist: { name: 'A' } }) });
  await run('https://www.deezer.com/track/1?utm_source=a');
  await run('deezer.com/en/track/1');
  assert.equal(calls.length, 1);
});

test('ссылка-источник собирается заново, короткие и чужие не годятся', () => {
  assert.deepEqual(sourceLink('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=abc'),
    { service: 'spotify', kind: 'track', url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' });
  assert.equal(sourceLink('https://music.yandex.ru/album/9046986').url, 'https://music.yandex.ru/album/9046986');
  assert.equal(sourceLink('https://on.soundcloud.com/AbC'), null);
  assert.equal(sourceLink('https://example.com/track/1'), null);
  assert.equal(sourceLink(''), null);
});
