import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { getOrgContext } from "@/server/context";
import { landingPath } from "@/components/layout/nav";

/** Стартовая страница: первый доступный пользователю раздел. */
export default async function Home() {
  if (!(await getSessionUser())) redirect("/login");
  const ctx = await getOrgContext();
  if (!ctx) redirect("/onboarding");
  redirect(landingPath(ctx.permissions as Set<string>));
}
