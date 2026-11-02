#!/bin/sh
# Деплой сервера джема на VPS: копирует файлы, пересобирает образ, перезапускает контейнеры.
# Запуск из корня репозитория: sh deploy/deploy.sh
#
# Адрес сервера в репозитории не хранится. Нужны две переменные — в окружении
# или в файле deploy/.env (он в .gitignore, образец — deploy/.env.example):
#   JAM_HOST    SSH-адрес VPS, например root@203.0.113.10
#   JAM_DOMAIN  домен для HTTPS-сертификата, например jam.example.com
# Необязательные (если порты 80 и 8443 на VPS заняты):
#   JAM_HTTPS_PORT    порт HTTPS/WSS, по умолчанию 8443
#   JAM_HTTP_PUBLISH  куда публиковать HTTP-порт Caddy (нужен Let's Encrypt), по умолчанию 80.
#                     Например 127.0.0.1:8081, если порт 80 занят nginx и он проксирует туда домен.
set -e

ENV_FILE="$(dirname "$0")/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

: "${JAM_HOST:?не задан JAM_HOST — см. deploy/.env.example}"
: "${JAM_DOMAIN:?не задан JAM_DOMAIN — см. deploy/.env.example}"
JAM_HTTPS_PORT="${JAM_HTTPS_PORT:-8443}"
JAM_HTTP_PUBLISH="${JAM_HTTP_PUBLISH:-80}"

DIR=/opt/yandex-jam

ssh "$JAM_HOST" "mkdir -p $DIR"
scp server/server.js server/privacy.html server/package.json server/package-lock.json deploy/Dockerfile "$JAM_HOST:$DIR/"
# в Caddyfile домен и порт подставляются при деплое
sed -e "/^#/!s|{\$JAM_DOMAIN}|$JAM_DOMAIN|" -e "/^#/!s|{\$JAM_HTTPS_PORT}|$JAM_HTTPS_PORT|" deploy/Caddyfile | ssh "$JAM_HOST" "cat > $DIR/Caddyfile"

ssh "$JAM_HOST" "set -e
cd $DIR
docker network inspect yandex-jam >/dev/null 2>&1 || docker network create yandex-jam
docker build -q -t yandex-jam-server .
docker rm -f yandex-jam >/dev/null 2>&1 || true
docker run -d --name yandex-jam --network yandex-jam --restart unless-stopped yandex-jam-server
if docker inspect yandex-jam-caddy >/dev/null 2>&1; then
  docker exec yandex-jam-caddy caddy reload --config /etc/caddy/Caddyfile
else
  docker run -d --name yandex-jam-caddy --network yandex-jam --restart unless-stopped \
    -p $JAM_HTTP_PUBLISH:80 -p $JAM_HTTPS_PORT:$JAM_HTTPS_PORT \
    -v $DIR/Caddyfile:/etc/caddy/Caddyfile:ro \
    -v yandex-jam-caddy-data:/data -v yandex-jam-caddy-config:/config \
    caddy:2-alpine
fi
docker ps --filter name=yandex-jam --format '{{.Names}}: {{.Status}}'
"
echo "Готово: wss://$JAM_DOMAIN:$JAM_HTTPS_PORT"
