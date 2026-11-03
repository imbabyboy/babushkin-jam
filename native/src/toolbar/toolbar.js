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
  $('jam').onclick = () => desktop.toggleSettings();

  desktop.onSettingsState(({ open }) => $('jam').setAttribute('aria-expanded', String(open)));

  // Настройки открываются под кнопкой, а её положение знает только эта страница.
  function reportAnchor() {
    const { left, right, top, bottom } = $('jam').getBoundingClientRect();
    desktop.setJamAnchor({ left, right, top, bottom });
  }
  new ResizeObserver(reportAnchor).observe($('jam'));
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
