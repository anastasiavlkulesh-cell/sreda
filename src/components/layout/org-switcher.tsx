"use client";
import { useActionState } from "react";
import { switchOrgAction } from "@/app/actions/auth";
import { initialActionState } from "@/lib/action-state";

export function OrgSwitcher({ orgs, currentOrgId }: { orgs: { id: string; name: string; isDemo: boolean }[]; currentOrgId: string }) {
  const [, action] = useActionState(switchOrgAction, initialActionState);
  return (
    <form action={action}>
      <label className="sr-only" htmlFor="org-switch">Компания</label>
      <select
        id="org-switch"
        name="orgId"
        defaultValue={currentOrgId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="max-w-[16rem] truncate rounded-xl border border-line bg-white px-3 py-1.5 font-display text-sm font-bold"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.isDemo ? " (Демо)" : ""}
          </option>
        ))}
      </select>
    </form>
  );
}
