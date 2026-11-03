// У Яндекс Музыки нет публичного API, а её поиск с нашего VPS отвечает 451 (проверено 3 ноября 2026, сервер в NL).
// Поэтому ссылка строится только из номера трека, который присылает приложение.
import { ProviderUnavailable } from './common.js';

export function yandex() {
  return {
    id: 'yandex',
    hosts: ['music.yandex.ru'],
    searchUrl: (text) => `https://music.yandex.ru/search?text=${encodeURIComponent(text)}`,
    cached: false,
    async search(query) {
      if (query.ym) {
        const [first, second] = query.ym.split('/');
        const path = second ? `/album/${first}/track/${second}` : `/track/${first}`;
        return [{ url: 'https://music.yandex.ru' + path, trusted: true }];
      }
      throw new ProviderUnavailable('search_unavailable');
    },
  };
}
