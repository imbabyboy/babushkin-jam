// Общее для сервисов: запрос с разбором ответа и токен client credentials.

export class ProviderUnavailable extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

export async function getJson(ctx, url, options = {}) {
  const res = await ctx.fetch(url, { ...options, signal: ctx.signal });
  if (res.status === 429) throw new ProviderUnavailable('rate_limit');
  if (res.status === 401 || res.status === 403) throw new ProviderUnavailable('denied');
  if (!res.ok) throw new ProviderUnavailable('http_' + res.status);
  return res.json();
}

// Обычный запрос браузера: без этих заголовков сервисы отдают страницу без результатов.
const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'en',
};

export async function getPage(ctx, url) {
  const res = await ctx.fetch(url, { headers: PAGE_HEADERS, signal: ctx.signal });
  if (res.status === 429 || res.status === 403) throw new ProviderUnavailable('blocked');
  if (!res.ok) throw new ProviderUnavailable('http_' + res.status);
  return res.text();
}

// Страница показывает только начало выдачи, поэтому «не нашли» на ней не значит «песни нет»:
// такой сервис получит ссылку «Искать», а не прочерк.
export function partial(candidates) {
  candidates.partial = true;
  return candidates;
}

// Токен кэшируем: его выпуск ограничен, а живёт он около часа. Параллельные запросы ждут один выпуск.
export function clientCredentials({ tokenUrl, clientId, clientSecret, fetch: doFetch, now = Date.now }) {
  let token = null;
  let expiresAt = 0;
  let pending = null;

  async function issue() {
    const res = await doFetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new ProviderUnavailable('token_' + res.status);
    const data = await res.json();
    token = data.access_token;
    expiresAt = now() + ((data.expires_in || 3600) - 60) * 1000;
    return token;
  }

  return () => {
    if (token && now() < expiresAt) return Promise.resolve(token);
    pending ??= issue().finally(() => { pending = null; });
    return pending;
  };
}

// Сервис с названием трека в поле title часто пишет «Исполнитель - Песня». Отделяем, если исполнитель совпал.
export function splitArtistTitle(title) {
  const m = String(title || '').match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : null;
}
