# Скачать сборки

Здесь всегда последняя версия. Старые версии и список изменений — на странице [всех релизов](https://github.com/imbabyboy/babushkin-jam/releases).

## Расширение для Chrome

**[babushkin-jam-extension.zip](https://github.com/imbabyboy/babushkin-jam/releases/latest/download/babushkin-jam-extension.zip)**

1. Распакуйте архив в папку, которую не будете удалять.
2. Откройте `chrome://extensions` и включите «Режим разработчика» (справа вверху).
3. «Загрузить распакованное» → выберите распакованную папку.
4. Перезагрузите вкладку music.yandex.ru, если она была открыта.

Такая копия не обновляется сама. Обновления приходят сами только при [установке из Chrome Web Store](https://chromewebstore.google.com/detail/babushkin-jam/iincaikpjidieflnaajiehogcimgbepe).

## Нативный плеер

Яндекс Музыка и джем без браузера. Подробнее — в [описании приложения](../native/README.md).

| Система | Файл |
| --- | --- |
| Mac с чипом Apple Silicon (M1 и новее) | [babushkin-jam-mac-apple-silicon.dmg](https://github.com/imbabyboy/babushkin-jam/releases/latest/download/babushkin-jam-mac-apple-silicon.dmg) |
| Mac с процессором Intel | [babushkin-jam-mac-intel.dmg](https://github.com/imbabyboy/babushkin-jam/releases/latest/download/babushkin-jam-mac-intel.dmg) |
| Windows | [babushkin-jam-windows.exe](https://github.com/imbabyboy/babushkin-jam/releases/latest/download/babushkin-jam-windows.exe) |

Какой у вас Mac, показано в меню Apple → «Об этом Mac».

### Первый запуск

Приложение пока не подписано сертификатом разработчика, поэтому система его предупредит:

- **macOS:** после установки выполните в Терминале `xattr -cr /Applications/babushkin-jam.app`.
- **Windows:** в окне SmartScreen нажмите «Подробнее» → «Выполнить в любом случае».
