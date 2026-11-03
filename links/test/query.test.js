import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describe, parseQuery } from '../query.js';

const q = (params) => parseQuery(new URLSearchParams(params));

test('что ищем, зависит от переданных параметров', () => {
  assert.equal(q({ singer: 'a', songname: 'b' }).kind, 'track');
  assert.equal(q({ singer: 'a', songname: 'b', album: 'c' }).kind, 'track');
  assert.equal(q({ singer: 'a', album: 'c' }).kind, 'album');
  assert.equal(q({ album: 'c' }).kind, 'album');
  assert.equal(q({ singer: 'a' }).kind, 'artist');
  assert.equal(q({ songname: 'b' }).kind, 'track');
  assert.equal(q({ q: 'b' }).kind, 'track');
  assert.equal(q({}).kind, null);
  assert.equal(q({ ym: '1/2' }).kind, null);
});

test('значения чистятся и ограничиваются', () => {
  assert.equal(q({ singer: '  a   b ' }).singer, 'a b');
  assert.equal(q({ singer: 'x'.repeat(500) }).singer.length, 200);
  assert.equal(q({ duration: 'abc' }).duration, null);
  assert.equal(q({ duration: '-5' }).duration, null);
  assert.equal(q({ duration: '184' }).duration, 184);
  assert.equal(q({ year: '20' }).year, null);
});

test('ym принимает только номера', () => {
  assert.equal(q({ ym: '1/2' }).ym, '1/2');
  assert.equal(q({ ym: '2' }).ym, '2');
  assert.equal(q({ ym: '../evil' }).ym, '');
  assert.equal(q({ ym: '1/2/3' }).ym, '');
});

test('неизвестные параметры игнорируются', () => {
  assert.equal(q({ singer: 'a', utm: 'x' }).utm, undefined);
});

test('подпись запроса', () => {
  assert.equal(describe(q({ singer: 'a', songname: 'b' })), 'a — b');
  assert.equal(describe(q({ singer: 'a', album: 'c' })), 'a — c');
  assert.equal(describe(q({ q: 'd' })), 'd');
});
