import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize, pickBest, sameName } from '../match.js';
import { parseQuery } from '../query.js';

const q = (params) => parseQuery(new URLSearchParams(params));
const song = (title, artist = 'Кто-то', extra = {}) => ({ url: 'u:' + title, title, artists: [artist], ...extra });

test('нормализация: регистр, ё, пунктуация и feat', () => {
  assert.equal(normalize('Ёлка, Ёж!'), 'елка еж');
  assert.equal(normalize('Song (feat. Someone)'), 'song');
  assert.equal(normalize('Song ft. Someone'), 'song');
});

test('латиница и кириллица считаются одним именем', () => {
  assert.ok(sameName('кизару', 'kizaru'));
  assert.ok(!sameName('кизару', 'Oxxxymiron'));
});

test('имена, которые отличаются только пробелом, совпадают', () => {
  assert.ok(sameName('Cee Lo Green', 'CeeLo Green'));
  assert.ok(!sameName('Cee Lo', 'Cee Lo Green'));
});

test('чужой исполнитель с тем же названием не подходит', () => {
  const query = q({ singer: 'Eminem', songname: 'Without Me' });
  assert.equal(pickBest(query, [song('Without Me', 'Halsey')]), null);
});

test('ремикс и кавер не выдаются за оригинал', () => {
  const query = q({ singer: 'A', songname: 'Song' });
  assert.equal(pickBest(query, [song('Song (Remix)', 'A'), song('Song (Radiohead Cover)', 'A')]), null);
  assert.equal(pickBest(query, [song('Song', 'A', { version: 'Instrumental' })]), null);
});

test('ремикс подходит, если его попросили', () => {
  const query = q({ singer: 'A', songname: 'Song Remix' });
  assert.ok(pickBest(query, [song('Song Remix', 'A')]));
});

test('версия без цензуры важнее чистой, даже если стоит ниже', () => {
  const clean = song('Song', 'A', { clean: true, url: 'clean' });
  const explicit = song('Song', 'A', { explicit: true, url: 'explicit' });
  assert.equal(pickBest(q({ singer: 'A', songname: 'Song' }), [clean, explicit]).url, 'explicit');
  assert.equal(pickBest(q({ singer: 'A', songname: 'Song' }), [clean]).url, 'clean');
});

test('чистая версия выбирается, если её попросили', () => {
  const clean = song('Song (Clean)', 'A', { url: 'clean' });
  const plain = song('Song', 'A', { url: 'plain' });
  assert.equal(pickBest(q({ singer: 'A', songname: 'Song clean' }), [plain, song('Song clean', 'A', { url: 'c2' })]).url, 'c2');
  assert.equal(pickBest(q({ singer: 'A', songname: 'Song' }), [clean, plain]).url, 'plain');
});

test('альбом только уточняет: без него та же песня из другого альбома', () => {
  const query = q({ singer: 'A', songname: 'Song', album: 'Нужный' });
  const other = song('Song', 'A', { album: 'Другой', url: 'other' });
  const wanted = song('Song', 'A', { album: 'Нужный', url: 'wanted' });
  assert.equal(pickBest(query, [other, wanted]).url, 'wanted');
  assert.equal(pickBest(query, [other]).url, 'other');
});

test('длительность: другая запись отбрасывается, клипу запас больше', () => {
  const query = q({ singer: 'A', songname: 'Song', duration: '180' });
  assert.equal(pickBest(query, [song('Song', 'A', { duration: 240 })]), null);
  assert.ok(pickBest(query, [song('Song', 'A', { duration: 183 })]));
  assert.ok(pickBest(query, [song('Song', 'A', { duration: 200, isVideo: true })]));
});

test('свободный текст: нужны все слова', () => {
  const query = q({ q: 'daft punk one more time' });
  assert.ok(pickBest(query, [song('One More Time', 'Daft Punk')]));
  assert.equal(pickBest(query, [song('One More Time', 'Britney')]), null);
});

test('несколько исполнителей в запросе', () => {
  assert.ok(pickBest(q({ singer: 'A, B', songname: 'Song' }), [song('Song', 'B')]));
});

test('исполнитель из совместной записи', () => {
  assert.ok(pickBest(q({ singer: 'Max Fail', songname: 'Song' }), [song('Song', 'Max Fail & Tob!as')]));
  assert.ok(pickBest(q({ singer: 'Max Fail, Tob!as', songname: 'Song' }), [song('Song', 'Tob!as und Max Fail')]));
  assert.ok(pickBest(q({ singer: 'Иван и Мария', songname: 'Song' }), [song('Song', 'Мария')]));
  assert.equal(pickBest(q({ singer: 'Max Fail', songname: 'Song' }), [song('Song', 'Max Pavlov')]), null);
});

test('только альбом и только исполнитель', () => {
  assert.ok(pickBest(q({ album: 'Диск' }), [{ url: 'u', title: 'Диск - EP', artists: ['Кто-то'] }]));
  assert.ok(pickBest(q({ singer: 'A' }), [{ url: 'u', title: 'A', artists: ['A'] }]));
  assert.equal(pickBest(q({ singer: 'A' }), [{ url: 'u', title: 'AB', artists: ['AB'] }]), null);
});
