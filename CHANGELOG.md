# Изменения

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [SemVer](https://semver.org/lang/ru/). Версия расширения — `version` в `extension/manifest.json`.

## [Unreleased]

## [0.3.0] — 2026-10-06

Первая публичная версия.

### Добавлено
- Комнаты джема: кто переключил трек — ведущий; пауза и перемотка от любого участника применяются ко всем; автопереход на следующий трек ведущего.
- Защита от эха и версии состояния комнаты.
- Подстройка рассинхрона по часам сервера (порог 2 с).
- Панель «🎧 Джем» на music.yandex.ru и приглашения по ссылке `?jam=КОД`.
- Попап: имя, сервер, комната, состояние сервера, диагностика.
- Сервер комнат на Node.js + `ws`, деплой в Docker с Caddy; адрес VPS и домен задаются через `JAM_HOST` и `JAM_DOMAIN`.
- Документация в `docs/`, CI и сборка релиза в GitHub Actions.

[Unreleased]: https://github.com/imbabyboy/babushkin-jam/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/imbabyboy/babushkin-jam/releases/tag/v0.3.0
