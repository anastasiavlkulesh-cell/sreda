import "server-only";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { TenantDb } from "./db/tenant";
import { AppError } from "./errors";

/**
 * Файловое хранилище: S3-совместимое (Yandex Object Storage, Selectel, MinIO)
 * или локальный диск для разработки. Файлы недоступны напрямую — только через
 * /api/files/[id] с проверкой прав. Ключи содержат id компании.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword", "application/vnd.ms-excel",
]);

interface Driver {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalDriver implements Driver {
  constructor(private root: string) {}
  private p(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root))) throw new Error("Недопустимый ключ файла");
    return full;
  }
  async put(key: string, body: Buffer) {
    await mkdir(path.dirname(this.p(key)), { recursive: true });
    await writeFile(this.p(key), body);
  }
  get(key: string) {
    return readFile(this.p(key));
  }
  async remove(key: string) {
    await unlink(this.p(key)).catch(() => undefined);
  }
}

class S3Driver implements Driver {
  private client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || "ru-central1",
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
  });
  private bucket = process.env.S3_BUCKET ?? "sreda";
  async put(key: string, body: Buffer, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mime,
        // Шифрование на стороне хранилища — если провайдер его поддерживает (S3_SSE=AES256)
        ...(process.env.S3_SSE ? { ServerSideEncryption: process.env.S3_SSE as "AES256" } : {}),
      }),
    );
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let driver: Driver | null = null;
export function storage(): Driver {
  driver ??= process.env.STORAGE_DRIVER === "s3" ? new S3Driver() : new LocalDriver(process.env.STORAGE_LOCAL_DIR ?? "./storage");
  return driver;
}

export function validateUpload(file: { size: number; type: string; name: string }) {
  if (file.size === 0) throw new AppError("Файл пуст");
  if (file.size > MAX_FILE_BYTES) throw new AppError("Файл больше 10 МБ");
  if (!ALLOWED_MIME.has(file.type)) throw new AppError("Недопустимый тип файла. Разрешены изображения, PDF, документы Word/Excel, TXT, CSV.");
}

export async function saveFile(db: TenantDb, orgId: string, userId: string, file: File) {
  validateUpload(file);
  const safeName = file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "file";
  const key = `${orgId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
  await storage().put(key, Buffer.from(await file.arrayBuffer()), file.type);
  return db.storedFile.create({
    data: { organizationId: orgId, storageKey: key, fileName: safeName, mimeType: file.type, sizeBytes: file.size, uploadedById: userId },
  });
}

export async function saveBuffer(db: TenantDb, orgId: string, userId: string, name: string, mime: string, body: Buffer) {
  const key = `${orgId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
  await storage().put(key, body, mime);
  return db.storedFile.create({
    data: { organizationId: orgId, storageKey: key, fileName: name, mimeType: mime, sizeBytes: body.length, uploadedById: userId },
  });
}
