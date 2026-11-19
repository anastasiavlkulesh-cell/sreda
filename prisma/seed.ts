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
import { PERMISSIONS, type RoleKey } from "../src/domain/rbac";
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
  const org = hasDemo ? await prisma.organization.findUniqueOrThrow({ where: { id: hasDemo.organizationId } }) : await createDemoOrganization(user.id);

  // Тестовые учётные записи для проверки прав на пилоте (по одной на роль)
  const loc = await prisma.location.findFirstOrThrow({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } });
  const roles: [RoleKey, string][] = [
    ["NETWORK_MANAGER", "Руководитель сети (демо)"],
    ["LOCATION_MANAGER", "Управляющий точки (демо)"],
    ["MANAGER", "Менеджер смены (демо)"],
    ["EMPLOYEE", "Сотрудник (демо)"],
    ["PLATFORM_EXPERT", "Эксперт платформы (демо)"],
  ];
  const accounts: string[] = [];
  for (const [key, name] of roles) {
    const roleEmail = `${key.toLowerCase().replace("_", "-")}@sreda.local`;
    let u = await prisma.user.findUnique({ where: { email: roleEmail } });
    if (!u) u = await registerUser({ name, email: roleEmail, password });
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, key } });
    await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: u.id } },
      update: {},
      create: {
        organizationId: org.id,
        userId: u.id,
        roleId: role.id,
        locationIds: key === "LOCATION_MANAGER" ? [loc.id] : [],
        expiresAt: key === "PLATFORM_EXPERT" ? new Date(Date.now() + 30 * 86400_000) : null,
      },
    });
    accounts.push(`${roleEmail} (${name})`);
    if (key === "EMPLOYEE") {
      const task = await prisma.task.findFirst({ where: { organizationId: org.id, status: "PLANNED" }, orderBy: { createdAt: "desc" } });
      if (task && !task.coAssigneeIds.includes(u.id)) await prisma.task.update({ where: { id: task.id }, data: { coAssigneeIds: [...task.coAssigneeIds, u.id] } });
    }
  }
  console.log(`Seed выполнен. Демо-вход собственника: ${email} / ${password}`);
  console.log(`Учётные записи ролей (пароль тот же):\n  ${accounts.join("\n  ")}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
