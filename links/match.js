// Выбор правильного результата. Неверная ссылка хуже прочерка, поэтому кандидат либо подходит по строгим
// правилам, либо отбрасывается. Нечёткого сравнения названий нет намеренно: оно даёт похожие, но чужие песни.

const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const FEAT = /[([]?\s*\b(feat|ft|featuring)\b\.?.*$/i;
// Версии, которые нельзя выдавать за оригинал, если их не просили.
const VARIANT = /\b(remix|rmx|live|instrumental|karaoke|cover|tribute|sped up|speed up|slowed|reverb|nightcore|8d|acoustic|demo|mashup|bootleg|minus|ремикс|кавер|караоке|минус|инструментал|концерт)\b/i;
// «Чистая» версия: подходит, только если другой нет или её попросили.
const CLEAN = /\b(clean|censored|radio edit)\b|цензур/i;

export function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(FEAT, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const translit = (value) => value.replace(/[а-я]/g, (c) => CYRILLIC[c] ?? c);

// Сравниваем транслитом и без пробелов: kizaru и кизару, Cee Lo и CeeLo — один исполнитель.
const compact = (value) => translit(value).replace(/ /g, '');

export function sameName(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  return x === y || compact(x) === compact(y);
}

// Название без хвоста в скобках: «Song (2018 Remaster)» и «Song» — одна песня. Версии проверяются отдельно.
const baseTitle = (value) => String(value || '').replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*$/, '').trim();

function sameTitle(wanted, title) {
  return sameName(wanted, title) || sameName(wanted, baseTitle(title)) || sameName(baseTitle(wanted), baseTitle(title));
}

const sameAlbum = (wanted, album) => sameTitle(wanted, String(album || '').replace(/\s+-\s+(single|ep)$/i, ''));

const ARTIST_SEPARATOR = /\s*[,&/]\s*|\s+(?:and|и|x|vs\.?|und)\s+/i;
const splitArtists = (value) => String(value).split(ARTIST_SEPARATOR).filter(Boolean);

function artistMatches(wanted, artists) {
  const names = splitArtists(wanted);
  const theirs = artists.flatMap(splitArtists);
  return names.some((name) => theirs.some((artist) => sameName(name, artist))) ||
    artists.some((artist) => sameName(wanted, artist));
}

function askedFor(pattern, query) {
  return pattern.test([query.q, query.songname, query.album].join(' '));
}

function words(value) {
  return translit(normalize(value)).split(' ').filter(Boolean);
}

function matchesFreeText(q, candidate) {
  const haystack = new Set(words([...candidate.artists, candidate.title].join(' ')));
  const wanted = words(q);
  return wanted.length > 0 && wanted.every((w) => haystack.has(w)) && words(candidate.title).length > 0;
}

function trackScore(query, candidate) {
  const label = [candidate.title, candidate.version].filter(Boolean).join(' ');
  if (VARIANT.test(label) && !askedFor(VARIANT, query)) return null;

  if (query.songname) {
    if (!sameTitle(query.songname, candidate.title)) return null;
    if (query.singer && !artistMatches(query.singer, candidate.artists)) return null;
  } else if (!matchesFreeText(query.q, candidate)) {
    return null;
  }

  if (query.duration && candidate.duration) {
    const allowed = candidate.isVideo ? 30 : 5; // у клипа бывают вступление и титры
    if (Math.abs(query.duration - candidate.duration) > allowed) return null;
  }

  let score = 100;
  if (query.album && sameAlbum(query.album, candidate.album)) score += 20;
  if (candidate.official) score += 10;
  if (candidate.explicit) score += 5;
  if ((candidate.clean || CLEAN.test(label)) && !askedFor(CLEAN, query)) score -= 50;
  return score;
}

function albumScore(query, candidate) {
  if (!sameAlbum(query.album, candidate.title)) return null;
  if (query.singer && !artistMatches(query.singer, candidate.artists)) return null;
  let score = 100;
  if (candidate.explicit) score += 5;
  if ((candidate.clean || CLEAN.test(candidate.title)) && !askedFor(CLEAN, query)) score -= 50;
  return score;
}

function artistScore(query, candidate) {
  return sameName(query.singer, candidate.title) ? 100 + (candidate.official ? 10 : 0) : null;
}

const SCORERS = { track: trackScore, album: albumScore, artist: artistScore };

// При равных очках остаётся кандидат, которого сервис поставил выше.
export function pickBest(query, candidates) {
  const score = SCORERS[query.kind];
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const value = score(query, candidate);
    if (value !== null && value > bestScore) {
      best = candidate;
      bestScore = value;
    }
  }
  return best;
}
