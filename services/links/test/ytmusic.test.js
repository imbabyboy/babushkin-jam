// Разбор страницы YouTube Music. Разметка повторяет настоящие ответы от 3 ноября 2026.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickBest } from '../match.js';
import { parseSearchPage, ytmusic } from '../providers/ytmusic.js';
import { parseQuery } from '../query.js';
import { page } from './helpers.js';

const q = (params) => parseQuery(new URLSearchParams(params));
const runs = (text) => ({ runs: [{ text }] });
const thumb = (url) => ({ musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://lh3.example/s' }, { url }] } } });
const row = (title, subtitle, extra = {}) => ({ musicResponsiveListItemRenderer: {
  flexColumns: [title, subtitle].map((t) => ({ musicResponsiveListItemFlexColumnRenderer: { text: runs(t) } })),
  thumbnail: thumb('https://lh3.example/big'),
  ...extra,
} });
const song = (id, title, subtitle, extra) => row(title, subtitle, { playlistItemData: { videoId: id }, ...extra });
const card = (title, subtitle, endpoint, contents = []) => ({ musicCardShelfRenderer: {
  title: { runs: [{ text: title, navigationEndpoint: endpoint }] }, subtitle: runs(subtitle), thumbnail: thumb('https://lh3.example/card'), contents,
} });

// Как на странице: JSON внутри строки JS, служебные символы как \xNN, а & как \\u0026.
function wrap(contents) {
  const json = JSON.stringify({ contents }).replace(/&/g, '\\u0026').replace(/\\/g, '\\\\');
  const body = json.replace(/[{}"[\]:,]/g, (c) => '\\x' + c.charCodeAt(0).toString(16));
  return `<script>initialData.push({path: '\\/guide', params: JSON.parse('\\x7b\\x7d'), data: '\\x7b\\x7d'});`
    + `initialData.push({path: '\\/search', params: JSON.parse('\\x7b\\x7d'), data: '${body}'});</script>`;
}

test('карточка: официальный трек с исполнителем и длительностью, & раскодирован', () => {
  const [top] = parseSearchPage(wrap([card('Song', 'Song • Max & Tob • 2:58', { watchEndpoint: { videoId: 'official001' } })]));
  assert.equal(top.url, 'https://music.youtube.com/watch?v=official001');
  assert.deepEqual(top.artists, ['Max & Tob']);
  assert.equal(top.duration, 178);
  assert.equal(top.official, true);
  assert.equal(top.cover, 'https://lh3.example/card');
});

test('официальный трек важнее клипа, даже если клип стоит выше', () => {
  const list = parseSearchPage(wrap([
    song('video000001', 'Song', 'Video • A • 13K views'),
    song('real0000001', 'Song', 'Song • A • 25K plays'),
  ]));
  assert.equal(list[0].isVideo, true);
  assert.equal(pickBest(q({ singer: 'A', songname: 'Song' }), list).url, 'https://music.youtube.com/watch?v=real0000001');
});

test('под карточкой исполнителя его имя берётся из карточки', () => {
  const list = parseSearchPage(wrap([card('The Band', 'Artist • 52M monthly audience', { browseEndpoint: { browseId: 'UC123' } }, [
    song('heyjude0001', 'Hey', 'Song • 7:06 • 230M plays'),
  ])]));
  const best = pickBest(q({ singer: 'The Band', songname: 'Hey' }), list.filter((c) => c.kind === 'track'));
  assert.equal(best.url, 'https://music.youtube.com/watch?v=heyjude0001');
  assert.equal(best.duration, 426);
  assert.equal(list[0].url, 'https://music.youtube.com/channel/UC123');
});

test('чужая песня и ремикс не проходят', () => {
  const list = parseSearchPage(wrap([
    song('other000001', 'Song', 'Song • Кто-то другой • 6K plays'),
    song('remix000001', 'Song (Remix)', 'Song • A • 1K plays'),
  ]));
  assert.equal(pickBest(q({ singer: 'A', songname: 'Song' }), list), null);
});

test('альбом и пометка без цензуры', () => {
  const list = parseSearchPage(wrap([
    row('Disc', 'Album • A • 1973', {
      navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_1' } },
      badges: [{ musicInlineBadgeRenderer: { icon: { iconType: 'MUSIC_EXPLICIT_BADGE' } } }],
    }),
  ]));
  assert.equal(list[0].kind, 'album');
  assert.equal(list[0].url, 'https://music.youtube.com/browse/MPREb_1');
  assert.equal(list[0].explicit, true);
});

test('страница без данных и битые данные — сбой, а не «нет песни»', () => {
  assert.throws(() => parseSearchPage('<html>Before you continue</html>'), { reason: 'blocked' });
  assert.throws(() => parseSearchPage(`initialData.push({path: '\\/search', params: JSON.parse('x'), data: 'oops'})`), { reason: 'page_changed' });
});

test('сервис отдаёт только нужный вид результатов и помечает выдачу неполной', async () => {
  const html = wrap([song('real0000001', 'Song', 'Song • A • 1K plays'), row('Disc', 'Album • A • 1973', { navigationEndpoint: { browseEndpoint: { browseId: 'B1' } } })]);
  const provider = ytmusic({ pageSearch: true }, { take: () => true });
  const albums = await provider.search(q({ singer: 'A', album: 'Disc' }), { fetch: async () => page(html) });
  assert.equal(albums.length, 1);
  assert.equal(albums[0].kind, 'album');
  assert.equal(albums.partial, true);
  await assert.rejects(ytmusic({ pageSearch: false }, {}).search(q({ singer: 'A', songname: 'S' }), {}), { reason: 'page_search_off' });
  await assert.rejects(ytmusic({ pageSearch: true }, { take: () => false }).search(q({ singer: 'A', songname: 'S' }), {}), { reason: 'quota' });
});
