// Сервер комнат для джема. Хранит всё в памяти.
// Состояние комнаты: ведущий, трек, позиция, пауза, время обновления, очередь, версия.
// Правила (см. доку): сменил трек вручную -> стал ведущим; пауза/перемотка от любого,
// ведущий не меняется; авто-переход на следующий трек принимается только от ведущего.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000; // пустая комната живёт 5 минут — на случай перезагрузок

const rooms = new Map(); // code -> room

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, def = 0) => (Number.isFinite(v) && v >= 0 ? v : def);

function cleanTrack(t) {
  if (!t || typeof t !== 'object') return null;
  const track = {
    id: str(String(t.id ?? ''), 40) || null,
    albumId: str(String(t.albumId ?? ''), 40) || null,
    title: str(t.title),
    artist: str(t.artist),
    album: str(t.album),
    cover: str(t.cover, 500),
    duration: num(t.duration),
  };
  return track.id || track.title ? track : null;
}

function getRoom(code) {
  let room = rooms.get(code);
  if (!room) {
    room = {
      code,
      version: 0,
      leaderId: null,
      track: null,
      position: 0,
      paused: true,
      updatedAt: Date.now(),
      queue: [],
      members: new Map(), // id -> { id, name, ws }
      dropTimer: null,
    };
    rooms.set(code, room);
  }
  clearTimeout(room.dropTimer);
  room.dropTimer = null;
  return room;
}

// Позиция «сейчас» с учётом времени, прошедшего с последнего обновления.
function livePosition(room) {
  if (room.paused || !room.track) return room.position;
  const pos = room.position + (Date.now() - room.updatedAt) / 1000;
  return room.track.duration ? Math.min(pos, room.track.duration) : pos;
}

function publicState(room) {
  return {
    code: room.code,
    version: room.version,
    leaderId: room.leaderId,
    track: room.track,
    position: room.position,
    paused: room.paused,
    updatedAt: room.updatedAt,
    queue: room.queue,
    members: [...room.members.values()].map(({ id, name }) => ({ id, name })),
  };
}

function bump(room, type, by) {
  room.version++;
  const msg = JSON.stringify({
    t: 'state',
    state: publicState(room),
    cause: { type, by },
    serverTime: Date.now(),
  });
  for (const m of room.members.values()) {
    if (m.ws.readyState === m.ws.OPEN) m.ws.send(msg);
  }
}

function setPosition(room, position, paused = room.paused) {
  room.position = position;
  room.paused = paused;
  room.updatedAt = Date.now();
}

function leave(client) {
  const room = client.room;
  if (!room) return;
  client.room = null;
  room.members.delete(client.id);
  if (room.leaderId === client.id) {
    const next = room.members.keys().next();
    room.leaderId = next.done ? null : next.value;
  }
  // фиксируем позицию, чтобы время продолжало считаться от «сейчас»
  setPosition(room, livePosition(room));
  if (room.members.size === 0) {
    room.dropTimer = setTimeout(() => rooms.delete(room.code), EMPTY_ROOM_TTL_MS);
    return;
  }
  bump(room, 'leave', client.id);
}

function handle(client, m) {
  const room = client.room;
  const isLeader = room && room.leaderId === client.id;

  switch (m.t) {
    case 'ping':
      client.send({ t: 'pong', c: m.c, s: Date.now() });
      return;

    case 'join': {
      const code = str(m.room, 32).trim().toUpperCase();
      if (!code) return client.send({ t: 'error', message: 'Пустой код комнаты' });
      leave(client);
      const r = getRoom(code);
      client.name = str(m.name, 40).trim() || 'Гость';
      client.room = r;
      r.members.set(client.id, { id: client.id, name: client.name, ws: client.ws });
      if (!r.leaderId) r.leaderId = client.id;
      client.send({ t: 'welcome', clientId: client.id, serverTime: Date.now() });
      // позицию фиксируем, чтобы новичок посчитал её от свежего updatedAt
      setPosition(r, livePosition(r));
      bump(r, 'join', client.id);
      return;
    }
  }

  if (!room) return;

  switch (m.t) {
    case 'track': {
      const track = cleanTrack(m.track);
      if (!track) return;
      if (m.auto) {
        // трек доиграл сам: принимаем только от ведущего, ведущий не меняется
        if (!isLeader) return;
      } else {
        // сменил трек вручную -> становится ведущим, его очередь становится очередью комнаты
        room.leaderId = client.id;
        room.queue = Array.isArray(m.queue) ? m.queue.slice(0, 200).map(cleanTrack).filter(Boolean) : [];
      }
      room.track = track;
      setPosition(room, num(m.position), !!m.paused);
      bump(room, m.auto ? 'auto-track' : 'track', client.id);
      return;
    }

    case 'pause':
      setPosition(room, num(m.position, livePosition(room)), !!m.paused);
      bump(room, m.paused ? 'pause' : 'play', client.id);
      return;

    case 'seek':
      setPosition(room, num(m.position, livePosition(room)));
      bump(room, 'seek', client.id);
      return;

    case 'pos': {
      // регулярная позиция от ведущего. Паузу этим сообщением не меняем:
      // иначе устаревший heartbeat может отменить чужую паузу.
      if (!isLeader) return;
      // дополняем трек, если у ведущего появились id или длительность
      const t = cleanTrack(m.track);
      let changed = false;
      if (t && room.track && t.title === room.track.title) {
        for (const k of ['id', 'albumId', 'duration']) {
          if (t[k] && t[k] !== room.track[k]) { room.track[k] = t[k]; changed = true; }
        }
      }
      if (!room.paused) {
        setPosition(room, num(m.position, livePosition(room)));
        changed = true;
      }
      if (changed) bump(room, 'pos', client.id);
      return;
    }

    case 'queue':
      if (!isLeader || !Array.isArray(m.queue)) return;
      room.queue = m.queue.slice(0, 200).map(cleanTrack).filter(Boolean);
      bump(room, 'queue', client.id);
      return;
  }
}

// Политика конфиденциальности для Chrome Web Store
const PRIVACY = fs.readFileSync(new URL('./privacy.html', import.meta.url));

const server = http.createServer((req, res) => {
  if (req.url === '/privacy' || req.url === '/privacy/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PRIVACY);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`babushkin-jam server: комнат ${rooms.size}\n`);
});

const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });

wss.on('connection', (ws) => {
  const client = {
    id: crypto.randomUUID().slice(0, 8),
    name: 'Гость',
    room: null,
    ws,
    send: (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj)),
  };
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m && typeof m.t === 'string') handle(client, m);
  });
  ws.on('close', () => leave(client));
});

// выкидываем мёртвые соединения
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

server.listen(PORT, () => console.log(`yandex-jam server: ws://localhost:${PORT}`));
