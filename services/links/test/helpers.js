export const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
export const page = (body, status = 200) => ({ ok: status < 400, status, text: async () => body });
export const CONFIG = {
  rateLimitPerMinute: 1000, providerTimeoutMs: 200, appleCountry: 'US', spotifyMarket: 'US',
  spotifyClientId: '', spotifyClientSecret: '', soundcloudClientId: '', soundcloudClientSecret: '',
  youtubeApiKey: '', youtubeDailySearches: 90, pageSearch: false, pageSearchesPerDay: 300, dbPath: ':memory:',
};
