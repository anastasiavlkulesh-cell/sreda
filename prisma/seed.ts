/**
 * Seed для разработки и пилотов:
 *  — каталог прав (Permission) и справочники методики SERVICE 5D;
 *  — демо-пользователь и демо-компания (все данные помечены «Демо»).
 *
 * Учётная запись демо задаётся переменными SEED_DEMO_EMAIL / SEED_DEMO_PASSWORD
 * (по умолчанию demo@sreda.local / DemoSreda2026). Не используйте их в продакшене.
 */
import "dotenv/config";
import { prisma } from "../src/server/db/client";
import { PERMISSIONS } from "../src/domain/rbac";
import { ensureMethodology } from "../src/server/services/methodology";
import { registerUser } from "../src/server/services/organizations";
import { createDemoOrganization, DEMO_NAME } from "../src/server/services/demo";

async function main() {
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: { description: meta.description, module: meta.module },
      create: { key, description: meta.description, module: meta.module },
    });
  }
  await ensureMethodology();

  const email = process.env.SEED_DEMO_EMAIL ?? "demo@sreda.local";
  const password = process.env.SEED_DEMO_PASSWORD ?? "DemoSreda2026";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) user = await registerUser({ name: "Демо Собственник", email, password });
  const hasDemo = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organization: { isDemo: true, name: DEMO_NAME } },
  });
  if (!hasDemo) await createDemoOrganization(user.id);
  console.log(`Seed выполнен. Демо-вход: ${email} / ${password}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
