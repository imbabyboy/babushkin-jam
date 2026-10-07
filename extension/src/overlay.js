// Панель джема поверх сайта (макет «Babushkin Jam UI», состояния 1e/1f): пилюля «Джем» с участниками
// и раскрывающаяся панель — комната, лобби (создать / войти по коду) или приглашение.
// Стили изолированы в Shadow DOM, чтобы сайт и панель не ломали друг друга.
// Логики комнаты здесь нет: панель показывает то, что передал content.js, и зовёт его actions.

var YJamOverlay = (() => {
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .wrap {
      --bg: #1C1C1C; --field: #262626; --field-line: #333; --line: #2A2A2A; --fg: #F2F2F2;
      --soft: #C9C9C9; --muted: #9E9E9E; --muted2: #8A8A8A; --placeholder: #6E6E6E;
      --accent: #FFDB4D; --accent-hover: #FFE680;
      --sans: "YJam Golos", system-ui, -apple-system, sans-serif;
      --mono: "YJam Mono", ui-monospace, Menlo, monospace;
      position: fixed; right: 116px; bottom: 96px; z-index: 2147483647;
      display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
      color: var(--fg); font: 14px/1.35 var(--sans); -webkit-font-smoothing: antialiased;
    }
    button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; }
    input { font: inherit; }
    svg { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; }

    /* ---------- пилюля ---------- */
    .pill {
      height: 36px; display: flex; align-items: center; gap: 10px; padding: 0 6px 0 12px;
      background: #2A2A2A; border: 1px solid #3A3A3A; border-radius: 18px;
      box-shadow: 0 8px 24px rgba(0,0,0,.5); font-size: 13px; font-weight: 600; white-space: nowrap;
    }
    .pill:hover { background: #313131; }
    .pill.solo { padding-right: 14px; }
    .pill .phones { width: 15px; height: 15px; stroke: var(--accent); stroke-width: 2.2; flex: none; }
    .pill.alert { background: var(--accent); border-color: var(--accent); color: #121212; padding-right: 14px; }
    .pill.alert .phones { stroke: #121212; }
    .chip {
      display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px 0 4px;
      background: var(--bg); border-radius: 14px; font-size: 12.5px; font-weight: 400; color: var(--soft);
    }
    .chip.text { padding: 0 9px; }
    .stack { display: flex; }
    .stack .avatar { width: 18px; height: 18px; border: 2px solid var(--bg); font-size: 9px; }
    .stack .avatar + .avatar { margin-left: -6px; }
    .attn { width: 6px; height: 6px; border-radius: 50%; background: #FFB38A; flex: none; }

    /* ---------- панель ---------- */
    .panel {
      width: 296px; padding: 14px; display: flex; flex-direction: column; gap: 14px;
      background: var(--bg); border: 1px solid var(--field-line); border-radius: 14px;
      box-shadow: 0 18px 44px rgba(0,0,0,.6);
    }
    .head { display: flex; align-items: center; justify-content: space-between; }
    .head-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .head-left .phones { width: 18px; height: 18px; stroke: var(--accent); stroke-width: 2; flex: none; }
    .code { font: 700 18px/1.2 var(--mono); letter-spacing: .08em; }
    .title { font-size: 15px; font-weight: 700; }
    .badge { font-size: 11px; font-weight: 600; color: var(--muted); border: 1px solid #3A3A3A; border-radius: 5px; padding: 1px 5px; }
    .close {
      width: 28px; height: 28px; border-radius: 8px; flex: none;
      display: flex; align-items: center; justify-content: center; color: var(--muted2);
    }
    .close:hover { background: var(--line); color: var(--fg); }
    .close svg { width: 15px; height: 15px; stroke-width: 2; }

    .section { display: flex; flex-direction: column; gap: 14px; }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .label { font-size: 13px; color: var(--muted); }
    .input {
      width: 100%; height: 40px; padding: 0 12px; outline: none;
      background: var(--field); border: 1px solid var(--field-line); border-radius: 10px;
      color: var(--fg); font-size: 14.5px;
    }
    .input::placeholder { color: var(--placeholder); }
    .input:focus { border: 1.5px solid var(--accent); padding: 0 11.5px; }
    .mono { font: 500 14px var(--mono); letter-spacing: .06em; text-transform: uppercase; }
    .row { display: flex; gap: 8px; }
    .row > .input { flex: 1; min-width: 0; }
    .sep { height: 1px; background: var(--line); }

    .btn-primary {
      height: 42px; border-radius: 11px; background: var(--accent); color: #121212;
      display: flex; align-items: center; justify-content: center; gap: 7px;
      font-size: 14.5px; font-weight: 600;
    }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-primary svg { width: 15px; height: 15px; stroke-width: 2; }
    .btn-secondary { height: 40px; padding: 0 16px; border-radius: 10px; background: #2E2E2E; font-weight: 600; }
    .btn-secondary:hover { background: #383838; }
    .btn-outline {
      height: 40px; border: 1px solid #3A3A3A; border-radius: 10px;
      color: var(--soft); font-weight: 500;
    }
    .btn-outline:hover { background: var(--field); color: var(--fg); }
    .share { display: flex; flex-direction: column; gap: 8px; }
    .invite-link {
      font: 500 12px/1.3 var(--mono); color: var(--muted2); text-align: center;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .copy .icon-done, .copy.done .icon-copy { display: none; }
    .copy.done .icon-done { display: block; }

    .members { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
    .member { display: flex; align-items: center; gap: 10px; height: 32px; }
    .avatar {
      width: 24px; height: 24px; border-radius: 50%; flex: none;
      display: flex; align-items: center; justify-content: center;
      color: #121212; font-size: 12px; font-weight: 700;
    }
    .member-name { flex: 1; min-width: 0; display: flex; gap: 6px; align-items: baseline; font-size: 14px; }
    .member-name > span:first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .you { flex: none; font-size: 12px; color: var(--muted2); }
    .host { flex: none; display: flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; color: var(--accent); }
    .host svg { width: 12px; height: 12px; fill: currentColor; stroke: none; }
    .alone { font-size: 12px; line-height: 1.45; color: var(--muted); padding-top: 4px; }
    .people { display: flex; flex-direction: column; gap: 2px; }

    .now { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 10px 12px; background: #232323; border-radius: 10px; }
    .now svg { width: 12px; height: 12px; fill: var(--muted2); stroke: none; flex: none; }
    .now span { font-size: 13px; color: #BDBDBD; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status { font-size: 12.5px; color: var(--muted); }

    .invite-text { display: flex; flex-direction: column; gap: 2px; }
    .warn { padding: 8px 10px; border-radius: 10px; background: #3A2A10; color: #FFCF8A; font-size: 12.5px; line-height: 1.4; }
  `;

  const PHONES = '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>';
  const ICON_PAUSE = '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>';
  const ICON_PLAY = '<path d="M7 5l12 7-12 7z"/>';
  const ICON_CROWN = '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>';
  const svg = (markup, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${markup}</svg>`;

  const HTML = `
    <div class="wrap">
      <div class="panel" hidden>
        <div class="head">
          <div data-el="head-room" class="head-left">${svg(PHONES, 'phones')}<span data-el="room-code" class="code"></span></div>
          <div data-el="head-lobby" class="head-left">
            ${svg(PHONES, 'phones')}<span class="title">babushkin-jam</span><span data-el="badge" class="badge" hidden>local</span>
          </div>
          <button class="close" title="Свернуть">${svg('<path d="M6 6l12 12M18 6L6 18"/>')}</button>
        </div>

        <div data-el="invite" class="section" hidden>
          <div class="invite-text">
            <span class="label">Вас позвали в джем</span>
            <span data-el="invite-code" class="code"></span>
          </div>
          <label class="field" data-el="invite-name-box"><span class="label">Ваше имя</span></label>
          <button data-el="invite-join" class="btn-primary">Войти в джем</button>
        </div>

        <div data-el="setup" class="section" hidden>
          <label class="field" data-el="name-box">
            <span class="label">Ваше имя</span>
            <input data-el="name" class="input" maxlength="40" placeholder="Гость" autocomplete="off">
          </label>
          <button data-el="create" class="btn-primary">Создать комнату</button>
          <div class="sep"></div>
          <div class="field">
            <span class="label">Есть код от друга?</span>
            <div class="row">
              <input data-el="code" class="input mono" maxlength="12" placeholder="КОД" spellcheck="false" autocomplete="off">
              <button data-el="join" class="btn-secondary">Войти</button>
            </div>
          </div>
        </div>

        <div data-el="room" class="section" hidden>
          <div data-el="status" class="status" hidden></div>
          <div class="people">
            <ul data-el="members" class="members"></ul>
            <div data-el="alone" class="alone" hidden>Пока только вы. Отправьте ссылку другу.</div>
          </div>
          <div class="share">
            <button data-el="copy" class="btn-primary copy">
              ${svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', 'icon-copy')}
              ${svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'icon-done')}
              <span data-el="copy-label">Скопировать ссылку</span>
            </button>
            <div data-el="invite-link" class="invite-link"></div>
          </div>
          <div data-el="now" class="now" hidden><svg data-el="now-icon" viewBox="0 0 24 24" aria-hidden="true"></svg><span data-el="now-text"></span></div>
          <button data-el="leave" class="btn-outline">Выйти из комнаты</button>
        </div>

        <div data-el="warn" class="warn" hidden></div>
      </div>
      <button class="pill"></button>
    </div>
  `;

  function create(actions) {
    YJam.loadFonts();

    const host = document.createElement('div');
    host.id = 'yandex-jam-overlay';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>${HTML}`;
    const $ = (name) => root.querySelector(`[data-el="${name}"]`);
    const panel = root.querySelector('.panel');
    const pill = root.querySelector('.pill');
    $('badge').hidden = !YJam.IS_LOCAL;

    let open = false;
    let view = null;
    let inviteDismissed = false;
    let nameTouched = false;

    const nameValue = () => $('name').value.trim();

    function setOpen(v) {
      open = v;
      if (!v && view && view.invite) inviteDismissed = true;
      render();
    }

    pill.onclick = () => {
      if (view && view.autoplayBlocked) { actions.unblock(); return; }
      setOpen(!open);
    };
    root.querySelector('.close').onclick = () => setOpen(false);
    $('name').oninput = () => { nameTouched = true; };
    $('name').onchange = () => { if (nameValue()) actions.rename(nameValue()); };
    $('create').onclick = () => actions.create(nameValue());
    $('join').onclick = () => {
      const code = YJam.normalizeCode($('code').value);
      if (!code) { $('code').focus(); return; }
      actions.join(code, nameValue());
    };

    // Сайт ловит хоткеи (пробел — пауза и т.п.) на window/document, а события из Shadow DOM
    // всплывают туда же. Пока печатаем в своём поле, гасим клавиши на window в фазе погружения:
    // панель создаётся на document_start, поэтому этот обработчик срабатывает раньше сайтовых.
    // Ввод текста не страдает — stopImmediatePropagation не отменяет действие по умолчанию.
    // Обработчики самих полей после этого не вызываются, поэтому Enter обрабатываем здесь.
    const typing = (e) => {
      const t = e.composedPath()[0];
      return t && t.tagName === 'INPUT' && t.getRootNode() === root ? t : null;
    };
    for (const type of ['keydown', 'keypress', 'keyup']) {
      window.addEventListener(type, (e) => {
        const input = typing(e);
        if (!input) return;
        e.stopImmediatePropagation();
        if (type !== 'keydown' || e.key !== 'Enter' || e.isComposing) return;
        if (input === $('code')) $('join').click();
        else input.blur(); // имя сохранится по change
      }, true);
    }
    $('invite-join').onclick = () => actions.join(view.invite, nameValue());
    $('leave').onclick = () => actions.leave();

    let copiedTimer = null;
    $('copy').onclick = async () => {
      await copyText(YJam.inviteLink(view.room));
      $('copy').classList.add('done');
      $('copy-label').textContent = 'Ссылка скопирована';
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        $('copy').classList.remove('done');
        $('copy-label').textContent = 'Скопировать ссылку';
      }, 1000);
    };

    async function copyText(text) {
      try { await navigator.clipboard.writeText(text); return; } catch (e) {}
      const ta = document.createElement('textarea');
      ta.value = text;
      root.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }

    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }

    function avatar(m, i) {
      const a = el('div', 'avatar', YJam.initial(m.name));
      a.style.background = YJam.avatarColor(i);
      return a;
    }

    const connected = (v) => v.conn === 'open' && !!v.state;

    // В пилюле только то, что нужно видеть краем глаза: что джем идёт и кто в нём.
    let pillKey = '';
    function renderPill(v, showInvite) {
      const members = connected(v) ? v.state.members : [];
      const key = JSON.stringify([v.autoplayBlocked, v.room, showInvite, v.conn, !!v.state,
        members.map((m) => m.name), !!v.warning]);
      if (key === pillKey) return;
      pillKey = key;

      pill.className = 'pill';
      pill.innerHTML = svg(PHONES, 'phones');
      if (v.autoplayBlocked) {
        pill.classList.add('alert');
        pill.append('Нажмите, чтобы включить звук');
        return;
      }
      if (!v.room) {
        pill.classList.add('solo');
        pill.append(showInvite ? 'Вас позвали в джем' : 'Джем');
        return;
      }
      pill.append('Джем');
      if (!connected(v)) {
        pill.append(el('span', 'chip text', v.conn === 'connecting' ? 'подключаюсь…' : 'нет связи'));
        return;
      }
      const chip = el('span', 'chip');
      const stack = el('span', 'stack');
      members.slice(0, 3).forEach((m, i) => stack.appendChild(avatar(m, i)));
      chip.append(stack, String(members.length));
      if (v.warning) chip.appendChild(el('span', 'attn'));
      pill.appendChild(chip);
    }

    function memberRow(m, i, v) {
      const li = el('li', 'member');
      const name = el('div', 'member-name');
      name.appendChild(el('span', '', m.name));
      if (m.id === v.clientId) name.appendChild(el('span', 'you', 'вы'));
      li.append(avatar(m, i), name);
      if (m.id === v.state.leaderId) {
        const h = el('div', 'host');
        h.innerHTML = svg(ICON_CROWN);
        h.append('ведущий');
        li.appendChild(h);
      }
      return li;
    }

    function renderRoom(v) {
      $('room-code').textContent = v.room;
      $('invite-link').textContent = YJam.inviteLink(v.room).replace(/^https:\/\//, '');
      const st = connected(v) ? v.state : null;

      $('status').hidden = !!st;
      $('status').textContent = v.conn === 'connecting' ? 'Подключаюсь…' : 'Нет связи с сервером, переподключаюсь…';

      const members = st ? st.members : [];
      $('members').replaceChildren(...members.map((m, i) => memberRow(m, i, v)));
      $('alone').hidden = members.length !== 1;

      const t = st && st.track;
      $('now').hidden = !st;
      if (st) {
        $('now-icon').innerHTML = t && !st.paused ? ICON_PLAY : ICON_PAUSE;
        $('now-text').textContent = t
          ? (t.artist ? t.artist + ' — ' : '') + (t.title || 'название неизвестно')
          : 'Ничего не играет. Включите трек — станете ведущим.';
      }
    }

    function render() {
      if (!view) return;
      const v = view;
      const showInvite = !!v.invite && v.invite !== v.room && !inviteDismissed;

      renderPill(v, showInvite);
      panel.hidden = !open;
      if (!open) return;

      if (!nameTouched && document.activeElement !== host && v.name && $('name').value !== v.name) {
        $('name').value = v.name;
      }
      // одно поле имени на лобби и приглашение — переносим его туда, где оно видно
      const nameBox = showInvite ? $('invite-name-box') : $('name-box');
      if ($('name').parentNode !== nameBox) nameBox.appendChild($('name'));

      $('invite').hidden = !showInvite;
      $('invite-code').textContent = v.invite || '';
      $('setup').hidden = !!v.room || showInvite;
      $('room').hidden = !v.room || showInvite;
      $('head-room').hidden = !v.room || showInvite;
      $('head-lobby').hidden = !!v.room && !showInvite;
      if (v.room && !showInvite) renderRoom(v);

      $('warn').hidden = !v.warning;
      $('warn').textContent = v.warning || '';
    }

    // Вставляем панель только после загрузки страницы и паузы: если добавить элемент в <body>
    // до того, как React закончит гидратацию, сайт ловит React error #418.
    let mountScheduled = false;
    function mount() {
      if (host.isConnected || mountScheduled) return;
      mountScheduled = true;
      const attach = () => setTimeout(() => document.body.appendChild(host), 1500);
      if (document.readyState === 'complete') attach();
      else window.addEventListener('load', attach, { once: true });
    }

    return {
      update(v) {
        const first = !view;
        view = v;
        mount();
        // приглашение — сразу раскрываем панель, чтобы осталось нажать «Войти»
        if (first && v.invite && v.invite !== v.room) open = true;
        render();
      },
    };
  }

  return { create };
})();
