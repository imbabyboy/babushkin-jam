// Сайт и API сервиса ссылок. Адреса пользователей и тексты запросов в логи не пишем.
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createCache, dailyBudget } from './cache.js';
import { readConfig } from './config.js';
import { describe, parseQuery } from './query.js';
import { createProviders, createSearch } from './search.js';

const here = (path) => new URL(path, import.meta.url);
const RATE_WINDOW_MS = 60 * 1000;
const SITE_NAME = 'Ссылки на песню';
const DEFAULT_DESCRIPTION = 'Находит песню на разных музыкальных сервисах';

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src https: data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// Только перечисленные файлы, путь из запроса до диска не доходит.
const STATIC_FILES = {
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/fonts/golos-cyrillic.woff2': ['fonts/golos-cyrillic.woff2', 'font/woff2'],
  '/fonts/golos-latin.woff2': ['fonts/golos-latin.woff2', 'font/woff2'],
};

// В контейнере шрифты лежат рядом с сервером, при разработке берём их из shared/, чтобы не хранить копию.
function staticFile(relative) {
  const local = here('./' + relative);
  if (existsSync(local)) return readFileSync(local);
  const shared = here('../../shared/' + relative);
  return existsSync(shared) ? readFileSync(shared) : null;
}

export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Telegram не выполняет JS, поэтому карточка должна быть в самом HTML. Текст из параметров придумывает кто угодно.
function renderPage(template, query, cover) {
  const name = query.kind ? describe(query) : '';
  const title = name ? `${name} · ${SITE_NAME}` : SITE_NAME;
  const description = name ? `Ссылки на «${name}» в музыкальных сервисах` : DEFAULT_DESCRIPTION;
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(name || SITE_NAME)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    ...(cover ? [`<meta property="og:image" content="${escapeHtml(cover)}">`] : []),
    // Любой может придумать ссылку с любым текстом: такие страницы поисковикам не нужны.
    ...(query.kind ? ['<meta name="robots" content="noindex">'] : []),
  ];
  return template.replace('<!--HEAD-->', tags.join('\n  '));
}

function rateLimiter(limit, now = Date.now) {
  const hits = new Map();
  const timer = setInterval(() => {
    for (const [ip, entry] of hits) if (entry.resetAt <= now()) hits.delete(ip);
  }, RATE_WINDOW_MS);
  timer.unref();
  return {
    allow(ip) {
      const time = now();
      const entry = hits.get(ip);
      if (!entry || entry.resetAt <= time) {
        hits.set(ip, { count: 1, resetAt: time + RATE_WINDOW_MS });
        return true;
      }
      entry.count += 1;
      return entry.count <= limit;
    },
    stop: () => clearInterval(timer),
  };
}

// За Caddy настоящий адрес клиента — последний в X-Forwarded-For: предыдущие мог подставить сам клиент.
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',').pop().trim();
  return req.socket.remoteAddress;
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

const sendJson = (res, status, data) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));

export function createApp({ config = readConfig(), doFetch = fetch, cache: givenCache } = {}) {
  const cache = givenCache || createCache(config.dbPath);
  const budgets = {
    youtube: dailyBudget(cache, 'youtube', config.youtubeDailySearches),
    youtubePage: dailyBudget(cache, 'youtube-page', config.pageSearchesPerDay),
    soundcloudPage: dailyBudget(cache, 'soundcloud-page', config.pageSearchesPerDay),
    ytmusicPage: dailyBudget(cache, 'ytmusic-page', config.pageSearchesPerDay),
  };
  const search = createSearch({
    providers: createProviders(config, doFetch, budgets),
    cache,
    doFetch,
    timeoutMs: config.providerTimeoutMs,
  });
  const limiter = rateLimiter(config.rateLimitPerMinute);
  const template = readFileSync(here('./public/index.html'), 'utf8');

  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, 'text/plain; charset=utf-8', 'Метод не поддерживается', { Allow: 'GET, HEAD' });
      }
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/') {
        const query = parseQuery(url.searchParams);
        const cover = query.kind ? search.peekCover(query) : null;
        return send(res, 200, 'text/html; charset=utf-8', renderPage(template, query, cover));
      }
      if (url.pathname === '/health') return sendJson(res, 200, { ok: true });

      if (url.pathname === '/api/search') {
        if (!limiter.allow(clientIp(req))) return sendJson(res, 429, { error: 'Слишком много запросов, попробуйте через минуту' });
        const query = parseQuery(url.searchParams);
        if (!query.kind) return sendJson(res, 400, { error: 'Укажите название песни, альбома или исполнителя' });
        return sendJson(res, 200, await search.run(query));
      }

      const file = STATIC_FILES[url.pathname];
      const body = file && staticFile(file[0]);
      if (body) return send(res, 200, file[1], body, { 'Cache-Control': 'public, max-age=3600' });
      return send(res, 404, 'text/plain; charset=utf-8', 'Не найдено');
    } catch (error) {
      console.error('Ошибка запроса:', error.name);
      if (!res.headersSent) return sendJson(res, 500, { error: 'Внутренняя ошибка' });
      res.end();
    }
  });

  server.on('close', () => {
    limiter.stop();
    if (!givenCache) cache.close();
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = readConfig();
  createApp({ config }).listen(config.port, () => console.log(`song-links: http://localhost:${config.port}`));
}
