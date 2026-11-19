const assert = require('node:assert/strict');
const { test } = require('node:test');
// Свой порт: на обычном слушает установленное приложение, и проверочные ссылки ушли бы в него.
process.env.YJAM_LINK_PORT = '47898';
const { PORT, parseLink, linkFromArgv, startLinkServer } = require('../src/links');

const wrap = (url) => 'babushkin-jam://open?url=' + encodeURIComponent(url);

test('ссылка на трек: путь с параметрами, без приглашения', () => {
  assert.deepEqual(parseLink('https://music.yandex.ru/album/42196185/track/151655827?utm_medium=copy_link'),
    { path: '/album/42196185/track/151655827?utm_medium=copy_link', jam: null });
  assert.deepEqual(parseLink(wrap('https://music.yandex.com/playlists/abc')), { path: '/playlists/abc', jam: null });
});

test('приглашение: код отдельно, из пути убран', () => {
  assert.deepEqual(parseLink(wrap('https://music.yandex.ru/?jam=qx9-wku')), { path: '/', jam: 'QX9WKU' });
  assert.deepEqual(parseLink('https://music.yandex.ru/album/1?jam=AB12&x=1'), { path: '/album/1?x=1', jam: 'AB12' });
});

test('чужие адреса не открываем', () => {
  for (const bad of [
    'http://music.yandex.ru/album/1',
    'https://music.yandex.ru.evil.com/',
    'https://evilmusic.yandex.ru.com/',
    'https://example.com/?jam=AB12',
    wrap('javascript:alert(1)'),
    'babushkin-jam://open',
    'не ссылка',
    null,
  ]) assert.equal(parseLink(bad), null, String(bad));
});

test('ссылка из аргументов запуска (Windows)', () => {
  assert.equal(linkFromArgv(['app.exe', '--flag', wrap('https://music.yandex.ru/')]), wrap('https://music.yandex.ru/'));
  assert.equal(linkFromArgv(['app.exe']), null);
});

test('приёмник на 127.0.0.1: только POST от расширения', async (t) => {
  const got = [];
  const server = startLinkServer((link) => got.push(link));
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${PORT}/open?url=` + encodeURIComponent('https://music.yandex.ru/album/7');

  assert.equal((await fetch(base, { method: 'POST', headers: { 'X-YJam': '1' } })).status, 204);
  assert.equal((await fetch(base, { method: 'POST' })).status, 400, 'без заголовка');
  assert.equal((await fetch(base, { headers: { 'X-YJam': '1' } })).status, 400, 'GET');
  const evil = `http://127.0.0.1:${PORT}/open?url=` + encodeURIComponent('https://example.com/');
  assert.equal((await fetch(evil, { method: 'POST', headers: { 'X-YJam': '1' } })).status, 400, 'чужой адрес');
  assert.deepEqual(got, ['https://music.yandex.ru/album/7']);
});
