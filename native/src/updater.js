// Обновление приложения из релизов GitHub. Подписи разработчика нет, поэтому штатный автообновлятор на macOS не работает.
// Проверяет последний релиз, а по клику скачивает файл под свою систему, сверяет сумму, ставит и перезапускает приложение.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const run = promisify(execFile);

const RELEASE_API = 'https://api.github.com/repos/imbabyboy/babushkin-jam/releases/latest';
const FIRST_CHECK_MS = 10 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 15 * 1000;
const STALL_TIMEOUT_MS = 60 * 1000;   // загрузка без единого нового байта
const BUSY = new Set(['downloading', 'installing']);

// Заменяет приложение после его закрытия: на macOS работающее приложение нельзя заменить изнутри.
// Если замена не удалась, возвращает старую версию на место.
const MAC_SWAP_SCRIPT = `#!/bin/sh
pid=$1; app=$2; staged=$3; temp=$4
i=0
while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 60 ]; do sleep 0.5; i=$((i + 1)); done
if ! kill -0 "$pid" 2>/dev/null && mv "$app" "$app.old"; then
  if mv "$staged" "$app"; then rm -rf "$app.old"; else mv "$app.old" "$app"; fi
fi
rm -rf "$staged"
open "$app"
rm -rf "$temp"
`;

function assetName(platform, arch) {
  if (platform === 'win32') return 'babushkin-jam-windows.exe';
  if (platform === 'darwin') return arch === 'arm64' ? 'babushkin-jam-mac-apple-silicon.dmg' : 'babushkin-jam-mac-intel.dmg';
  return null;
}

function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text));
  return match ? match.slice(1).map(Number) : null;
}

function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  const index = a.findIndex((n, i) => n !== b[i]);
  return index !== -1 && a[index] > b[index];
}

// Папка приложения .app по пути к его исполняемому файлу.
function macBundlePath(execPath) {
  return path.resolve(execPath, '..', '..', '..');
}

// Нельзя заменить приложение, запущенное из dmg или лежащее там, куда нет прав на запись.
function canReplaceMacApp(bundle) {
  if (!bundle.endsWith('.app')) return false;
  try {
    fs.accessSync(bundle, fs.constants.W_OK);
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function createUpdater({ version, platform, arch, execPath, pid, tempDir, fetch, openReleases, quit, onChange }) {
  let state = { status: 'idle', version: null, percent: 0 };
  let release = null;

  function set(patch) {
    state = { ...state, ...patch };
    onChange(state);
  }

  async function check() {
    if (BUSY.has(state.status) || state.status === 'manual') return;
    try {
      const res = await fetch(RELEASE_API, {
        headers: { accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
      const latest = await res.json();
      if (!isNewer(latest.tag_name, version)) return;
      const asset = (latest.assets || []).find((a) => a.name === assetName(platform, arch));
      if (!asset) return;
      release = { url: asset.browser_download_url, digest: asset.digest, name: asset.name };
      set({ status: 'available', version: latest.tag_name.replace(/^v/, '') });
    } catch (err) {
      // Нет сети или исчерпан лимит запросов к GitHub: проверим в следующий раз.
      console.warn('Проверка обновлений:', err.message);
    }
  }

  async function download() {
    const controller = new AbortController();
    let stall;
    const armStall = () => {
      clearTimeout(stall);
      stall = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    };
    const file = path.join(tempDir, release.name);
    armStall();
    const out = await fs.promises.open(file, 'w');
    try {
      const res = await fetch(release.url, { signal: controller.signal });
      if (!res.ok) throw new Error(`загрузка: ответ ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      const hash = crypto.createHash('sha256');
      let received = 0;
      for await (const chunk of res.body) {
        armStall();
        hash.update(chunk);
        await out.write(chunk);
        received += chunk.length;
        const percent = total ? Math.floor((received / total) * 100) : 0;
        if (percent !== state.percent) set({ percent });
      }
      if (`sha256:${hash.digest('hex')}` !== release.digest) throw new Error('контрольная сумма не совпала');
    } finally {
      clearTimeout(stall);
      await out.close();
    }
    return file;
  }

  // Копирует новую версию рядом со старой, пока приложение ещё работает: ошибка здесь никому не помешает.
  async function installMac(file) {
    const bundle = macBundlePath(execPath);
    const staged = `${bundle}.new`;
    const mount = path.join(tempDir, 'mount');
    await fs.promises.rm(staged, { recursive: true, force: true });
    await fs.promises.mkdir(mount);
    await run('hdiutil', ['attach', file, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount]);
    try {
      const name = fs.readdirSync(mount).find((entry) => entry.endsWith('.app'));
      if (!name) throw new Error('в dmg нет приложения');
      await run('ditto', [path.join(mount, name), staged]);
    } finally {
      await run('hdiutil', ['detach', mount, '-force']);
    }
    const script = path.join(tempDir, 'install.sh');
    fs.writeFileSync(script, MAC_SWAP_SCRIPT);
    await startDetached('/bin/sh', [script, String(pid), bundle, staged, tempDir]);
  }

  // Установщик сам дождётся закрытия приложения и запустит его снова. --updated оставляет прежнюю папку установки.
  function installWindows(file) {
    return startDetached(file, ['--updated', '/S', '--force-run']);
  }

  function startDetached(command, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  async function install() {
    if (state.status === 'manual') return openReleases();
    if (state.status !== 'available') return undefined;
    if (platform === 'darwin' && !canReplaceMacApp(macBundlePath(execPath))) return openReleases();
    try {
      set({ status: 'downloading', percent: 0 });
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      await fs.promises.mkdir(tempDir, { recursive: true });
      const file = await download();
      set({ status: 'installing' });
      await (platform === 'darwin' ? installMac(file) : installWindows(file));
      return quit();
    } catch (err) {
      console.warn('Обновление:', err.message);
      return set({ status: 'manual' });
    }
  }

  // Временные файлы прошлого обновления: работающий установщик не мог удалить сам себя.
  function cleanup() {
    fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    if (platform === 'darwin') {
      fs.promises.rm(`${macBundlePath(execPath)}.new`, { recursive: true, force: true }).catch(() => {});
    }
  }

  function start() {
    cleanup();
    setTimeout(check, FIRST_CHECK_MS);
    setInterval(check, CHECK_EVERY_MS);
  }

  return { start, check, install, getState: () => state };
}

module.exports = { createUpdater, isNewer, assetName };
