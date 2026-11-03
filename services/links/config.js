// Настройки из окружения. Ключей в репозитории нет: без ключа сервис просто отвечает «не удалось проверить».
export function readConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 8790,
    dbPath: env.LINKS_DB || new URL('./links-cache.db', import.meta.url).pathname,
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE) || 30,
    providerTimeoutMs: Number(env.PROVIDER_TIMEOUT_MS) || 4000,
    appleCountry: env.APPLE_COUNTRY || 'US',
    spotifyMarket: env.SPOTIFY_MARKET || 'US',
    spotifyClientId: env.SPOTIFY_CLIENT_ID || '',
    spotifyClientSecret: env.SPOTIFY_CLIENT_SECRET || '',
    soundcloudClientId: env.SOUNDCLOUD_CLIENT_ID || '',
    soundcloudClientSecret: env.SOUNDCLOUD_CLIENT_SECRET || '',
    youtubeApiKey: env.YOUTUBE_API_KEY || '',
    // Один поиск стоит 100 единиц из 10 000 в день. Запас оставляем на случай повторных запросов.
    youtubeDailySearches: Number(env.YOUTUBE_DAILY_SEARCHES) || 90,
    // Без ключа разбираем обычную страницу поиска YouTube, YouTube Music и SoundCloud. Условия этих сервисов такое запрещают
    // и могут заблокировать IP, поэтому есть выключатель и дневной предел на каждый сервис.
    pageSearch: env.PAGE_SEARCH !== 'off',
    pageSearchesPerDay: Number(env.PAGE_SEARCHES_PER_DAY) || 300,
  };
}
