#!/bin/sh
# Деплой сервиса ссылок: отдельный контейнер рядом с сервером комнат, наружу отвечает через Caddy на /links/ или на поддомене share.
# Сервер комнат не перезапускает: Caddy только перечитывает настройки.
# Ключи API лежат на сервере в /opt/song-links/.env, в репозиторий не попадают. Запуск из корня: sh deploy/deploy-links.sh
set -e
cd "$(dirname "$0")/.."

[ -f deploy/.env ] && . deploy/.env
: "${JAM_HOST:?не задан JAM_HOST — см. deploy/.env.example}"
: "${JAM_DOMAIN:?не задан JAM_DOMAIN — см. deploy/.env.example}"
. deploy/common.sh

DIR=/opt/song-links
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

(cd services/links && tar -cf - --exclude test --exclude '*.db*' --exclude .env .) | tar -xf - -C "$TMP"
mkdir -p "$TMP/fonts"
cp shared/fonts/golos-*.woff2 "$TMP/fonts/"
cp deploy/Dockerfile.links "$TMP/Dockerfile"

ssh "$JAM_HOST" "mkdir -p $DIR/app && touch $DIR/.env && chmod 600 $DIR/.env && find $DIR/app -mindepth 1 -delete"
COPYFILE_DISABLE=1 tar -cf - -C "$TMP" . | ssh "$JAM_HOST" "tar -xf - -C $DIR/app"

ssh "$JAM_HOST" "set -e
cd $DIR/app
docker build -q -t song-links .
docker rm -f song-links >/dev/null 2>&1 || true
docker run -d --name song-links --network yandex-jam --restart unless-stopped \
  --env-file $DIR/.env -v song-links-data:/data song-links >/dev/null
"

render_caddyfile | ssh "$JAM_HOST" "cat > /opt/yandex-jam/Caddyfile"
ssh "$JAM_HOST" "docker exec yandex-jam-caddy caddy reload --config /etc/caddy/Caddyfile && docker ps --filter name=song-links --format '{{.Names}}: {{.Status}}'"

echo "Готово: $JAM_LINKS_URL"
