"use client";
import { useActionState } from "react";
import { createOrgAction, createDemoAction } from "@/app/actions/org";
import { initialActionState } from "@/lib/action-state";
import { INDUSTRIES } from "@/lib/validation";
import { Input, Label, Select } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { FieldError } from "@/components/ui/misc";

export function CreateOrgForm() {
  const [state, action] = useActionState(createOrgAction, initialActionState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Название компании</Label>
        <Input id="name" name="name" placeholder="Например, ООО «Утро»" required />
        <FieldError errors={fe.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="industry">Отрасль</Label>
        <Select id="industry" name="industry" defaultValue="general">
          {Object.entries(INDUSTRIES).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="locationName">Первая точка</Label>
          <Input id="locationName" name="locationName" placeholder="Например, Центральная" required />
          <FieldError errors={fe.locationName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">Город</Label>
          <Input id="city" name="city" placeholder="Например, Казань" />
        </div>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Создаём…">Создать компанию</SubmitButton>
    </form>
  );
}

export function CreateDemoForm() {
  const [state, action] = useActionState(createDemoAction, initialActionState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton variant="accent" pendingText="Готовим демо-данные…">Открыть демо-компанию</SubmitButton>
    </form>
  );
}
