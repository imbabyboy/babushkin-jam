# Общее для deploy.sh и deploy-links.sh: итоговые адреса и Caddyfile для сервера. Подключается из корня репозитория.

JAM_HTTPS_PORT="${JAM_HTTPS_PORT:-8443}"
# Адреса для Caddy: обычно только домен. Адрес с http:// принимает запросы от nginx на 443, порт в ссылке не нужен.
JAM_SITES="${JAM_CADDY_SITES:-$JAM_DOMAIN}"

if [ -n "$JAM_SUBDOMAINS" ]; then
  JAM_ROOMS_URL="wss://sync.$JAM_DOMAIN"
  JAM_LINKS_URL="https://share.$JAM_DOMAIN/"
else
  case "$JAM_SITES" in
    *"http://$JAM_DOMAIN"*) JAM_PORT_SUFFIX= ;;
    *) JAM_PORT_SUFFIX=":$JAM_HTTPS_PORT" ;;
  esac
  JAM_ROOMS_URL="wss://$JAM_DOMAIN$JAM_PORT_SUFFIX"
  JAM_LINKS_URL="https://$JAM_DOMAIN$JAM_PORT_SUFFIX/links/"
fi

# Подставляет адреса в шаблон и печатает готовый Caddyfile.
render_caddyfile() {
  if [ -n "$JAM_SUBDOMAINS" ]; then
    cat deploy/Caddyfile deploy/Caddyfile.subdomains
  else
    cat deploy/Caddyfile
  fi | sed -e "/^#/!s|{\$JAM_DOMAIN}|$JAM_SITES|" \
    -e "/^#/!s|{\$JAM_BASE_DOMAIN}|$JAM_DOMAIN|g" \
    -e "/^#/!s|{\$JAM_HTTPS_PORT}|$JAM_HTTPS_PORT|"
}
