// Панель под иконкой в трее — та же страница, что попап расширения и окно джема (generated/settings/popup.html, адрес ?host=tray):
// плеер, вход и комната из попапа, настройки из settings.js. Здесь только то, чего там нет: синхронизация в шапке и кнопки снизу.

(() => {
  if (new URLSearchParams(location.search).get('host') !== 'tray') return;
  document.documentElement.dataset.host = 'tray';

  const RESYNC_ICON = '<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>';
  const sep = () => Object.assign(document.createElement('div'), { className: 'sep' });

  // Блок настроек кладёт сюда settings.js: тот же, что на странице настроек.
  const options = document.createElement('section');
  options.id = 'tray-options';

  const footer = document.createElement('section');
  footer.className = 'tray-footer';
  footer.innerHTML = `
    <button id="tray-settings" class="tray-link">Настройки…</button>
    <button id="tray-quit" class="tray-link">Выйти из приложения</button>`;

  $('settings').after(sep(), options, sep(), footer);

  const resync = iconButton('icon-btn', 'Синхронизировать', RESYNC_ICON, () => askTab('yjam:resync'));
  resync.id = 'tray-resync';
  document.querySelector('.head-btns').append(resync);

  $('tray-settings').onclick = () => desktop.openSettings('settings');
  $('tray-quit').onclick = () => desktop.quit();

  // Пока панель скрыта, браузер придерживает таймеры попапа: при показе обновляем сразу.
  window.addEventListener('focus', () => refresh());
  desktop.info().then(({ platform }) => { document.documentElement.dataset.platform = platform; });
})();
