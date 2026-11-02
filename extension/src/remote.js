// Виджет на любом сайте, кроме Яндекс Музыки (включается в настройках попапа: «на всех сайтах»).
// Сам джем живёт во вкладке Яндекс Музыки: состояние и кнопки плеера идут туда через background.js,
// а создать/войти/выйти/имя — как и везде, записью в chrome.storage.local.

(() => {
  if (window.__yjamRemote) return; // фоновый скрипт мог уже вставить нас в эту вкладку
  window.__yjamRemote = true;

  const POLL_MS = 1000;

  const alive = () => !!(chrome.runtime && chrome.runtime.id); // расширение обновили/выключили
  const send = async (msg) => {
    try { return await chrome.runtime.sendMessage(msg); } catch (e) { return null; }
  };
  const ask = (msg) => send({ type: 'yjam:relay', msg });

  const overlay = YJamOverlay.create({
    async create(name) {
      await chrome.storage.local.set({ room: YJam.randomCode(), ...(name ? { name } : {}) });
      refresh();
    },
    async join(code, name) {
      await chrome.storage.local.set({ room: code, ...(name ? { name } : {}) });
      refresh();
    },
    async leave() {
      await chrome.storage.local.set({ room: '' });
      refresh();
    },
    async rename(name) {
      await chrome.storage.local.set({ name });
    },
    // звук включается только кликом по самой вкладке Яндекс Музыки — переключаемся на неё
    unblock() {
      send({ type: 'yjam:focus' });
    },
    async control(action) {
      await ask({ type: 'yjam:control', action });
      setTimeout(refresh, 300);
    },
  }, { remote: true });

  let busy = false;
  async function refresh() {
    if (busy) return;
    if (!alive()) { clearInterval(timer); overlay.remove(); return; }
    busy = true;
    try {
      const [s, st] = await Promise.all([chrome.storage.local.get(YJam.DEFAULTS), ask({ type: 'yjam:status' })]);
      overlay.update({
        conn: 'notab', state: null, warning: '', autoplayBlocked: false, controls: null,
        ...(st || {}),
        room: s.room, name: s.name, invite: null, remote: true,
      });
    } catch (e) {
    } finally {
      busy = false;
    }
  }

  // опрашиваем, только пока вкладку видно
  const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && alive()) refresh(); });
  refresh();
})();
