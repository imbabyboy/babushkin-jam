// Журнал использования джема — чтобы понимать нагрузку: сколько сессий, сколько людей, как долго.
// Сессия — от первого входа в комнату до её удаления (через EMPTY_ROOM_TTL_MS после ухода последнего):
// перезагрузки страницы её не рвут. Пишем время, длительность, число людей и имена. Код комнаты, треки и IP — нет.
// «Моя» сессия — среди имён есть имя автора (JAM_OWNER_NAMES) и людей не больше двух: автор с кем-то вдвоём или один.
import fs from 'node:fs';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
export const KEEP_DAYS = 90;
const MAX_NAMES = 50;

function addName(usage, name) {
  const key = name.trim().toLowerCase();
  if (!usage.names.has(key) && usage.names.size < MAX_NAMES) usage.names.set(key, name);
}

export function createUsageLog({ file, ownerNames = [], now = Date.now, log = console.log }) {
  const owners = new Set(ownerNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // Старые записи удаляем: обещано хранить не дольше KEEP_DAYS дней.
  function prune() {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    const border = now() - KEEP_DAYS * DAY_MS;
    const lines = text.split('\n').filter(Boolean);
    const kept = lines.filter((line) => {
      try { return Date.parse(JSON.parse(line).end) >= border; } catch { return false; }
    });
    if (kept.length !== lines.length) fs.writeFileSync(file, kept.map((l) => l + '\n').join(''));
  }
  prune();
  const timer = setInterval(prune, DAY_MS);
  timer.unref();

  function write(entry) {
    const line = JSON.stringify(entry);
    try { fs.appendFileSync(file, line + '\n'); } catch (e) { log('Журнал использования не записан:', e.code || e.name); }
  }

  return {
    // Вошёл участник: начинаем сессию или продолжаем ту, что ждёт возвращения после перезагрузки.
    join(room, name) {
      room.usage ??= { startedAt: now(), names: new Map(), people: 0, emptyAt: null }; // имя без регистра → как написано
      room.usage.emptyAt = null;
      addName(room.usage, name);
      room.usage.people = Math.max(room.usage.people, room.members.size);
    },
    rename(room, name) {
      if (room.usage) addName(room.usage, name);
    },
    empty(room) {
      if (room.usage) room.usage.emptyAt = now();
    },
    // Комната удалена или сервер останавливается. Конец — когда ушёл последний, а если люди ещё были — сейчас.
    finish(room, reason = 'empty') {
      const u = room.usage;
      if (!u) return;
      room.usage = null;
      const end = u.emptyAt || now();
      const names = [...u.names.values()];
      const mine = u.people <= 2 && names.some((n) => owners.has(n.trim().toLowerCase()));
      write({
        start: new Date(u.startedAt).toISOString(),
        end: new Date(end).toISOString(),
        minutes: Math.round((end - u.startedAt) / 6000) / 10,
        people: u.people,
        names,
        kind: mine ? 'mine' : 'other',
        ...(reason === 'restart' ? { ended: 'restart' } : {}),
      });
    },
    stop: () => clearInterval(timer),
  };
}
