#!/usr/bin/env bash
# Обновление до последней версии: миграции применяются автоматически при старте приложения.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose -f deploy/docker-compose.prod.yml --env-file .env up -d --build
docker image prune -f >/dev/null
echo "Обновлено."
