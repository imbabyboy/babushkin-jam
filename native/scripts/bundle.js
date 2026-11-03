// Собирает native/generated/: код джема живёт в shared/, попап — в extension/, копий в приложении нет.
// Preload в песочнице Electron не может подключать соседние файлы, поэтому склеиваем их в один.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, '..', 'extension');
const SHARED = path.join(ROOT, '..', 'shared');
const OUT = path.join(ROOT, 'generated');

const readExt = (file) => fs.readFileSync(path.join(EXT, file), 'utf8');
const readShared = (file) => fs.readFileSync(path.join(SHARED, file), 'utf8');
const readSrc = (file) => fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');

// Подстановка функцией: в коде расширения есть «$&» и подобное, replace со строкой их бы исказил.
const fill = (text, marker, value) => text.replace(marker, () => value);

// Правки попапа для приложения. Если текст в расширении изменится, сборка упадёт, а не потеряет правку молча.
function patch(text, from, to) {
  if (!text.includes(from)) throw new Error('В попапе расширения больше нет текста: ' + from);
  return text.replace(from, () => to);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const shim = readSrc('preload/chrome-shim.js');

let music = readSrc('preload/music.js');
music = fill(music, '/*__CHROME_SHIM__*/', shim);
music = fill(music, '/*__PAGE_JS__*/', JSON.stringify(readShared('page.js')));
music = fill(music, '/*__EXTENSION_SCRIPTS__*/', [readShared('shared.js'), readSrc('preload/no-overlay.js'), readShared('content.js')].join('\n'));
fs.writeFileSync(path.join(OUT, 'preload-music.js'), music);

fs.writeFileSync(path.join(OUT, 'preload-app.js'), fill(readSrc('preload/app.js'), '/*__CHROME_SHIM__*/', shim));

// shared.js нужен и окнам приложения: коды комнат, ссылка-приглашение, шрифты, цвета участников.
fs.copyFileSync(path.join(SHARED, 'shared.js'), path.join(OUT, 'shared.js'));
fs.cpSync(path.join(SHARED, 'fonts'), path.join(OUT, 'fonts'), { recursive: true });

// Окно настроек — попап расширения с дополнением для приложения (src/settings/).
const SETTINGS = path.join(OUT, 'settings');
fs.mkdirSync(SETTINGS);
fs.copyFileSync(path.join(EXT, 'popup/popup.css'), path.join(SETTINGS, 'popup.css'));

let popupHtml = readExt('popup/popup.html');
popupHtml = patch(popupHtml, '<meta charset="utf-8">', `<meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src yjam-asset:; connect-src ws: wss:">
  <title>babushkin-jam — настройки</title>`);
popupHtml = patch(popupHtml, '<link rel="stylesheet" href="popup.css">', `<link rel="stylesheet" href="popup.css">
  <link rel="stylesheet" href="../../src/settings/settings.css">`);
popupHtml = patch(popupHtml, '<script src="../src/shared.js"></script>', `<script src="../../src/mini/chrome-alias.js"></script>
  <script src="../shared.js"></script>`);
popupHtml = patch(popupHtml, '<script src="popup.js"></script>', `<script src="popup.js"></script>
  <script src="../../src/settings/settings.js"></script>`);
popupHtml = patch(popupHtml, 'Неофициальное расширение, не связано с Яндексом.', 'Неофициальное приложение, не связано с Яндексом.');
fs.writeFileSync(path.join(SETTINGS, 'popup.html'), popupHtml);

let popupJs = readExt('popup/popup.js');
popupJs = patch(popupJs, 'Перезагрузите вкладку Яндекс Музыки, чтобы расширение подключилось.', 'Яндекс Музыка загружается…');
popupJs = patch(popupJs, 'Откройте Яндекс Музыку (music.yandex.ru или music.yandex.com) в этом браузере.', 'Войдите в Яндекс в главном окне приложения.');
popupJs = patch(popupJs, 'Chrome не включает звук, пока на странице Яндекс Музыки ни разу не кликнули. Кликните там в любом месте — дальше кнопки будут работать.', 'Звук не включился. Кликните в любом месте главного окна.');
popupJs = patch(popupJs, "'нет вкладки Яндекс Музыки'];", "'Яндекс Музыка не открыта'];");
popupJs = patch(popupJs, "{ error: 'нет вкладки Яндекс Музыки' }", "{ error: 'Яндекс Музыка не открыта' }");
fs.writeFileSync(path.join(SETTINGS, 'popup.js'), popupJs);

console.log('generated/: расширение ' + JSON.parse(readExt('manifest.json')).version);
