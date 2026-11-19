"use client";
import { useActionState } from "react";
import { acceptInviteAction } from "@/app/actions/auth";
import { initialActionState } from "@/lib/action-state";
import { SubmitButton, FormMessage } from "@/components/ui/form";

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState(acceptInviteAction, initialActionState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-muted">Вы вошли как {email}.</p>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Принимаем…">Принять приглашение</SubmitButton>
    </form>
  );
}
