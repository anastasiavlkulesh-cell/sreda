import { FileText, Download } from "lucide-react";
import { requireOrgContext } from "@/server/context";
import { listReports } from "@/server/services/reports";
import { PageHeader, EmptyState, Alert } from "@/components/ui/misc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DemoBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { generateReportAction } from "@/app/actions/team";
import { formatDate } from "@/lib/utils";
import { diagnosticScopeWhere } from "@/server/services/dashboard";

export const metadata = { title: "Отчёты" };

export default async function ReportsPage() {
  const ctx = await requireOrgContext("reports.view");
  const [reports, diagnostics] = await Promise.all([
    listReports(ctx),
    ctx.db.diagnostic.findMany({ where: { archivedAt: null, assessments: { some: {} }, ...diagnosticScopeWhere(ctx) }, orderBy: { createdAt: "desc" }, select: { id: true, title: true } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Отчёты" badge={ctx.org.isDemo ? <DemoBadge /> : undefined} description="PDF-отчёт для собственника: SSI и динамика, пять направлений, риски, выводы анализа, план и его реальный результат, бизнес-показатели." />
      <Card>
        <CardHeader><CardTitle>Сформировать PDF-отчёт</CardTitle><CardDescription>Отчёт сохраняется в хранилище компании; доступ — по правам</CardDescription></CardHeader>
        <CardContent>
          {diagnostics.length === 0 ? (
            <Alert tone="info">Отчёт можно сформировать после первого расчёта диагностики.</Alert>
          ) : (
            <ActionForm action={generateReportAction} className="flex flex-wrap items-center gap-3 space-y-0">
              <Select name="diagnosticId" className="w-auto min-w-72" aria-label="Диагностика">
                {diagnostics.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </Select>
              <SubmitButton pendingText="Формируем PDF…">Сформировать</SubmitButton>
            </ActionForm>
          )}
        </CardContent>
      </Card>
      {reports.length === 0 ? (
        <EmptyState icon={<FileText className="size-6" />} title="Отчётов пока нет" />
      ) : (
        <Card>
          <CardContent className="divide-y divide-line pt-2">
            {reports.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold">{r.title}</p>
                  <p className="text-xs text-muted">{formatDate(r.createdAt)}{r.file ? ` · ${Math.round(r.file.sizeBytes / 1024)} КБ` : ""}</p>
                </div>
                {r.file && (
                  <a href={`/api/files/${r.file.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                    <Download />Открыть PDF
                  </a>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
