"use client";
import { useActionState, useState } from "react";
import { Copy, Check } from "lucide-react";
import { createInvitesAction } from "@/app/actions/diagnostics";
import { initialActionState } from "@/lib/action-state";
import { Input } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex max-w-xl items-center gap-2">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-line bg-lavender-50 px-3 py-1.5 font-mono text-xs" aria-label="Ссылка на анкету" />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white hover:bg-lavender-50"
        aria-label="Скопировать ссылку"
        title="Скопировать"
      >
        {copied ? <Check className="size-4 text-level-good" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

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
