import { requireOrgContext } from "@/server/context";
import { assignableMembers } from "@/server/services/plans";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { createTaskAction } from "@/app/actions/plan";

export const metadata = { title: "Новая задача" };

export default async function NewTaskPage() {
  const ctx = await requireOrgContext("tasks.manage");
  const members = await assignableMembers(ctx);
  const due = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Новая задача" description="Задача вне плана улучшений — для оперативных поручений." />
      <Card>
        <CardContent className="pt-5">
          <ActionForm action={createTaskAction}>
            <div className="space-y-1.5"><Label htmlFor="title">Название</Label><Input id="title" name="title" required /></div>
            <div className="space-y-1.5"><Label htmlFor="ps">Описание проблемы</Label><Textarea id="ps" name="problemSummary" required /></div>
            <div className="space-y-1.5"><Label htmlFor="sol">Что нужно сделать</Label><Textarea id="sol" name="solution" required /></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="as">Ответственный</Label>
                <Select id="as" name="assigneeUserId" required defaultValue="">
                  <option value="" disabled>Выберите…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="due">Срок</Label><Input id="due" name="dueDate" type="date" defaultValue={due} required /></div>
              <div className="space-y-1.5">
                <Label htmlFor="pr">Приоритет</Label>
                <Select id="pr" name="priority" defaultValue="P3">{["P1", "P2", "P3", "P4"].map((p) => <option key={p}>{p}</option>)}</Select>
              </div>
            </div>
            <SubmitButton>Создать задачу</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
