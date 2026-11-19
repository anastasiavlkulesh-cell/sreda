"use client";
import { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";
import { initialActionState } from "@/lib/action-state";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { FieldError } from "@/components/ui/misc";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, initialActionState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!state.fieldErrors?.email} />
        <FieldError errors={state.fieldErrors?.email} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Пароль</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
        <FieldError errors={state.fieldErrors?.password} />
      </div>
      <FormMessage state={state} />
      <SubmitButton className="w-full" size="lg" pendingText="Входим…">Войти</SubmitButton>
    </form>
  );
}
