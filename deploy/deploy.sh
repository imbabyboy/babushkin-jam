#!/bin/sh
# Деплой сервера джема на VPS: копирует файлы, пересобирает образ, перезапускает контейнеры.
# Запуск из корня репозитория: sh deploy/deploy.sh
# Адрес для попапа: wss://141-11-197-57.sslip.io:8443
set -e

HOST="${HOST:-root@141.11.197.57}"
DIR=/opt/yandex-jam

ssh "$HOST" "mkdir -p $DIR"
scp server/server.js server/privacy.html server/package.json server/package-lock.json deploy/Dockerfile deploy/Caddyfile "$HOST:$DIR/"

ssh "$HOST" "set -e
cd $DIR
docker network inspect yandex-jam >/dev/null 2>&1 || docker network create yandex-jam
docker build -q -t yandex-jam-server .
docker rm -f yandex-jam >/dev/null 2>&1 || true
docker run -d --name yandex-jam --network yandex-jam --restart unless-stopped yandex-jam-server
if docker inspect yandex-jam-caddy >/dev/null 2>&1; then
  docker exec yandex-jam-caddy caddy reload --config /etc/caddy/Caddyfile
else
  docker run -d --name yandex-jam-caddy --network yandex-jam --restart unless-stopped \
    -p 80:80 -p 8443:8443 \
    -v $DIR/Caddyfile:/etc/caddy/Caddyfile:ro \
    -v yandex-jam-caddy-data:/data -v yandex-jam-caddy-config:/config \
    caddy:2-alpine
fi
docker ps --filter name=yandex-jam --format '{{.Names}}: {{.Status}}'
"
