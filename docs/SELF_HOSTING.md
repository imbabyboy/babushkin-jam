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
- `Caddyfile` — Caddy принимает HTTPS на порту 8443 (меняется через `JAM_HTTPS_PORT`), сам получает сертификат Let's Encrypt и проксирует на контейнер сервера;
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

Порт 80 нужен Let's Encrypt для проверки домена. HTTPS вынесен с 443 на отдельный порт, чтобы не мешать другому сервису на том же VPS.

Если порты 80 или 8443 заняты, задайте в `deploy/.env` `JAM_HTTPS_PORT` (свободный порт) и `JAM_HTTP_PUBLISH=127.0.0.1:8081`. Адрес для попапа тогда будет с вашим портом, а тот, кто держит порт 80, должен передавать домен в Caddy. Для nginx:

```nginx
server {
    listen 80;
    server_name <JAM_DOMAIN>;
    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host $host;
    }
}
```

Если на VPS включён ufw: порт, опубликованный Docker, он не закрывает.

Логи: `ssh $JAM_HOST docker logs -f yandex-jam`.

## Сервис ссылок на песню

Необязательный отдельный контейнер `song-links` рядом с сервером комнат, снаружи отвечает через Caddy на `/links/`. Сначала должен быть развёрнут сервер комнат: сервис использует его сеть Docker, Caddy и `deploy/.env`.

```sh
sh deploy/deploy-links.sh
```

Страница: `https://<JAM_DOMAIN>:<JAM_HTTPS_PORT>/links/`. Сервер комнат скрипт не перезапускает, Caddy только перечитывает настройки, поэтому активные комнаты могут на секунду переподключиться.

Ключи API лежат на сервере в `/opt/song-links/.env`, список — в [`links/.env.example`](../links/.env.example). Кэш хранится на томе Docker `song-links-data`.

`deploy/deploy.sh` кладёт на сервер `Caddyfile` из текущей ветки. Если в ней нет пути `/links/`, сервис пропадёт снаружи.

## Сервер по умолчанию в расширении

Адрес, к которому расширение подключается после установки, задан в `SERVER_URL` в [`extension/src/shared.js`](../extension/src/shared.js). Чтобы раздавать сборку со своим сервером, поменяйте его там. Если меняете адрес у уже установленных копий, поднимите `SETTINGS_VERSION` и добавьте миграцию в `ensureSettings()`.
