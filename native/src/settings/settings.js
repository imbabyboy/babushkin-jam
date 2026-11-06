// Дополнение к попапу расширения: настройки самого приложения в разделе под шестерёнкой.
// Попап тот же самый, поэтому имя, сервер, комната, синхронизация и диагностика работают как в браузере.
// Эта же страница открывается в панели трея (tray/panel.js), поэтому блоки там и здесь одни и те же.

(async () => {
  const PAGE_FRAME_MAX_MS = 50;
  const RESET_DONE_MS = 1200;
  const inTray = document.documentElement.dataset.host === 'tray';
  const hide = () => (inTray ? desktop.hideTrayPanel() : desktop.closeSettings());
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  // Страницу выбирает кнопка, которой открыли: «Джем» или шестерёнка.
  // Разделы переключаем сразу, не дожидаясь обновления попапа: главный процесс покажет окно после этого.
  async function showPage(page) {
    const { room } = await chrome.storage.local.get({ room: '' });
    const inSettings = page === 'settings';
    document.documentElement.dataset.page = page;
    $('setup').hidden = !!room || inSettings;
    $('inroom').hidden = !room || inSettings;
    $('settings').hidden = !inSettings;
    $('head-lobby').hidden = !!room || inSettings;
    $('head-room').hidden = !room || inSettings;
    $('head-settings').hidden = !inSettings;
    if (view !== page) setView(page);
    // Даём кадр на перерисовку, но скрытая страница кадров может и не давать.
    await Promise.race([
      new Promise((resolve) => { requestAnimationFrame(resolve); }),
      new Promise((resolve) => { setTimeout(resolve, PAGE_FRAME_MAX_MS); }),
    ]);
    return document.body.offsetHeight;
  }
  window.yjamShowPage = showPage;

  const close = iconButton('icon-btn', 'Закрыть', ICON_CLOSE, () => desktop.closeSettings());
  close.id = 'settings-close';
  document.querySelector('.head-btns').append(close);

  desktop.onSettingsState(({ placement, page }) => {
    document.documentElement.dataset.placement = placement;
    if (document.documentElement.dataset.page !== page) showPage(page);
  });

  if (inTray) showPage('main');

  const info = await desktop.info();

  // Браузерный буфер обмена требует фокус на окне, а настройки открывают и из трея.
  navigator.clipboard.writeText = (text) => desktop.copy(text);

  // Попап закрывает себя как окно браузера. Здесь закрыть — значит свернуть настройки.
  window.close = hide;

  // До обработчиков попапа: Esc сначала закрывает его меню и отменяет ввод, и только потом — настройки.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.target.matches('input')) return;
    if (document.getElementById('tools').getAttribute('aria-expanded') === 'true') return;
    hide();
  }, true);

  function field(label, control) {
    const box = el('div', 'field');
    box.append(el('span', 'label', label), control);
    return box;
  }

  // Переключатель в стиле попапа (.seg): варианты из главного процесса, текущий подсвечен.
  function segment(options, onPick) {
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'radiogroup');
    const buttons = Object.entries(options).map(([value, label]) => {
      const b = el('button', '', label);
      b.setAttribute('role', 'radio');
      b.onclick = () => onPick(value);
      seg.append(b);
      return [value, b];
    });
    seg.show = (current) => {
      for (const [value, b] of buttons) b.setAttribute('aria-checked', String(value === current));
    };
    return seg;
  }

  function checkbox(label, onToggle) {
    const row = el('label', 'check');
    const input = el('input');
    input.type = 'checkbox';
    input.onchange = () => onToggle(input.checked);
    row.append(input, el('span', '', label));
    row.show = (on) => { input.checked = on; };
    return row;
  }

  const mode = segment(info.modeLabels, (value) => desktop.setMode(value));
  const miniView = segment(info.miniViews, (value) => chrome.storage.local.set({ miniView: value }));
  const closeAction = segment(info.closeLabels, (value) => chrome.storage.local.set({ closeAction: value }));
  const onTop = checkbox('Плеер поверх всех окон', (on) => chrome.storage.local.set({ miniOnTop: on }));
  const trayIcon = checkbox('Иконка в трее', (on) => chrome.storage.local.set({ trayIcon: on }));
  // Без иконки у режима трея нет видимого пути обратно, поэтому говорим, где он теперь.
  const trayHint = el('p', 'disclaimer', info.platform === 'macOS'
    ? 'Если свернуть в трей, вернуть окно можно кликом по значку в Доке.'
    : 'Если свернуть в трей, вернуть окно можно повторным запуском приложения.');
  const remember = checkbox('Запоминать плейлист, трек и время', (on) => chrome.storage.local.set({ rememberPlayback: on }));
  const RESET_LABEL = 'Сбросить плейлист и трек';
  const resetPlayback = el('button', 'btn-outline', RESET_LABEL);
  let resetTimer = null;
  resetPlayback.onclick = async () => {
    await desktop.resetPlayback();
    resetPlayback.textContent = 'Сброшено';
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { resetPlayback.textContent = RESET_LABEL; }, RESET_DONE_MS);
  };
  const hotkeys = checkbox('Горячие клавиши', (on) => chrome.storage.local.set({ hotkeys: on }));

  const keyList = el('dl', 'keys');
  for (const h of info.hotkeys) keyList.append(el('dt', '', h.label), el('dd', '', h.keys));

  const reload = el('button', 'btn-outline', 'Обновить страницу Яндекс Музыки');
  reload.onclick = () => desktop.reloadMusic();

  const version = el('p', 'disclaimer', `Приложение ${info.version} · ${info.platform}`);

  const options = el('div', 'stack app-section');
  options.append(
    field('Окно приложения', mode),
    field('Вид плеера', miniView),
    field('При закрытии окна', closeAction),
    onTop,
    trayIcon,
    trayHint,
    remember,
    resetPlayback,
    hotkeys,
    keyList,
  );
  if (inTray) {
    $('tray-options').append(options);
  } else {
    const section = el('div', 'stack app-section');
    section.append(el('div', 'sep'), options, reload, version);
    document.getElementById('settings-done').before(section);
  }

  async function render() {
    const p = await chrome.storage.local.get(info.prefDefaults);
    mode.show(p.mode);
    miniView.show(p.miniView);
    closeAction.show(p.closeAction);
    onTop.show(p.miniOnTop);
    trayIcon.show(p.trayIcon);
    trayHint.hidden = p.trayIcon;
    remember.show(p.rememberPlayback);
    hotkeys.show(p.hotkeys);
    keyList.hidden = !p.hotkeys;
  }
  chrome.storage.onChanged.addListener(render);
  render();

  // Высота — по содержимому: в попапе у разных разделов она разная. Меню под гаечным ключом лежит
  // поверх страницы и в её высоту не входит, а обрезать его нельзя.
  const menu = document.getElementById('menu');
  const reportHeight = () => desktop.setHeight(
    Math.max(document.body.offsetHeight, menu.hidden ? 0 : menu.offsetTop + menu.offsetHeight + 10),
  );
  const watcher = new ResizeObserver(reportHeight);
  for (const node of [document.body, menu]) watcher.observe(node);
})();
