#!/usr/bin/env node
// Журнал использования джема с VPS: отдельно мои сессии и остальные.
// Запуск из корня: node tools/jam-usage.js        — с сервера (JAM_HOST из deploy/.env)
//                  node tools/jam-usage.js --file путь/usage.jsonl — из локального файла
// Сессии короче минуты (открыл и закрыл) показываются только с --all.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REMOTE_FILE = '/opt/yandex-jam/data/usage.jsonl';
const SHORT_MIN = 1;

function readEnv() {
  const file = path.join(__dirname, '..', 'deploy', '.env');
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

function load(args) {
  const i = args.indexOf('--file');
  if (i >= 0) return fs.readFileSync(args[i + 1], 'utf8');
  const host = process.env.JAM_HOST || readEnv().JAM_HOST;
  if (!host) throw new Error('нет JAM_HOST в deploy/.env');
  return execFileSync('ssh', [host, `cat ${REMOTE_FILE} 2>/dev/null || true`], { encoding: 'utf8' });
}

const pad = (n) => String(n).padStart(2, '0');
const when = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const duration = (min) => (min >= 60 ? `${Math.floor(min / 60)} ч ${pad(Math.round(min % 60))} мин` : `${Math.round(min)} мин`);

function section(title, list) {
  const total = list.reduce((sum, e) => sum + e.minutes, 0);
  console.log(`\n${title}: ${list.length}, всего ${duration(total)}`);
  for (const e of list) {
    const note = e.ended === 'restart' ? '  (оборвал рестарт сервера)' : '';
    console.log(`  ${when(e.start)}  ${duration(e.minutes).padStart(11)}  ${String(e.people).padStart(2)} чел.  ${e.names.join(', ')}${note}`);
  }
}

const args = process.argv.slice(2);
const all = args.includes('--all');
const entries = load(args).split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const shown = entries.filter((e) => all || e.minutes >= SHORT_MIN);
console.log(`Сессий в журнале: ${entries.length}${all ? '' : `, короче минуты скрыто: ${entries.length - shown.length} (--all — показать)`}`);
section('Мои', shown.filter((e) => e.kind === 'mine'));
section('Остальные', shown.filter((e) => e.kind !== 'mine'));
