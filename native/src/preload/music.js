// Preload окна Яндекс Музыки. Делает то же, что content_scripts в manifest.json расширения:
// page.js — в мир страницы до скриптов сайта, остальное — в изолированный мир.
// bundle.js подставляет сюда код из shared/ и кладёт результат в generated/preload-music.js.

const { ipcRenderer, webFrame } = require('electron');

/*__CHROME_SHIM__*/

// Вход в аккаунт идёт через другие домены, там джем не нужен. Всплывающие окна — не участники комнаты.
const isMusicSite = /(^|\.)music\.yandex\.(ru|com|by|kz)$/.test(location.hostname) && !window.opener;

// Мир preload в Electron. Своя политика только у него: у страницы её правила остаются как есть.
const PRELOAD_WORLD_ID = 999;

if (isMusicSite) {
  // Политика сайта запрещает соединения со всем, кроме Яндекса, а значит, и с сервером комнат.
  // Скрипты расширения Chrome от неё освобождает, здесь то же самое задаём сами.
  webFrame.setIsolatedWorldInfo(PRELOAD_WORLD_ID, {
    name: 'babushkin-jam',
    securityOrigin: location.origin,
    csp: 'connect-src ws: wss:',
  });

  webFrame.executeJavaScript(/*__PAGE_JS__*/);

  const chrome = makeChrome(ipcRenderer);

  /*__EXTENSION_SCRIPTS__*/

  // Перемотка с плеера. В content.js такого сообщения нет, поэтому идём сразу в page.js:
  // событие seeked уйдёт в комнату обычным путём, как перемотка человеком.
  let seekSeq = 0;
  const seek = (position) => window.postMessage(
    { source: 'yjam-cs', id: 'desktop-seek-' + (++seekSeq), cmd: 'seek', args: { position } },
    location.origin,
  );

  // Сообщения от главного процесса — как chrome.tabs.sendMessage в расширении.
  ipcRenderer.on('yjam:message', (_e, id, msg) => {
    if (msg.type === 'yjam:seek') {
      seek(msg.position);
      ipcRenderer.send('yjam:reply', id, { ok: true });
      return;
    }
    let done = false;
    const reply = (result) => {
      if (done) return;
      done = true;
      ipcRenderer.send('yjam:reply', id, result);
    };
    let waits = false;
    for (const fn of chrome._messageListeners) if (fn(msg, {}, reply) === true) waits = true;
    if (!waits) reply(null);
  });
}
