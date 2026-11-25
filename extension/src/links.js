// Ссылки на Яндекс Музыку — в приложение babushkin-jam (включается в настройках приложения, background.js спрашивает его).
// Только в расширении: грузится раньше content.js, тот ждёт ответа и при переходе в приложение не входит в комнату.
// Открытие ссылкой отличаем по типу перехода: перезагрузка, «назад» и переходы внутри сайта остаются во вкладке.
// Вход в аккаунт возвращает на Музыку с других доменов Яндекса — такие переходы тоже не трогаем.

var yjamLinkCheck = (async () => {
  const STAY_KEY = 'yjam-stay'; // эту вкладку открыли «здесь» — дальше в ней не перехватываем
  const STAY_HASH = '#yjam-stay';
  const YANDEX_RE = /(^|\.)(yandex\.[a-z]+|ya\.ru)$/;

  try {
    if (location.hash === STAY_HASH) {
      sessionStorage.setItem(STAY_KEY, '1');
      history.replaceState(history.state, '', location.pathname + location.search);
    }
    if (sessionStorage.getItem(STAY_KEY)) return false;
  } catch (e) { return false; }

  const nav = performance.getEntriesByType('navigation')[0];
  if (!nav || nav.type !== 'navigate') return false;
  let from = '';
  try { from = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
  if (YANDEX_RE.test(from)) return false;

  // Пока спрашиваем приложение, страницу не показываем: вкладка может сейчас закрыться.
  // Включено ли это, знает приложение; не запущено — отвечает мгновенно отказом соединения.
  const html = document.documentElement;
  html.style.setProperty('visibility', 'hidden', 'important');
  let r = null;
  try {
    r = await chrome.runtime.sendMessage({ type: 'yjam:open-in-app', url: location.href, fresh: history.length <= 1 });
  } catch (e) {}
  if (r && r.sent) return true;
  // Приложение запускается по ссылке babushkin-jam:// или его нет. Вкладка остаётся обычной страницей Музыки.
  try { sessionStorage.setItem(STAY_KEY, '1'); } catch (e) {}
  html.style.removeProperty('visibility');
  return false;
})();
