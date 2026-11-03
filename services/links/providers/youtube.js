// Data API v3. Поиск стоит 100 единиц из дневных 10 000, поэтому перед вызовом расходуем свой дневной предел.
// По документации, на живом API не проверено: ключа пока нет. Без ключа разбираем страницу поиска.
import { ProviderUnavailable, getJson, getPage, partial, splitArtistTitle } from './common.js';

const TYPES = { track: 'video', album: 'playlist', artist: 'channel' };
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
// Хвосты названий клипов, которые не относятся к названию песни.
const NOISE = /\s*[([|]?\s*(official\s+(music\s+)?(video|audio|visualizer)|music video|lyrics?(\s+video)?|официальн\S*\s+\S+|премьера\s+\S+|клип|audio|hd|hq|4k)\s*[)\]|]?/gi;

const decode = (value) => String(value || '').replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);
const cleanTitle = (value) => decode(value).replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
const channelName = (value) => decode(value).replace(/\s+-\s+topic$/i, '').replace(/VEVO$/, '').trim();

function term(query) {
  if (query.q) return query.q;
  return [query.singer, query.kind === 'album' ? query.album : query.songname].filter(Boolean).join(' ');
}

function videoCandidate({ videoId, title: rawTitle, channelTitle, duration, cover }) {
  const title = cleanTitle(rawTitle);
  const split = splitArtistTitle(title);
  return {
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: split ? split.title : title,
    artists: [channelName(channelTitle), split && split.artist].filter(Boolean),
    official: /\s+-\s+topic$/i.test(channelTitle) || /VEVO$/.test(channelTitle),
    isVideo: true,
    duration,
    cover,
  };
}

const VIDEOS_ONLY = 'EgIQAQ%3D%3D'; // фильтр «только видео» на странице поиска
const PAGE_DATA = /var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/;

const joinRuns = (value) => ((value && value.runs) || []).map((r) => r.text).join('');

function seconds(label) {
  if (!/^\d+(:\d+)+$/.test(label || '')) return null;
  return label.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
}

function readVideos(data) {
  const found = [];
  let budget = 200000;
  const walk = (value) => {
    if (!value || typeof value !== 'object' || --budget < 0) return;
    if (value.videoRenderer) found.push(value.videoRenderer);
    for (const key in value) walk(value[key]);
  };
  walk(data);
  return found;
}

export function parseSearchPage(html) {
  const match = html.match(PAGE_DATA);
  if (!match) throw new ProviderUnavailable('blocked');
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    throw new ProviderUnavailable('page_changed');
  }
  return readVideos(data).filter((v) => v.videoId).map((v) => videoCandidate({
    videoId: v.videoId,
    title: joinRuns(v.title),
    channelTitle: joinRuns(v.ownerText),
    duration: seconds(v.lengthText && v.lengthText.simpleText),
    cover: v.thumbnail && v.thumbnail.thumbnails && (v.thumbnail.thumbnails.at(-1) || {}).url,
  }));
}

function toCandidate(kind, item) {
  const { snippet } = item;
  const cover = snippet.thumbnails && (snippet.thumbnails.high || snippet.thumbnails.default || {}).url;
  const channel = channelName(snippet.channelTitle);
  const official = /\s+-\s+topic$/i.test(snippet.channelTitle) || /VEVO$/.test(snippet.channelTitle);
  if (kind === 'artist') {
    return { url: `https://www.youtube.com/channel/${item.id.channelId}`, title: decode(snippet.title), artists: [decode(snippet.title)], official, cover };
  }
  if (kind === 'album') {
    return { url: `https://www.youtube.com/playlist?list=${item.id.playlistId}`, title: cleanTitle(snippet.title), artists: [channel], official, cover };
  }
  return videoCandidate({ videoId: item.id.videoId, title: snippet.title, channelTitle: snippet.channelTitle, cover });
}

export function youtube(config, budget, pageBudget) {
  return {
    id: 'youtube',
    hosts: ['www.youtube.com'],
    searchUrl: (text) => `https://www.youtube.com/results?search_query=${encodeURIComponent(text)}`,
    cached: true,
    async search(query, ctx) {
      if (!config.youtubeApiKey) {
        if (!config.pageSearch || query.kind !== 'track') throw new ProviderUnavailable('no_key');
        if (!pageBudget.take()) throw new ProviderUnavailable('quota');
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(term(query))}&sp=${VIDEOS_ONLY}`;
        return partial(parseSearchPage(await getPage(ctx, url)));
      }
      if (!budget.take()) throw new ProviderUnavailable('quota');
      const params = new URLSearchParams({
        part: 'snippet', type: TYPES[query.kind], maxResults: '10', safeSearch: 'none',
        q: term(query), key: config.youtubeApiKey,
      });
      if (query.kind === 'track') params.set('videoCategoryId', '10'); // музыка
      const data = await getJson(ctx, `https://www.googleapis.com/youtube/v3/search?${params}`);
      return (data.items || []).map((item) => toCandidate(query.kind, item));
    },
  };
}
