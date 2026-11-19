import Link from "next/link";
import { Radar, ClipboardCheck, Settings2 } from "lucide-react";
import { requireOrgContext } from "@/server/context";
import { listDiagnostics, pendingSurveysForUser } from "@/server/services/diagnostics";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ConfidenceBadge, LevelBadge } from "@/components/sreda/score";
import { formatDate } from "@/lib/utils";
import { DIAGNOSTIC_STATUS_LABELS, DIAGNOSTIC_STATUS_VARIANT } from "@/lib/labels";

export const metadata = { title: "Диагностика SERVICE 5D" };

const STATUS_LABELS = DIAGNOSTIC_STATUS_LABELS;
const STATUS_VARIANT = DIAGNOSTIC_STATUS_VARIANT;

export default async function DiagnosticsPage() {
  const ctx = await requireOrgContext();
  if (!ctx.can("diagnostics.view") && !ctx.can("diagnostics.respond")) {
    const { redirect } = await import("next/navigation");
    redirect("/forbidden");
  }
  const [pending, list] = await Promise.all([
    pendingSurveysForUser(ctx),
    ctx.can("diagnostics.view") ? listDiagnostics(ctx) : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Диагностика SERVICE 5D"
        badge={ctx.org.isDemo ? <DemoBadge /> : undefined}
        description="Оценка бизнеса по пяти направлениям: клиентский опыт, команда, управление, стандарты, бизнес-результаты. Шкала 1–5, итог — индекс SSI от 0 до 100."
        actions={
          ctx.can("diagnostics.manage") && (
            <>
              <Link href="/diagnostics/criteria" className={buttonVariants({ variant: "secondary" })}><Settings2 />Критерии</Link>
              <Link href="/diagnostics/new" className={buttonVariants()}>Новая диагностика</Link>
            </>
          )
        }
      />
      {pending.length > 0 && (
        <Card className="border-lavender-200 bg-lavender-50/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ClipboardCheck className="size-4 text-lavender-600" />Ожидают вашего ответа</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {pending.map((s) => (
              <Link key={s.id} href={`/diagnostics/${s.diagnosticId}/respond/${s.id}`} className={buttonVariants({ variant: "primary", size: "sm" })}>
                {s.title} — {s.diagnostic?.title}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
      {ctx.can("diagnostics.view") && list.length === 0 && (
        <EmptyState
          icon={<Radar className="size-6" />}
          title="Диагностик пока нет"
          description="Создайте первую диагностику: выберите источники данных, разошлите ссылки на анкеты и завершите сбор — система рассчитает SERVICE 5D."
          action={ctx.can("diagnostics.manage") ? <Link href="/diagnostics/new" className={buttonVariants()}>Создать диагностику</Link> : undefined}
        />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {list.map((d) => {
          const a = d.assessments[0];
          return (
            <Link key={d.id} href={`/diagnostics/${d.id}`} className="group">
              <Card className="h-full transition-shadow group-hover:shadow-lg">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="group-hover:text-lavender-600">{d.title}</CardTitle>
                    <Badge variant={STATUS_VARIANT[d.status]}>{STATUS_LABELS[d.status]}</Badge>
                  </div>
                  <CardDescription>
                    {d.location ? d.location.name : "Вся компания"} · создана {formatDate(d.createdAt)} · методика {d.methodologyVersion}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2">
                  {a ? (
                    <>
                      <span className="font-display text-2xl font-extrabold">{a.ssi === null ? "SSI н/д" : `SSI ${Math.round(a.ssi)}`}</span>
                      <LevelBadge score={a.ssi} />
                      <ConfidenceBadge value={a.confidence} />
                    </>
                  ) : (
                    <span className="text-sm text-muted">Расчёт ещё не выполнялся</span>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
