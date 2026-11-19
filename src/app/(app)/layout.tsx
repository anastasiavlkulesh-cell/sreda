import { requireOrgContext } from "@/server/context";
import { prisma } from "@/server/db/client";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { visibleNav, SETTINGS_ITEM } from "@/components/layout/nav";
import { unreadCount } from "@/server/services/notifications";
import Link from "next/link";
import { Bell } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrgContext();
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: ctx.user.id, archivedAt: null, organization: { archivedAt: null } },
    select: { organization: { select: { id: true, name: true, isDemo: true } } },
    orderBy: { createdAt: "asc" },
  });
  const perms = ctx.permissions as Set<string>;
  const settings = SETTINGS_ITEM;
  const unread = await unreadCount(ctx.user.id, ctx.org.id);

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
          notifications={
            <Link href="/notifications" className="relative flex size-9 items-center justify-center rounded-xl text-muted hover:bg-lavender-50 hover:text-ink" aria-label={`Уведомления${unread ? `: непрочитанных ${unread}` : ""}`}>
              <Bell className="size-4" />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-peach-400 px-1 text-[10px] font-bold text-navy-900">{unread > 99 ? "99+" : unread}</span>}
            </Link>
          }
        />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
