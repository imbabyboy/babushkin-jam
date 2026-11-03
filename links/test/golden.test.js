// Эталонный набор на записанных ответах настоящих сервисов (test/record.js), без сети. Записаны Apple и Deezer:
// остальным нужны ключи. Критерии из ТЗ: не меньше 90 % верных ответов и не больше одной неверной ссылки.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pickBest } from '../match.js';
import { apple } from '../providers/apple.js';
import { deezer } from '../providers/deezer.js';
import { parseQuery } from '../query.js';
import { GOLDEN } from './golden.js';
import { json } from './helpers.js';

const recorded = JSON.parse(readFileSync(new URL('./fixtures/golden.json', import.meta.url)));
const replay = async (url) => {
  assert.ok(recorded[url], 'нет записи для ' + url);
  return json(recorded[url]);
};

const isRight = (entry, picked) => new RegExp(entry.title, 'i').test(picked.title) &&
  new RegExp(entry.artist, 'i').test(picked.artists.join(' '));

async function picks(entry) {
  const query = parseQuery(new URLSearchParams(entry.params));
  const list = [];
  for (const provider of [apple({ appleCountry: 'US' }), deezer()]) {
    const candidates = await provider.search(query, { fetch: replay });
    const best = pickBest(query, candidates);
    if (best) list.push(best);
  }
  return list;
}

test('в наборе есть все виды запросов', () => {
  assert.ok(GOLDEN.length >= 30);
  assert.ok(GOLDEN.some((e) => e.kind === 'album'));
  assert.ok(GOLDEN.some((e) => e.kind === 'artist'));
  assert.ok(GOLDEN.some((e) => e.title === null));
});

test('точность выбора', async () => {
  let right = 0;
  const wrong = [];
  const positive = GOLDEN.filter((e) => e.title !== null);
  for (const entry of positive) {
    const found = await picks(entry);
    const bad = found.filter((p) => !isRight(entry, p));
    wrong.push(...bad.map((p) => `${JSON.stringify(entry.params)} → ${p.title} / ${p.artists}`));
    if (found.length && !bad.length) right += 1;
  }
  assert.ok(right / positive.length >= 0.9, `верных ${right} из ${positive.length}`);
  assert.ok(wrong.length <= 1, 'неверные ссылки: ' + wrong.join('; '));
});

test('несуществующая песня даёт прочерк', async () => {
  for (const entry of GOLDEN.filter((e) => e.title === null)) {
    assert.deepEqual(await picks(entry), [], JSON.stringify(entry.params));
  }
});

test('треки с матом в названии находятся, версия без цензуры выбрана', async () => {
  const entry = GOLDEN.find((e) => e.params.songname === 'Fuck You');
  const found = await picks(entry);
  assert.ok(found.length > 0);
  assert.ok(found.every((p) => !p.clean));
  assert.ok(found.some((p) => p.explicit));
});
