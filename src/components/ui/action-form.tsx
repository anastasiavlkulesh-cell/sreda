"use client";
import { useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/lib/action-state";
import { initialActionState } from "@/lib/action-state";
import { FormMessage } from "./form";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState | undefined, fd: FormData) => Promise<ActionState>;

/** Универсальная форма серверного действия с сообщением о результате. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  quiet = false,
  confirm,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** Не показывать сообщение об успехе (для строчных кнопок) */
  quiet?: boolean;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const link = (state.data as { link?: string } | undefined)?.link;
  return (
    <form
      ref={ref}
      action={formAction}
      className={cn("space-y-3", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {(!quiet || state.error) && <FormMessage state={state} />}
      {link && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted">Ссылка (показывается один раз — сохраните её):</p>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-lg border border-line bg-lavender-50 px-3 py-2 font-mono text-xs" />
        </div>
      )}
    </form>
  );
}
