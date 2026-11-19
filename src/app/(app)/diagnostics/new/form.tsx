"use client";
import { useActionState } from "react";
import { createDiagnosticAction } from "@/app/actions/diagnostics";
import { initialActionState } from "@/lib/action-state";
import { Input, Label, Select } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { FieldError } from "@/components/ui/misc";

export function NewDiagnosticForm({
  locations,
  sources,
  scoped,
}: {
  locations: { id: string; name: string }[];
  sources: { type: string; label: string; hint: string; target: number; available: boolean }[];
  scoped: boolean;
}) {
  const [state, action] = useActionState(createDiagnosticAction, initialActionState);
  const month = new Date().toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return (
    <form action={action} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="title">Название</Label>
        <Input id="title" name="title" defaultValue={`Диагностика SERVICE 5D — ${month}`} required />
        <FieldError errors={state.fieldErrors?.title} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="locationId">Область</Label>
        <Select id="locationId" name="locationId" defaultValue={scoped ? locations[0]?.id : ""}>
          {!scoped && <option value="">Вся компания</option>}
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Источники данных и минимум ответов</legend>
        {sources.map((s) => (
          <div key={s.type} className="flex items-center gap-3 rounded-xl border border-line p-3">
            <input
              type="checkbox"
              id={`src_${s.type}`}
              name="sources"
              value={s.type}
              defaultChecked={s.available}
              disabled={!s.available}
              className="size-4 accent-lavender-500"
            />
            <label htmlFor={`src_${s.type}`} className="flex-1 text-sm">
              <span className="font-semibold">{s.label}</span>
              <span className="block text-xs text-muted">{s.available ? s.hint : "Не подключено в тарифе"}</span>
            </label>
            {s.type !== "BUSINESS_METRICS" && (
              <Input type="number" name={`target_${s.type}`} defaultValue={s.target} min={1} max={10000} className="h-9 w-20" aria-label={`Минимум ответов: ${s.label}`} />
            )}
          </div>
        ))}
        <FieldError errors={state.fieldErrors?.sources} />
      </fieldset>
      <FormMessage state={state} />
      <SubmitButton pendingText="Создаём…">Создать диагностику</SubmitButton>
    </form>
  );
}
