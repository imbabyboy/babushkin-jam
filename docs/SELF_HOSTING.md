# Свой сервер

Сервер комнат — [`server/server.js`](../server/server.js): Node.js 18+ и пакет `ws`. Состояние хранится только в памяти.

## Локально

```sh
cd server
npm install
npm start               # ws://localhost:8787
PORT=9000 npm start     # другой порт
npm run dev             # node --watch, перезапуск при изменении кода
```

В VS Code то же самое — `Cmd+Shift+B` → «Сервер: watch».

Чтобы расширение подключилось к локальному серверу, впишите `ws://localhost:8787` в поле «Сервер» в попапе.

## На VPS с HTTPS

Страница music.yandex.ru открыта по HTTPS, поэтому снаружи сервер должен быть доступен по `wss://`. В папке [`deploy/`](../deploy) лежит готовая схема:

- `Dockerfile` — образ сервера на `node:22-alpine`;
- `Caddyfile` — Caddy принимает HTTPS на порту 8443, сам получает сертификат Let's Encrypt и проксирует на контейнер сервера;
- `deploy.sh` — копирует файлы на VPS, пересобирает образ и перезапускает контейнеры.

Нужны Docker на VPS, SSH-доступ и домен, который указывает на VPS. Если своего домена нет, подойдёт [sslip.io](https://sslip.io): имя `1-2-3-4.sslip.io` указывает на IP `1.2.3.4`.

1. Скопируйте `deploy/.env.example` в `deploy/.env` и впишите свои значения:

   ```sh
   JAM_HOST=root@203.0.113.10   # SSH-адрес VPS
   JAM_DOMAIN=jam.example.com   # домен для сертификата
   ```

   `deploy/.env` в git не попадает. Те же переменные можно передать через окружение.

2. Из корня репозитория:

   ```sh
   sh deploy/deploy.sh
   ```

3. Адрес для попапа — `wss://<JAM_DOMAIN>:8443`. Проверка: `https://<JAM_DOMAIN>:8443/` отвечает `babushkin-jam server: комнат N`, а `/privacy` открывает политику конфиденциальности.

Порт 80 должен быть свободен: он нужен Let's Encrypt для проверки домена. HTTPS вынесен на 8443, потому что на исходном VPS порт 443 занят VPN; если у вас он свободен, поменяйте `https_port` и проброс портов в `deploy.sh`.

Логи: `ssh $JAM_HOST docker logs -f yandex-jam`.

## Сервер по умолчанию в расширении

Адрес, к которому расширение подключается после установки, задан в `SERVER_URL` в [`extension/src/shared.js`](../extension/src/shared.js). Чтобы раздавать сборку со своим сервером, поменяйте его там. Если меняете адрес у уже установленных копий, поднимите `SETTINGS_VERSION` и добавьте миграцию в `ensureSettings()`.
