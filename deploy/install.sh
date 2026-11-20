#!/usr/bin/env bash
# Установка СРЕДЫ на чистый сервер Ubuntu 22.04/24.04 (REG.RU «Облачный VPS», образ Docker или Ubuntu).
# Запуск под root:  bash deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Запустите под root (sudo bash deploy/install.sh)"; exit 1; }

say "Проверяю Docker"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  say "Устанавливаю Docker"
  curl -fsSL https://get.docker.com | sh
fi
command -v openssl >/dev/null || apt-get install -y openssl

if [ ! -f .env ]; then
  say "Настройка"
  read -rp "Домен для СРЕДЫ (например, sreda.ru; пусто — пока без домена, по IP и без HTTPS): " DOMAIN
  read -rp "SMTP для писем-приглашений (smtp://логин:пароль@smtp.yandex.ru:465; пусто — без почты): " SMTP
  read -rp "Адрес отправителя писем (например, СРЕДА <no-reply@${DOMAIN:-example.ru}>; пусто — по умолчанию): " FROM
  IP=$(curl -fsS https://ipv4.icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')
  if [ -n "$DOMAIN" ]; then SITE="$DOMAIN"; URL="https://$DOMAIN"; else SITE=":80"; URL="http://$IP"; fi
  cat > .env <<ENV
# Сгенерировано deploy/install.sh $(date +%F). Храните этот файл в секрете.
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
AUTH_SECRET="$(openssl rand -base64 32)"
AUTH_TRUST_HOST=true
DATA_ENCRYPTION_KEY="$(openssl rand -base64 32)"
APP_URL="$URL"
SITE_ADDRESS="$SITE"
STORAGE_DRIVER="local"
AI_PROVIDER="rules"
AI_BASE_URL=""
AI_API_KEY=""
AI_MODEL=""
SMTP_URL="$SMTP"
SMTP_FROM="${FROM:-СРЕДА <no-reply@${DOMAIN:-localhost}>}"
TELEGRAM_BOT_TOKEN=""
CRON_SECRET="$(openssl rand -hex 24)"
LOG_LEVEL=info
ENV
  chmod 600 .env
  echo "Файл .env создан. ВАЖНО: сохраните копию DATA_ENCRYPTION_KEY — без него зашифрованные данные не восстановить."
else
  say "Найден .env — использую существующие настройки"
fi
set -a; . ./.env; set +a

if command -v ufw >/dev/null 2>&1; then
  say "Настраиваю firewall: открыты только SSH, HTTP, HTTPS"
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

say "Собираю и запускаю (первая сборка — 5–10 минут)"
docker compose -f deploy/docker-compose.prod.yml --env-file .env up -d --build

say "Жду готовности приложения"
for i in $(seq 1 60); do
  if docker compose -f deploy/docker-compose.prod.yml --env-file .env exec -T app node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok=1; break; fi
  sleep 5
done
[ "${ok:-}" = 1 ] || { echo "Приложение не ответило. Логи: docker compose -f deploy/docker-compose.prod.yml logs app"; exit 1; }

say "Плановые задачи (просрочка задач — ежечасно, политика хранения — ежедневно)"
DIR="$(pwd)"
CALL="cd $DIR && docker compose -f deploy/docker-compose.prod.yml --env-file .env exec -T app node -e"
cat > /etc/cron.d/sreda <<CRON
SHELL=/bin/bash
7 * * * * root $CALL "fetch('http://localhost:3000/api/cron/overdue',{method:'POST',headers:{authorization:'Bearer '+process.env.CRON_SECRET}})" >/dev/null 2>&1
23 3 * * * root $CALL "fetch('http://localhost:3000/api/cron/retention',{method:'POST',headers:{authorization:'Bearer '+process.env.CRON_SECRET}})" >/dev/null 2>&1
CRON
chmod 644 /etc/cron.d/sreda

read -rp "Загрузить демо-компанию и тестовые учётные записи ролей? НЕ для работы с реальными клиентами [y/N]: " DEMO
if [[ "${DEMO:-N}" =~ ^[YyДд]$ ]]; then
  docker compose -f deploy/docker-compose.prod.yml --env-file .env exec -T app npm run db:seed
fi

say "Готово: $APP_URL"
echo "Обновление: git pull && bash deploy/update.sh"
