const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createUpdater, isNewer, assetName } = require('../src/updater');

const sha256 = (data) => `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;

function tempFolder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-updater-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Ответы как у GitHub: описание релиза и сам файл.
function fakeGitHub({ tag = 'v2.0.0', name, file, digest }) {
  return async (url) => {
    if (url.includes('api.github.com')) {
      return Response.json({ tag_name: tag, assets: [{ name, digest, browser_download_url: 'https://example.test/file' }] });
    }
    return new Response(file, { headers: { 'content-length': String(file.length) } });
  };
}

function updater(root, overrides) {
  return createUpdater({
    version: '1.0.0',
    platform: 'win32',
    arch: 'x64',
    execPath: path.join(root, 'app.exe'),
    pid: process.pid,
    tempDir: path.join(root, 'temp'),
    fetch: fakeGitHub({ name: 'babushkin-jam-windows.exe', file: Buffer.from('x'), digest: sha256('x') }),
    openReleases: () => {},
    quit: () => {},
    onChange: () => {},
    ...overrides,
  });
}

test('сравнение версий', () => {
  assert.equal(isNewer('v1.2.19', '1.2.18'), true);
  assert.equal(isNewer('1.10.0', '1.9.9'), true);
  assert.equal(isNewer('v1.2.19', '1.2.19'), false);
  assert.equal(isNewer('1.2.17', '1.2.19'), false);
  assert.equal(isNewer('nightly', '1.2.19'), false);
});

test('файл выбирается под систему и процессор', () => {
  assert.equal(assetName('darwin', 'arm64'), 'babushkin-jam-mac-apple-silicon.dmg');
  assert.equal(assetName('darwin', 'x64'), 'babushkin-jam-mac-intel.dmg');
  assert.equal(assetName('win32', 'x64'), 'babushkin-jam-windows.exe');
});

test('кнопка появляется только для более новой версии', async (t) => {
  const root = tempFolder(t);
  const same = updater(root, { version: '2.0.0' });
  await same.check();
  assert.equal(same.getState().status, 'idle');

  const older = updater(root);
  await older.check();
  assert.deepEqual(older.getState(), { status: 'available', version: '2.0.0', percent: 0 });
});

test('сбой проверки не показывает кнопку', async (t) => {
  const down = updater(tempFolder(t), { fetch: async () => new Response('', { status: 403 }) });
  const warn = t.mock.method(console, 'warn', () => {});
  await down.check();
  assert.equal(down.getState().status, 'idle');
  assert.equal(warn.mock.callCount(), 1);
});

test('битый файл не устанавливается, кнопка ведёт на страницу релизов', async (t) => {
  const root = tempFolder(t);
  let quit = 0;
  let opened = 0;
  const u = updater(root, {
    fetch: fakeGitHub({ name: 'babushkin-jam-windows.exe', file: Buffer.from('подмена'), digest: sha256('оригинал') }),
    quit: () => { quit += 1; },
    openReleases: () => { opened += 1; },
  });
  t.mock.method(console, 'warn', () => {});
  await u.check();
  await u.install();
  assert.equal(u.getState().status, 'manual');
  assert.equal(quit, 0);
  await u.install();
  assert.equal(opened, 1);
});

test('приложение без прав на замену открывает страницу релизов', { skip: process.platform === 'win32' }, async (t) => {
  const root = tempFolder(t);
  let opened = 0;
  const u = updater(root, {
    platform: 'darwin',
    arch: 'arm64',
    execPath: '/Volumes/нет-такого/babushkin-jam.app/Contents/MacOS/babushkin-jam',
    fetch: fakeGitHub({ name: 'babushkin-jam-mac-apple-silicon.dmg', file: Buffer.from('x'), digest: sha256('x') }),
    openReleases: () => { opened += 1; },
  });
  await u.check();
  await u.install();
  assert.equal(opened, 1);
  assert.equal(u.getState().status, 'available');
});

test('macOS: замена приложения из настоящего dmg', { skip: process.platform !== 'darwin' }, async (t) => {
  const root = tempFolder(t);
  const makeApp = (folder, text) => {
    const macos = path.join(folder, 'babushkin-jam.app', 'Contents', 'MacOS');
    fs.mkdirSync(macos, { recursive: true });
    fs.writeFileSync(path.join(macos, 'babushkin-jam'), text);
  };
  makeApp(path.join(root, 'Applications'), 'старая');
  makeApp(path.join(root, 'dmg'), 'новая');
  const dmg = path.join(root, 'new.dmg');
  execFileSync('hdiutil', ['create', '-quiet', '-srcfolder', path.join(root, 'dmg'), '-format', 'UDZO', dmg]);
  const file = fs.readFileSync(dmg);

  // Вместо настоящего open: запуск новой версии только отмечаем.
  const bin = path.join(root, 'bin');
  const opened = path.join(root, 'opened');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'open'), `#!/bin/sh\nprintf '%s' "$1" > "${opened}"\n`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  t.after(() => { process.env.PATH = oldPath; });

  // «Приложение» закрывается через секунду, скрипт должен его дождаться.
  const running = spawn('sleep', ['1']);
  const app = path.join(root, 'Applications', 'babushkin-jam.app');
  const exe = path.join(app, 'Contents', 'MacOS', 'babushkin-jam');
  const tempDir = path.join(root, 'temp');
  let quit = 0;
  const percents = [];
  const u = updater(root, {
    platform: 'darwin',
    arch: 'arm64',
    execPath: exe,
    pid: running.pid,
    tempDir,
    fetch: fakeGitHub({ name: 'babushkin-jam-mac-apple-silicon.dmg', file, digest: sha256(file) }),
    quit: () => { quit += 1; },
    onChange: (state) => percents.push(state.percent),
  });
  await u.check();
  await u.install();
  assert.equal(quit, 1);
  assert.equal(percents.at(-1), 100);
  assert.equal(fs.readFileSync(exe, 'utf8'), 'старая', 'пока приложение работает, старая версия на месте');

  for (let i = 0; i < 100 && fs.existsSync(tempDir); i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.readFileSync(exe, 'utf8'), 'новая');
  assert.equal(fs.readFileSync(opened, 'utf8'), app);
  assert.equal(fs.existsSync(`${app}.new`), false);
  assert.equal(fs.existsSync(`${app}.old`), false);
  assert.equal(fs.existsSync(tempDir), false, 'временные файлы удалены');
});
