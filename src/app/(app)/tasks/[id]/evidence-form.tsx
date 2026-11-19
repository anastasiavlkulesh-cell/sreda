"use client";
import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { evidenceAction } from "@/app/actions/plan";

export function EvidenceForm({ taskId }: { taskId: string }) {
  const [kind, setKind] = useState<"FILE" | "LINK" | "TEXT">("FILE");
  return (
    <ActionForm action={evidenceAction} resetOnSuccess className="rounded-xl border border-dashed border-line p-3">
      <input type="hidden" name="taskId" value={taskId} />
      <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Тип доказательства">
        <option value="FILE">Файл (фото, документ, до 10 МБ)</option>
        <option value="LINK">Ссылка</option>
        <option value="TEXT">Описание результата</option>
      </Select>
      {kind === "FILE" && <Input type="file" name="file" required className="py-2" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" aria-label="Файл" />}
      {kind === "LINK" && <Input type="url" name="url" placeholder="https://" required aria-label="Ссылка" />}
      <Textarea name="description" placeholder="Что подтверждает это доказательство? Например: «Фото обновлённого графика смен на утро, утверждён 12.11»" required aria-label="Описание" />
      <SubmitButton size="sm" variant="secondary" pendingText="Загружаем…">Добавить доказательство</SubmitButton>
    </ActionForm>
  );
}
