import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../server.js';
import { CONFIG, json } from './helpers.js';

const fakeFetch = async (url) => {
  if (url.includes('deezer')) {
    return json({ data: [{ link: 'https://www.deezer.com/track/1', title: 'Song', artist: { name: 'A' }, album: { title: 'D', cover_medium: 'https://cdn.example/c.jpg?a=1&b="2' } }] });
  }
  return json({ results: [] });
};

let server;
let base;
const start = (config = {}) => new Promise((resolve) => {
  const app = createApp({ config: { ...CONFIG, ...config }, doFetch: fakeFetch });
  app.listen(0, '127.0.0.1', () => resolve(app));
});

before(async () => {
  server = await start();
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('главная: форма, без noindex', async () => {
  const res = await fetch(base + '/');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /id="form"/);
  assert.doesNotMatch(html, /noindex/);
  assert.doesNotMatch(html, /<!--HEAD-->/);
});

test('страница с параметрами: карточка и noindex', async () => {
  const html = await (await fetch(base + '/?singer=kizaru&songname=trooper')).text();
  assert.match(html, /<meta property="og:title" content="kizaru — trooper">/);
  assert.match(html, /noindex/);
});

test('текст из параметров экранируется', async () => {
  const evil = encodeURIComponent('"><script>alert(1)</script>');
  const html = await (await fetch(`${base}/?singer=${evil}&songname=x`)).text();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('обложка из кэша попадает в карточку экранированной', async () => {
  await fetch(base + '/api/search?singer=A&songname=Song');
  const html = await (await fetch(base + '/?singer=A&songname=Song')).text();
  assert.match(html, /og:image" content="https:\/\/cdn\.example\/c\.jpg\?a=1&amp;b=&quot;2"/);
});

test('адреса на странице относительные: сервис работает и под /links/', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /href="style\.css"/);
  assert.match(html, /src="app\.js"/);
  assert.doesNotMatch(html, /(href|src|action)="\//);
  assert.doesNotMatch(await (await fetch(base + '/style.css')).text(), /url\("\//);
  assert.doesNotMatch(await (await fetch(base + '/app.js')).text(), /fetch\('\//);
});

test('заголовки безопасности', async () => {
  const res = await fetch(base + '/');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
});

test('API: ответ и пустой запрос', async () => {
  const ok = await fetch(base + '/api/search?singer=A&songname=Song');
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.equal(data.kind, 'track');
  assert.equal(data.results.length, 7);
  assert.equal((await fetch(base + '/api/search')).status, 400);
  assert.equal((await fetch(base + '/api/search?ym=1/2')).status, 400);
});

test('до файлов сервера из адреса не дойти', async () => {
  for (const path of ['/server.js', '/../server.js', '/public/../server.js', '/config.js', '/fonts/../server.js', '/links-cache.db']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test('статика и шрифт отдаются', async () => {
  assert.match((await fetch(base + '/app.js')).headers.get('content-type'), /javascript/);
  assert.match((await fetch(base + '/style.css')).headers.get('content-type'), /css/);
  assert.equal((await fetch(base + '/fonts/golos-latin.woff2')).status, 200);
});

test('только GET и HEAD', async () => {
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  const head = await fetch(base + '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('лимит запросов: 429, у другого адреса свой счётчик, подставной адрес не помогает', async () => {
  const limited = await start({ rateLimitPerMinute: 2 });
  const url = `http://127.0.0.1:${limited.address().port}/api/search?singer=A&songname=Song`;
  const as = (chain) => fetch(url, { headers: { 'X-Forwarded-For': chain } });
  assert.equal((await as('1.1.1.1')).status, 200);
  assert.equal((await as('1.1.1.1')).status, 200);
  assert.equal((await as('1.1.1.1')).status, 429);
  // клиент дописал чужой адрес слева, настоящий Caddy добавляет справа
  assert.equal((await as('9.9.9.9, 1.1.1.1')).status, 429);
  assert.equal((await as('2.2.2.2')).status, 200);
  limited.close();
});
