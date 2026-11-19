import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL не задан");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * Базовый клиент. Используется только для глобальных таблиц (User, Organization,
 * методика) и в tenantDb(). Бизнес-данные компании читаются через tenantDb(orgId).
 */
export const prisma = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
