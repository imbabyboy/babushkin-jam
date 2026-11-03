// Записывает настоящие ответы сервисов без ключа для эталонного набора. Запуск вручную: npm run record.
// Тесты потом идут без сети. Лимит Apple около 20 запросов в минуту, поэтому между запросами пауза.
import { writeFileSync } from 'node:fs';
import { apple } from '../providers/apple.js';
import { deezer } from '../providers/deezer.js';
import { parseQuery } from '../query.js';
import { GOLDEN } from './golden.js';

const PAUSE_MS = 3200;
const KEEP = ['link', 'title', 'title_version', 'duration', 'explicit_lyrics', 'name', 'picture_medium', 'cover_medium',
  'artist', 'album', 'trackViewUrl', 'trackName', 'artistName', 'collectionName', 'collectionViewUrl', 'artistLinkUrl',
  'trackTimeMillis', 'trackExplicitness', 'collectionExplicitness', 'artworkUrl100'];

const trim = (item) => Object.fromEntries(KEEP.filter((k) => item[k] !== undefined).map((k) => [k, item[k]]));
const responses = {};

const recording = async (url, options) => {
  const res = await fetch(url, options);
  const body = await res.json();
  const list = body.data || body.results || [];
  responses[url] = body.data ? { data: list.map(trim) } : { results: list.map(trim) };
  return { ok: res.ok, status: res.status, json: async () => body };
};

const config = { appleCountry: 'US' };
for (const entry of GOLDEN) {
  const query = parseQuery(new URLSearchParams(entry.params));
  for (const provider of [apple(config), deezer()]) {
    await provider.search(query, { fetch: recording, signal: AbortSignal.timeout(10000) });
  }
  console.log('записано:', JSON.stringify(entry.params));
  await new Promise((r) => setTimeout(r, PAUSE_MS));
}
writeFileSync(new URL('./fixtures/golden.json', import.meta.url), JSON.stringify(responses) + '\n');
