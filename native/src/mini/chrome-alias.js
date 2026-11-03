// Подключается раньше shared.js: тот обращается к chrome.* как в расширении.
window.chrome = window.desktopChrome;
