/**
 * Проверка S3-драйвера на совместимом с S3 эмуляторе.
 * Запускается, только если задан S3_TEST_ENDPOINT (например, http://localhost:5055 с moto или MinIO).
 */
import { describe, it, expect } from "vitest";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";

const endpoint = process.env.S3_TEST_ENDPOINT;

describe.skipIf(!endpoint)("S3-хранилище", () => {
  it("сохраняет и читает файл; шифрование на стороне сервера отключаемо", async () => {
    Object.assign(process.env, {
      STORAGE_DRIVER: "s3", S3_ENDPOINT: endpoint, S3_REGION: "ru-1", S3_BUCKET: "sreda-test",
      S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test",
    });
    const c = new S3Client({ endpoint, region: "ru-1", forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test" } });
    await c.send(new CreateBucketCommand({ Bucket: "sreda-test" })).catch(() => undefined);
    const { storage } = await import("@/server/storage");
    const body = Buffer.from("%PDF-1.4 тест СРЕДА");
    await storage().put("org1/2026-11/file1", body, "application/pdf");
    expect((await storage().get("org1/2026-11/file1")).toString()).toBe(body.toString());
    process.env.S3_SSE = "AES256";
    await storage().put("org1/2026-11/file2", body, "application/pdf");
    expect((await storage().get("org1/2026-11/file2")).length).toBe(body.length);
    await storage().remove("org1/2026-11/file1");
    await expect(storage().get("org1/2026-11/file1")).rejects.toThrow();
  });
});
