// Короткие ссылки на страницу песни: share.babushkin-jam.store/Ab3dE9x вместо длинного адреса с параметрами.
// Код — из хеша параметров, поэтому у одной песни всегда один и тот же код, и база не растёт от повторов.
import { createHash } from 'node:crypto';

const CODE_LENGTH = 7;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const FIELDS = ['q', 'singer', 'songname', 'album', 'year', 'duration', 'ym'];
const MAX_ATTEMPTS = 5;

// 7 символов, чтобы не пересечься с /health, /app.js и прочими адресами сервиса.
export const SHORT_PATH = /^\/([0-9A-Za-z]{7})$/;

// Только разобранные поля: что сохраняем, то потом и покажем.
export function toSearch(query) {
  const params = new URLSearchParams();
  for (const name of FIELDS) if (query[name]) params.set(name, String(query[name]));
  return params.toString();
}

function codeOf(text) {
  const digest = createHash('sha256').update(text).digest();
  let n = digest.readBigUInt64BE(0);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Number(n % 62n)];
    n /= 62n;
  }
  return code;
}

// Возвращает код для параметров. Совпадение кода у разных песен почти невозможно, но на этот случай есть соль.
export function shorten(cache, query) {
  const search = toSearch(query);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = codeOf(attempt ? `${search}#${attempt}` : search);
    const stored = cache.short(code);
    if (stored === search) return code;
    if (stored === null) {
      cache.setShort(code, search);
      return code;
    }
  }
  throw new Error('Не удалось подобрать короткий код');
}
