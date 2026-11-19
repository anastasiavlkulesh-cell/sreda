"use client";
import { useActionState } from "react";
import { registerAction } from "@/app/actions/auth";
import { initialActionState } from "@/lib/action-state";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { FieldError } from "@/components/ui/misc";

export function RegisterForm({ inviteToken, email }: { inviteToken?: string; email?: string }) {
  const [state, action] = useActionState(registerAction, initialActionState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {inviteToken && <input type="hidden" name="inviteToken" value={inviteToken} />}
      <div className="space-y-1.5">
        <Label htmlFor="name">Имя и фамилия</Label>
        <Input id="name" name="name" autoComplete="name" required aria-invalid={!!fe.name} />
        <FieldError errors={fe.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="email" defaultValue={email} readOnly={!!email} required aria-invalid={!!fe.email} />
        <FieldError errors={fe.email} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Пароль</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!fe.password} />
        <p className="text-xs text-muted">Не короче 10 символов, буквы и цифры.</p>
        <FieldError errors={fe.password} />
      </div>
      <label className="flex items-start gap-2.5 text-sm text-muted">
        <input type="checkbox" name="consent" className="mt-0.5 size-4 accent-lavender-500" required />
        <span>Я даю согласие на обработку персональных данных в соответствии с 152-ФЗ и принимаю политику конфиденциальности.</span>
      </label>
      <FieldError errors={fe.consent} />
      <FormMessage state={state} />
      <SubmitButton className="w-full" size="lg" pendingText="Создаём учётную запись…">Зарегистрироваться</SubmitButton>
    </form>
  );
}
