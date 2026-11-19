import { requireOrgContext } from "@/server/context";
import { prisma } from "@/server/db/client";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { visibleNav, SETTINGS_ITEM } from "@/components/layout/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrgContext();
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: ctx.user.id, archivedAt: null, organization: { archivedAt: null } },
    select: { organization: { select: { id: true, name: true, isDemo: true } } },
    orderBy: { createdAt: "asc" },
  });
  const perms = ctx.permissions as Set<string>;
  const settings = SETTINGS_ITEM;

  return (
    <div className="min-h-dvh">
      <Sidebar groups={visibleNav(perms)} settings={settings} />
      <div className="lg:pl-64">
        <Topbar
          orgName={ctx.org.name}
          isDemo={ctx.org.isDemo}
          roleName={ctx.membership.roleName}
          userName={ctx.user.name}
          orgs={memberships.map((m) => m.organization)}
          currentOrgId={ctx.org.id}
        />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
