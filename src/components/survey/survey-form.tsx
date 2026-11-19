"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/action-state";
import { initialActionState } from "@/lib/action-state";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { Textarea, Input, Label, Select } from "@/components/ui/input";
import { Progress } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export interface SurveyQuestionView {
  id: string;
  type: "SCALE" | "TEXT";
  text: string;
  isRequired: boolean;
  group: string | null;
}

const LABELS: Record<number, string> = { 1: "Совсем не так", 2: "Скорее не так", 3: "Отчасти", 4: "Скорее так", 5: "Полностью так" };

export function SurveyForm({
  action,
  hidden,
  questions,
  departments,
  askLabel,
  labelPlaceholder,
  submitText = "Отправить ответы",
}: {
  action: (prev: ActionState | undefined, fd: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  questions: SurveyQuestionView[];
  departments?: { id: string; name: string }[];
  askLabel?: boolean;
  labelPlaceholder?: string;
  submitText?: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [answered, setAnswered] = useState<Record<string, number>>({});
  const required = questions.filter((q) => q.type === "SCALE" && q.isRequired);
  const done = required.filter((q) => answered[q.id]).length;
  let lastGroup: string | null = null;

  return (
    <form action={formAction} className="space-y-6">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <div className="sticky top-0 z-10 -mx-1 bg-canvas/90 px-1 py-2 backdrop-blur">
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>Заполнено</span>
          <span>{done} из {required.length}</span>
        </div>
        <Progress value={required.length ? (done / required.length) * 100 : 100} />
      </div>
      {askLabel && (
        <div className="space-y-1.5">
          <Label htmlFor="respondentLabel">Кто заполняет</Label>
          <Input id="respondentLabel" name="respondentLabel" placeholder={labelPlaceholder} maxLength={120} />
        </div>
      )}
      {departments && departments.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="departmentId">Ваше подразделение (необязательно)</Label>
          <Select id="departmentId" name="departmentId" defaultValue="">
            <option value="">Не указывать</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <p className="text-xs text-muted">Результаты подразделения показываются, только если ответили не меньше 5 человек.</p>
        </div>
      )}
      <ol className="space-y-4">
        {questions.map((q, i) => {
          const header = q.group && q.group !== lastGroup ? q.group : null;
          lastGroup = q.group ?? lastGroup;
          return (
            <li key={q.id} className="space-y-2">
              {header && <p className="pt-2 text-xs font-bold uppercase tracking-wider text-lavender-600">{header}</p>}
              <fieldset className="rounded-2xl border border-line bg-white p-4">
                <legend className="sr-only">{q.text}</legend>
                <p className="mb-3 text-sm font-semibold">
                  {i + 1}. {q.text}
                  {q.type === "TEXT" && <span className="font-normal text-muted"> (необязательно)</span>}
                </p>
                {q.type === "SCALE" ? (
                  <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                    {[1, 2, 3, 4, 5].map((v) => (
                      <label
                        key={v}
                        className={cn(
                          "flex cursor-pointer flex-col items-center gap-1 rounded-xl border px-1 py-2 text-center transition-colors",
                          answered[q.id] === v ? "border-lavender-500 bg-lavender-50" : "border-line hover:border-lavender-200",
                        )}
                      >
                        <input
                          type="radio"
                          name={`q_${q.id}`}
                          value={v}
                          className="sr-only"
                          required={q.isRequired}
                          onChange={() => setAnswered((a) => ({ ...a, [q.id]: v }))}
                        />
                        <span className="font-display text-lg font-extrabold">{v}</span>
                        <span className="text-[10px] leading-tight text-muted sm:text-[11px]">{LABELS[v]}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <Textarea name={`t_${q.id}`} maxLength={2000} placeholder="Ваш ответ" />
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>
      <FormMessage state={state} />
      <SubmitButton size="lg" className="w-full sm:w-auto" pendingText="Отправляем…">{submitText}</SubmitButton>
    </form>
  );
}
