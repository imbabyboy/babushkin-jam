// Панель над Яндекс Музыкой: кнопка «Джем» и кнопки приложения. Работает и на странице входа.
// Кнопка выглядит как пилюля виджета расширения и открывает настройки прямо под собой.

(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_AVATARS = 3;

  YJam.loadFonts();

  // Место под системные кнопки окна: слева на macOS, справа на Windows.
  document.body.classList.add(/Mac/.test(navigator.platform) ? 'mac' : 'win');

  $('mini').onclick = () => desktop.setMode('mini');
  $('tray').onclick = () => desktop.setMode('tray');
  $('jam').onclick = () => desktop.toggleSettings('main');
  $('settings').onclick = () => desktop.toggleSettings('settings');
  $('update').onclick = () => desktop.installUpdate();

  desktop.info().then(({ version }) => { $('version').textContent = `v${version}`; });

  const UPDATE_LABELS = {
    available: () => 'Обновить',
    downloading: ({ percent }) => `Скачиваю ${percent}%`,
    installing: () => 'Устанавливаю…',
    manual: () => 'Скачать вручную',
  };

  function showUpdate(state) {
    const label = UPDATE_LABELS[state.status];
    $('update').hidden = !label;
    if (!label) return;
    $('update-label').textContent = label(state);
    $('update').disabled = state.status === 'downloading' || state.status === 'installing';
    $('update').title = state.status === 'manual'
      ? 'Не получилось обновить. Откроется страница со свежей версией'
      : `Новая версия ${state.version}. Приложение перезапустится`;
  }

  desktop.onUpdateState(showUpdate);
  desktop.updateState().then(showUpdate);

  desktop.onSettingsState(({ open, page }) => {
    $('jam').setAttribute('aria-expanded', String(open && page === 'main'));
    $('settings').setAttribute('aria-pressed', String(open && page === 'settings'));
  });

  // Джем и настройки открываются под своими кнопками, а их положение знает только эта страница.
  function rectOf(id) {
    const { left, right, top, bottom } = $(id).getBoundingClientRect();
    return { left, right, top, bottom };
  }
  function reportAnchor() {
    desktop.setToolbarAnchors({ main: rectOf('jam'), settings: rectOf('settings') });
  }
  // Кнопка настроек стоит справа и сдвигается вместе с шириной окна.
  const anchorWatcher = new ResizeObserver(reportAnchor);
  for (const node of [$('jam'), document.body]) anchorWatcher.observe(node);
  reportAnchor();

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function roomChip(status) {
    const connected = status.conn === 'open' && status.state;
    if (!connected) {
      return el('span', 'chip text', status.conn === 'connecting' ? 'подключаюсь…' : 'нет связи');
    }
    const { members } = status.state;
    const chip = el('span', 'chip');
    const stack = el('span', 'stack');
    members.slice(0, MAX_AVATARS).forEach((m, i) => {
      const avatar = el('span', 'avatar', YJam.initial(m.name));
      avatar.style.background = YJam.avatarColor(i);
      stack.append(avatar);
    });
    chip.append(stack, String(members.length));
    if (status.warning) chip.append(el('span', 'attn'));
    return chip;
  }

  // Статус приходит каждую секунду, а меняется редко: не перерисовываем зря, иначе мигает подсказка.
  let shownKey = '';
  desktop.onStatus(({ status }) => {
    const room = status && status.room;
    const members = (status && status.state && status.state.members) || [];
    const key = JSON.stringify([room, room && status.conn, !!(status && status.state), members.map((m) => m.name), !!(status && status.warning)]);
    if (key === shownKey) return;
    shownKey = key;

    $('jam-room').replaceChildren(...(room ? [roomChip(status)] : []));
    $('jam').title = room ? `Комната ${room}` : 'Джем';
    reportAnchor();
  });
})();
