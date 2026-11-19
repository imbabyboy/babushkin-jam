// Ссылки на Яндекс Музыку из других программ: babushkin-jam://open?url=… (запуск приложения)
// и POST http://127.0.0.1:47835/open?url=… (расширение отдаёт ссылку запущенному приложению без вопроса браузера).
// Схему и порт знает и shared/shared.js (APP_PORT, appLink) — менять вместе.

const http = require('http');

const SCHEME = 'babushkin-jam';
const PORT = 47835;
const HOST = '127.0.0.1';
const MUSIC_HOST_RE = /(^|\.)music\.yandex\.(ru|com|by|kz)$/;

// Что открыть: путь на сайте и код комнаты из приглашения (?jam=). Чужие адреса — null.
function parseLink(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
    if (url.protocol === SCHEME + ':') url = new URL(url.searchParams.get('url') || '');
  } catch (e) { return null; }
  if (url.protocol !== 'https:' || !MUSIC_HOST_RE.test(url.hostname)) return null;
  const jam = String(url.searchParams.get('jam') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  url.searchParams.delete('jam');
  return { path: url.pathname + url.search, jam: jam || null };
}

const linkFromArgv = (argv) => (argv || []).find((a) => typeof a === 'string' && a.startsWith(SCHEME + '://')) || null;

// Сайты тоже могут стучаться на 127.0.0.1. Свой заголовок без нашего разрешения CORS они не отправят,
// а проверка Host закрывает подмену адреса через DNS. Принимаем только POST из расширения.
// onLink получает адрес как есть — разбирает его тот же parseLink, что и ссылки babushkin-jam://.
function startLinkServer(onLink) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    const ok = req.method === 'POST' && url.pathname === '/open'
      && req.headers.host === `${HOST}:${PORT}` && req.headers['x-yjam'] === '1';
    const raw = url.searchParams.get('url');
    const good = ok && !!parseLink(raw);
    res.writeHead(good ? 204 : 400).end();
    if (good) onLink(raw);
  });
  // Порт занят — расширение не достучится и откроет приложение по ссылке babushkin-jam://.
  server.on('error', (e) => console.warn('links: 127.0.0.1:' + PORT + ' недоступен:', e.code || e.message));
  server.listen(PORT, HOST);
  return server;
}

module.exports = { SCHEME, PORT, parseLink, linkFromArgv, startLinkServer };
