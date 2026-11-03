// Те части chrome.*, которыми пользуется код расширения. Настройки хранит главный процесс:
// так их видят и окно Музыки, и окно плеера, как в расширении — вкладка и попап.
function makeChrome(ipc) {
  const changeListeners = new Set();
  const messageListeners = new Set();

  ipc.on('yjam:storage-changed', (_e, changes) => {
    for (const fn of changeListeners) fn(changes, 'local');
  });

  return {
    storage: {
      local: {
        get: (keys) => ipc.invoke('yjam:storage-get', keys),
        set: (items) => ipc.invoke('yjam:storage-set', items),
        remove: (keys) => ipc.invoke('yjam:storage-remove', keys),
      },
      onChanged: { addListener: (fn) => { changeListeners.add(fn); } },
    },
    runtime: {
      id: 'babushkin-jam-desktop',
      getManifest: () => ({ name: 'babushkin-jam' }),
      getURL: (file) => 'yjam-asset://app/' + file,
      // Единственное такое сообщение — «Назад на сайт» виджета. В приложении вкладок нет.
      sendMessage: async () => null,
      onMessage: { addListener: (fn) => { messageListeners.add(fn); } },
    },
    _messageListeners: messageListeners,
  };
}
