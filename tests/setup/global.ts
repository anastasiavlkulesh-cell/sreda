import "dotenv/config";
import { execSync } from "node:child_process";
import pg from "pg";

/**
 * Готовит чистую тестовую БД: пересоздаёт схему и применяет миграции.
 * По умолчанию — `prisma migrate deploy`; в средах без доступа к бинарникам
 * Prisma задайте PRISMA_OFFLINE=1 (используется официальный WASM-движок).
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://sreda:sreda@localhost:5432/sreda_test";
  const admin = new pg.Client({ connectionString: url.replace(/\/[^/?]+(\?.*)?$/, "/postgres") });
  await admin.connect();
  const dbName = new URL(url).pathname.slice(1);
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await c.end();

  const cmd = process.env.PRISMA_OFFLINE ? "node --no-warnings scripts/prisma-offline.mjs deploy" : "npx prisma migrate deploy";
  execSync(cmd, { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
