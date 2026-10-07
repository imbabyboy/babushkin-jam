// Панель джема поверх сайта: создать комнату, войти по коду или по приглашению,
// участники, выйти. Стили изолированы в Shadow DOM, чтобы сайт и панель не ломали друг друга.
// Логики комнаты здесь нет: панель показывает то, что передал content.js, и зовёт его actions.

var YJamOverlay = (() => {
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font: 13px/1.35 system-ui, -apple-system, sans-serif; }
    .wrap { position: fixed; right: 16px; bottom: 96px; z-index: 2147483647;
      display: flex; flex-direction: column; align-items: flex-end; gap: 8px; color: #f5f5f7; }
    button { cursor: pointer; border: 0; border-radius: 10px; padding: 8px 12px;
      background: #3a3a3c; color: #f5f5f7; }
    button:hover { background: #48484a; }
    button.primary { background: #ffcc00; color: #000; font-weight: 600; }
    button.primary:hover { background: #ffd633; }
    button.link { background: none; padding: 0; color: #a1a1a6; text-decoration: underline; }
    .pill { border-radius: 999px; padding: 9px 14px; background: #1d1d1f;
      box-shadow: 0 4px 18px rgba(0,0,0,.45); max-width: 340px; text-align: left; }
    .pill.alert { background: #ffcc00; color: #000; font-weight: 600; }
    .panel { width: 280px; padding: 14px; border-radius: 14px; background: #1d1d1f;
      box-shadow: 0 8px 30px rgba(0,0,0,.5); display: flex; flex-direction: column; gap: 10px; }
    .head { display: flex; justify-content: space-between; align-items: center; }
    .head b { font-size: 15px; }
    .close { background: none; padding: 2px 6px; color: #a1a1a6; font-size: 16px; }
    label { display: flex; flex-direction: column; gap: 4px; color: #a1a1a6; }
    input { width: 100%; padding: 8px 10px; border-radius: 10px; border: 1px solid #3a3a3c;
      background: #2c2c2e; color: #f5f5f7; outline: none; }
    input:focus { border-color: #ffcc00; }
    .row { display: flex; gap: 8px; }
    .row > input { flex: 1; min-width: 0; text-transform: uppercase; letter-spacing: 1px; }
    .muted { color: #a1a1a6; }
    .code { font-size: 18px; font-weight: 700; letter-spacing: 2px; }
    ul { margin: 0; padding-left: 18px; }
    .warn { padding: 8px 10px; border-radius: 10px; background: #3a2a10; color: #ffcf8a; }
    .invite { padding: 10px; border-radius: 10px; background: #2c2c2e; }
    [hidden] { display: none !important; }
  `;

  const HTML = `
    <div class="wrap">
      <div class="panel" hidden>
        <div class="head"><b>babushkin-jam</b><button class="close" title="Свернуть">✕</button></div>

        <label data-el="name-box">Ваше имя <input data-el="name" maxlength="40"></label>

        <div data-el="invite" class="invite" hidden>
          Вас позвали в джем <span data-el="invite-code" class="code"></span>
          <div style="margin-top:8px"><button data-el="invite-join" class="primary">Войти в джем</button></div>
        </div>

        <div data-el="setup">
          <div style="display:flex;flex-direction:column;gap:8px">
            <button data-el="create" class="primary">Создать комнату</button>
            <div class="row">
              <input data-el="code" maxlength="12" placeholder="Код комнаты">
              <button data-el="join">Войти</button>
            </div>
          </div>
        </div>

        <div data-el="room" hidden style="display:flex;flex-direction:column;gap:8px">
          <div>Комната <span data-el="room-code" class="code"></span></div>
          <div data-el="role" class="muted"></div>
          <div data-el="track"></div>
          <ul data-el="members"></ul>
          <div class="row">
            <button data-el="copy" class="primary" style="flex:1">Скопировать ссылку</button>
            <button data-el="leave">Выйти</button>
          </div>
          <div data-el="copied" class="muted" hidden>Ссылка скопирована — отправьте её друзьям</div>
        </div>

        <div data-el="warn" class="warn" hidden></div>
      </div>
      <button class="pill"></button>
    </div>
  `;

  function create(actions) {
    const host = document.createElement('div');
    host.id = 'yandex-jam-overlay';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>${HTML}`;
    const $ = (name) => root.querySelector(`[data-el="${name}"]`);
    const panel = root.querySelector('.panel');
    const pill = root.querySelector('.pill');

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
    $('code').onkeydown = (e) => { if (e.key === 'Enter') $('join').click(); };
    $('invite-join').onclick = () => actions.join(view.invite, nameValue());
    $('leave').onclick = () => actions.leave();
    $('copy').onclick = async () => {
      await copyText(YJam.inviteLink(view.room));
      $('copied').hidden = false;
      setTimeout(() => ($('copied').hidden = true), 2500);
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

    function pillText(v) {
      if (v.autoplayBlocked) return '▶ Нажмите, чтобы включить звук джема';
      if (!v.room) return v.invite && !inviteDismissed ? '🎧 Вас позвали в джем' : '🎧 Джем';
      if (v.conn !== 'open' || !v.state) {
        return v.conn === 'connecting' ? `🎧 ${v.room} · подключаюсь…` : `🎧 ${v.room} · нет связи`;
      }
      const role = v.isLeader ? 'вы ведущий' : 'вы ведомый';
      return `🎧 ${v.room} · ${role} · ${v.state.members.length} чел.` + (v.warning ? ' · ⚠' : '');
    }

    function render() {
      if (!view) return;
      const v = view;
      const showInvite = !!v.invite && v.invite !== v.room && !inviteDismissed;

      pill.textContent = pillText(v);
      pill.classList.toggle('alert', !!v.autoplayBlocked);
      panel.hidden = !open;
      if (!open) return;

      if (!nameTouched && document.activeElement !== host && v.name && $('name').value !== v.name) {
        $('name').value = v.name;
      }
      $('name-box').hidden = !!v.room && !showInvite;
      $('invite').hidden = !showInvite;
      $('invite-code').textContent = v.invite || '';
      $('setup').hidden = !!v.room || showInvite;
      $('room').hidden = !v.room || showInvite;

      if (v.room) {
        $('room-code').textContent = v.room;
        const st = v.state;
        $('role').textContent = v.conn !== 'open' || !st
          ? (v.conn === 'connecting' ? 'подключаюсь…' : 'нет связи с сервером, переподключаюсь…')
          : (v.isLeader ? 'вы ведущий' : 'вы ведомый');
        $('track').textContent = st && st.track
          ? `${st.paused ? '⏸' : '▶'} ${st.track.artist} — ${st.track.title}`
          : 'Ничего не играет. Включите трек — станете ведущим.';
        const ul = $('members');
        ul.replaceChildren();
        for (const m of (st && st.members) || []) {
          const li = document.createElement('li');
          li.textContent = m.name + (m.id === st.leaderId ? ' 👑' : '') + (m.id === v.clientId ? ' (вы)' : '');
          ul.appendChild(li);
        }
      }

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
      collapse: () => setOpen(false),
      resetName: () => { nameTouched = false; },
    };
  }

  return { create };
})();
