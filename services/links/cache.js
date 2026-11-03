// Кэш на диске: переживает перезапуск, а значит, не тратит заново квоту YouTube.
import { DatabaseSync } from 'node:sqlite';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

export function createCache(path, now = Date.now) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS counter (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
  `);
  const read = db.prepare('SELECT value, expires FROM cache WHERE key = ?');
  const write = db.prepare('INSERT OR REPLACE INTO cache (key, value, expires) VALUES (?, ?, ?)');
  const purge = db.prepare('DELETE FROM cache WHERE expires <= ?');
  const readCounter = db.prepare('SELECT value FROM counter WHERE key = ?');
  const writeCounter = db.prepare('INSERT OR REPLACE INTO counter (key, value) VALUES (?, ?)');

  purge.run(now());
  const timer = setInterval(() => purge.run(now()), PURGE_INTERVAL_MS);
  timer.unref();

  return {
    get(key) {
      const row = read.get(key);
      return row && row.expires > now() ? JSON.parse(row.value) : null;
    },
    set(key, value, ttlMs) {
      write.run(key, JSON.stringify(value), now() + ttlMs);
    },
    counter(key) {
      const row = readCounter.get(key);
      return row ? row.value : 0;
    },
    setCounter(key, value) {
      writeCounter.run(key, value);
    },
    close() {
      clearInterval(timer);
      db.close();
    },
  };
}

// Дневной предел запросов. Квота Google сбрасывается в полночь по тихоокеанскому времени.
export function dailyBudget(cache, name, limit, now = Date.now) {
  const today = () => new Date(now()).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  return {
    take() {
      const key = `${name}:${today()}`;
      const used = cache.counter(key);
      if (used >= limit) return false;
      cache.setCounter(key, used + 1);
      return true;
    },
  };
}
