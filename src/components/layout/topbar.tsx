import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { DemoBadge, Badge } from "@/components/ui/badge";
import { OrgSwitcher } from "./org-switcher";

export function Topbar({
  orgName,
  isDemo,
  roleName,
  userName,
  orgs,
  currentOrgId,
  notifications,
}: {
  orgName: string;
  isDemo: boolean;
  roleName: string;
  userName: string;
  orgs: { id: string; name: string; isDemo: boolean }[];
  currentOrgId: string;
  notifications?: React.ReactNode;
}) {
  return (
    <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-canvas/85 pl-16 pr-4 backdrop-blur lg:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {orgs.length > 1 ? (
          <OrgSwitcher orgs={orgs} currentOrgId={currentOrgId} />
        ) : (
          <span className="truncate font-display font-bold">{orgName}</span>
        )}
        {isDemo && <DemoBadge />}
      </div>
      {notifications}
      <div className="hidden text-right sm:block">
        <p className="text-sm font-semibold leading-tight">{userName}</p>
        <Badge variant="lavender" className="mt-0.5">{roleName}</Badge>
      </div>
      <form action={logoutAction}>
        <button type="submit" className="flex size-9 items-center justify-center rounded-xl text-muted hover:bg-lavender-50 hover:text-ink" aria-label="Выйти" title="Выйти">
          <LogOut className="size-4" />
        </button>
      </form>
    </header>
  );
}
