// Ссылки на Яндекс Музыку из других программ: babushkin-jam://open?url=… (запуск приложения)
// и POST http://127.0.0.1:47835/link?url=… (расширение отдаёт ссылку запущенному приложению без вопроса браузера).
// Схему и порт знает и shared/shared.js (APP_PORT, appLink) — менять вместе.

const http = require('http');

const SCHEME = 'babushkin-jam';
const PORT = Number(process.env.YJAM_LINK_PORT) || 47835; // другой порт — только для проверок рядом с установленным приложением
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
// а проверка Host закрывает подмену адреса через DNS. CORS разрешаем только расширениям: так расширению
// не нужен доступ к 127.0.0.1, и Chrome ничего не спрашивает.
//   POST /open?url=  — расширение 1.6: открыть ссылку (включено ли, решало само расширение);
//   POST /link?url=  — открыть, если в приложении включено «Открывать ссылки» (иначе 403);
//   GET  /prefs      — эта настройка: расширение помнит её на случай, когда приложение не запущено.
// onLink получает адрес как есть — разбирает его тот же parseLink, что и ссылки babushkin-jam://.
// onExtension — расширение на связи: приложение знает, что оно установлено.
const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;

function startLinkServer(onLink, { linksEnabled = () => true, onExtension = () => {} } = {}) {
  const server = http.createServer((req, res) => {
    res.setHeader('Connection', 'close'); // запросы редкие, держать соединение незачем
    const url = new URL(req.url, `http://${HOST}`);
    const origin = req.headers.origin || '';
    const cors = EXTENSION_ORIGIN_RE.test(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    if (req.method === 'OPTIONS') {
      res.writeHead(cors['Access-Control-Allow-Origin'] ? 204 : 403, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'X-YJam',
        'Access-Control-Allow-Private-Network': 'true',
      }).end();
      return;
    }
    const ours = req.headers.host === `${HOST}:${PORT}` && !!req.headers['x-yjam'];
    if (!ours) { res.writeHead(400, cors).end(); return; }
    onExtension();
    if (req.method === 'GET' && url.pathname === '/prefs') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ openLinks: !!linksEnabled() }));
      return;
    }
    const raw = url.searchParams.get('url');
    const open = req.method === 'POST' && (url.pathname === '/open' || url.pathname === '/link') && !!parseLink(raw);
    if (!open) { res.writeHead(400, cors).end(); return; }
    if (url.pathname === '/link' && !linksEnabled()) { res.writeHead(403, cors).end(); return; }
    res.writeHead(204, cors).end();
    onLink(raw);
  });
  // Порт занят — расширение не достучится и откроет приложение по ссылке babushkin-jam://.
  server.on('error', (e) => console.warn('links: 127.0.0.1:' + PORT + ' недоступен:', e.code || e.message));
  server.listen(PORT, HOST);
  return server;
}

module.exports = { SCHEME, PORT, parseLink, linkFromArgv, startLinkServer };
