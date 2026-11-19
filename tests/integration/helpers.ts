import { prisma } from "@/server/db/client";
import { registerUser, createOrganization } from "@/server/services/organizations";
import { loadOrgContext } from "@/server/context-core";

let n = 0;
export async function newOwner(label = "owner") {
  n++;
  const user = await registerUser({ name: `Тест ${label} ${n}`, email: `${label}${n}.${Date.now()}@test.local`, password: "Password12345" });
  const org = await createOrganization(user.id, { name: `Компания ${label} ${n}`, industry: "general", locationName: "Точка 1" });
  const ctx = (await loadOrgContext({ id: user.id, email: user.email, name: user.name, isPlatformStaff: false }, org.id))!;
  return { user, org, ctx };
}

export async function ctxFor(userId: string, orgId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return (await loadOrgContext({ id: u.id, email: u.email, name: u.name, isPlatformStaff: false }, orgId))!;
}

export async function newUser(label = "user") {
  n++;
  return registerUser({ name: `Пользователь ${n}`, email: `${label}${n}.${Date.now()}@test.local`, password: "Password12345" });
}
