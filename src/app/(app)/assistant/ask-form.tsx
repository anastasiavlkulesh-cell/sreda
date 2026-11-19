"use client";
import { useActionState, useRef } from "react";
import { askAction } from "@/app/actions/assistant";
import { initialActionState } from "@/lib/action-state";
import { Input } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";

export function AskForm({ suggestions }: { suggestions: string[] }) {
  const [state, action] = useActionState(askAction, initialActionState);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action} className="space-y-3">
      <div className="flex gap-2">
        <Input ref={input} name="question" placeholder="Например: почему снизилась возвращаемость?" maxLength={500} required aria-label="Вопрос" className="h-12 text-base" />
        <SubmitButton size="lg" pendingText="Думаю…">Спросить</SubmitButton>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              if (input.current) input.current.value = s;
              form.current?.requestSubmit();
            }}
            className="rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-muted hover:border-lavender-200 hover:text-ink"
          >
            {s}
          </button>
        ))}
      </div>
      {state.error && <FormMessage state={state} />}
    </form>
  );
}
