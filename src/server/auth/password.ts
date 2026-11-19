import "server-only";
import { hash, verify } from "@node-rs/argon2";

// Параметры Argon2id по рекомендациям OWASP (m=19 МиБ, t=2, p=1)
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** Хэш для выравнивания времени ответа, когда пользователь не найден. */
let dummy: Promise<string> | null = null;
export function dummyHash() {
  dummy ??= hash("timing-equalizer-password", OPTIONS);
  return dummy;
}
