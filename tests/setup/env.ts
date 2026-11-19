import "dotenv/config";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://sreda:sreda@localhost:5432/sreda_test";
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
(process.env as Record<string, string>).NODE_ENV = "test";
