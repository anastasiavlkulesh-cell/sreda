#!/bin/sh
# Старт контейнера: миграции БД → (по желанию) демо-данные → сервер.
set -e
echo "Применяю миграции базы данных…"
npx prisma migrate deploy
if [ "${SEED_DEMO:-0}" = "1" ]; then
  echo "SEED_DEMO=1: загружаю демо-компанию и учётные записи ролей (повторный запуск безопасен)…"
  NODE_OPTIONS=--conditions=react-server npx tsx prisma/seed.ts || echo "Seed завершился с ошибкой — приложение запускается без демо-данных"
fi
exec node server.js
