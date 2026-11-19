"use client";
export { CopyLink } from "@/components/ui/copy-link";
import { useActionState, useState } from "react";
import { createInvitesAction } from "@/app/actions/diagnostics";
import { initialActionState } from "@/lib/action-state";
import { Input } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";

export function InvitesForm({ surveyId, baseLink, used, total }: { surveyId: string; baseLink: string; used: number; total: number }) {
  const [state, action] = useActionState(createInvitesAction, initialActionState);
  const invites = (state.data as { invites?: string[] } | undefined)?.invites ?? [];
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-lavender-600">
        Индивидуальные ссылки{total > 0 ? ` (использовано ${used} из ${total})` : ""}
      </summary>
      <form action={action} className="mt-2 flex items-center gap-2">
        <input type="hidden" name="surveyId" value={surveyId} />
        <Input type="number" name="count" min={1} max={200} defaultValue={10} className="h-8 w-20" aria-label="Количество ссылок" />
        <SubmitButton size="sm" variant="secondary" pendingText="Создаём…">Создать</SubmitButton>
      </form>
      <p className="mt-1 text-xs text-muted">Каждая ссылка работает один раз. Ответ не связывается со ссылкой — анонимность сохраняется.</p>
      <div className="mt-2"><FormMessage state={state} /></div>
      {invites.length > 0 && (
        <textarea
          readOnly
          className="mt-2 h-32 w-full rounded-lg border border-line bg-lavender-50 p-2 font-mono text-xs"
          value={invites.map((t) => `${baseLink}?i=${t}`).join("\n")}
          aria-label="Индивидуальные ссылки"
        />
      )}
    </details>
  );
}
