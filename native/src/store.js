// Настройки приложения и джема в одном JSON-файле. Интерфейс — как у chrome.storage.local,
// потому что код расширения работает с ними напрямую.

const fs = require('fs');
const path = require('path');

function createStore(file, onChange) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    // файла ещё нет или он испорчен — начинаем с чистых настроек
  }

  function save() {
    // через временный файл: при падении во время записи настройки не потеряются
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  function get(keys) {
    if (keys === null || keys === undefined) return { ...data };
    if (typeof keys === 'string') keys = [keys];
    const result = {};
    if (Array.isArray(keys)) {
      for (const k of keys) if (k in data) result[k] = data[k];
    } else {
      for (const k of Object.keys(keys)) result[k] = k in data ? data[k] : keys[k];
    }
    return result;
  }

  function set(items) {
    const changes = {};
    for (const [k, value] of Object.entries(items)) {
      if (JSON.stringify(data[k]) === JSON.stringify(value)) continue;
      changes[k] = { oldValue: data[k], newValue: value };
      data[k] = value;
    }
    if (Object.keys(changes).length) {
      save();
      onChange(changes);
    }
  }

  function remove(keys) {
    const changes = {};
    for (const k of [].concat(keys)) {
      if (!(k in data)) continue;
      changes[k] = { oldValue: data[k] };
      delete data[k];
    }
    if (Object.keys(changes).length) {
      save();
      onChange(changes);
    }
  }

  return { get, set, remove };
}

module.exports = { createStore };
