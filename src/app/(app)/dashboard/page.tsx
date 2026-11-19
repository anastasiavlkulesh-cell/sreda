import Link from "next/link";
import { AlertTriangle, Radar as RadarIcon, Sparkles, Users, HeartHandshake, TrendingUp, ClipboardList } from "lucide-react";
import { requireOrgContext } from "@/server/context";
import { getDashboard } from "@/server/services/dashboard";
import { DIMENSIONS } from "@/domain/methodology/v1";
import { scoreLevel } from "@/domain/ssi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DemoBadge } from "@/components/ui/badge";
import { Alert, EmptyState, PageHeader, Progress, Stat } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { ConfidenceBadge, Delta, LevelBadge, PriorityBadge, ScoreRing, FindingBadge, levelColor } from "@/components/sreda/score";
import { FiveDRadar, SsiHistory, RevenueChart } from "@/components/charts/charts";
import { isModuleReady } from "@/components/layout/nav";
import { formatDate, formatMonth, formatNumber, formatRub } from "@/lib/utils";

export const metadata = { title: "Главная панель" };

const RADAR_LABELS: Record<string, string> = {
  CUSTOMER: "Клиенты",
  TEAM: "Команда",
  LEADERSHIP: "Управление",
  STANDARDS: "Стандарты",
  BUSINESS_RESULTS: "Результаты",
};

function ModuleLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (!isModuleReady(href)) return null;
  return (
    <Link href={href} className={buttonVariants({ variant: "secondary", size: "sm" })}>
      {children}
    </Link>
  );
}

export default async function DashboardPage() {
  const ctx = await requireOrgContext("dashboard.view");
  const d = await getDashboard(ctx);
  const dimName = (k: string) => DIMENSIONS.find((x) => x.key === k)!.shortName;
  const team = d.dimensions.find((x) => x.key === "TEAM");
  const customer = d.dimensions.find((x) => x.key === "CUSTOMER");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Главная панель"
        badge={ctx.org.isDemo ? <DemoBadge /> : undefined}
        description={
          d.latest
            ? `По данным «${d.latest.diagnosticTitle}» от ${formatDate(d.latest.calculatedAt)}.`
            : "Состояние бизнеса появится после первой диагностики SERVICE 5D."
        }
        actions={<ModuleLink href="/diagnostics">Диагностики</ModuleLink>}
      />

      {!d.latest && (
        <EmptyState
          icon={<RadarIcon className="size-6" />}
          title="Диагностика ещё не проводилась"
          description="Запустите диагностику SERVICE 5D: соберите оценки собственника, руководителей, сотрудников и клиентов — система рассчитает индекс SSI и покажет проблемные зоны."
          action={
            isModuleReady("/diagnostics") && ctx.can("diagnostics.manage") ? (
              <Link href="/diagnostics/new" className={buttonVariants()}>Запустить диагностику</Link>
            ) : undefined
          }
        />
      )}

      {d.latest && (
        <>
          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Индекс SSI</CardTitle>
                <CardDescription>Service Strength Index — среднее пяти направлений SERVICE 5D</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3 text-center">
                <ScoreRing score={d.latest.ssi} size={148} label="из 100" />
                <div className="flex flex-wrap justify-center gap-2">
                  <LevelBadge score={d.latest.ssi} />
                  <ConfidenceBadge value={d.latest.confidence} />
                </div>
                <Delta now={d.latest.ssi} before={d.previousSsi} />
                {d.latest.ssi === null && (
                  <Alert tone="warning" title="SSI не рассчитан" className="text-left">
                    <ul className="list-disc space-y-1 pl-4">
                      {d.latest.limitations.slice(0, 3).map((l) => <li key={l}>{l}</li>)}
                    </ul>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>SERVICE 5D</CardTitle>
                <CardDescription>Пять направлений, вес каждого 20%</CardDescription>
              </CardHeader>
              <CardContent>
                <FiveDRadar data={d.dimensions.map((x) => ({ name: RADAR_LABELS[x.key], now: x.score, before: x.previous }))} />
              </CardContent>
            </Card>

            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-level-critical" />Критические проблемы</CardTitle>
                <CardDescription>Приоритеты P1 и P2</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {d.latest.criticalRisks.length > 0 && (
                  <ul className="space-y-1.5 text-sm">
                    {d.latest.criticalRisks.slice(0, 3).map((r) => (
                      <li key={r} className="rounded-xl bg-level-critical/6 px-3 py-2 text-navy-800">{r}</li>
                    ))}
                  </ul>
                )}
                {d.problems.map((p) => (
                  <div key={p.id} className="flex items-start gap-2 text-sm">
                    <PriorityBadge value={p.priority} />
                    <div className="min-w-0">
                      <p className="font-semibold leading-snug">{p.title}</p>
                      <FindingBadge value={p.findingStatus} />
                    </div>
                  </div>
                ))}
                {d.problems.length === 0 && d.latest.criticalRisks.length === 0 && (
                  <p className="text-sm text-muted">Критических проблем не выявлено{isModuleReady("/problems") ? "" : ". Анализ проблем и первопричин появится после AI-анализа"}.</p>
                )}
                <ModuleLink href="/problems">Все проблемы</ModuleLink>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {d.dimensions.map((x) => (
              <Card key={x.key} className="relative overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: x.score === null ? "var(--color-line)" : levelColor(x.score) }} />
                <CardContent className="space-y-2 pt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{dimName(x.key)}</p>
                  <p className="font-display text-3xl font-extrabold">{x.score === null ? "н/д" : Math.round(x.score)}</p>
                  <LevelBadge score={x.score} />
                  <div><Delta now={x.score} before={x.previous} /></div>
                  <p className="text-xs text-muted">Покрытие данных: {Math.round(x.coverage * 100)}%</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-8">
              <CardHeader>
                <CardTitle>Динамика показателей</CardTitle>
                <CardDescription>SSI и направления по завершённым диагностикам</CardDescription>
              </CardHeader>
              <CardContent>
                {d.history.length > 1 ? (
                  <SsiHistory
                    data={d.history.map((h) => ({ label: formatMonth(h.date), ssi: h.ssi, ...h.dims }))}
                    dimNames={Object.fromEntries(DIMENSIONS.map((x) => [x.key, x.shortName]))}
                  />
                ) : (
                  <p className="text-sm text-muted">Динамика появится после второй диагностики.</p>
                )}
              </CardContent>
            </Card>
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ClipboardList className="size-4 text-lavender-600" />План улучшений</CardTitle>
                <CardDescription>{d.plan ? d.plan.title : "План ещё не сформирован"}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Выполнено задач</span>
                    <span className="font-semibold">{d.tasks.done} из {d.tasks.total}</span>
                  </div>
                  <Progress value={d.tasks.total ? (d.tasks.done / d.tasks.total) * 100 : 0} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="В работе" value={(d.tasks.byStatus.IN_PROGRESS ?? 0) + (d.tasks.byStatus.IN_REVIEW ?? 0)} />
                  <Stat label="Просрочено" value={<span className={d.tasks.overdue ? "text-level-critical" : ""}>{d.tasks.overdue}</span>} />
                  <Stat label="Запланировано" value={(d.tasks.byStatus.PLANNED ?? 0) + (d.tasks.byStatus.NEW ?? 0)} />
                </div>
                <p className="text-xs text-muted">Закрытая задача не означает устранённую проблему: эффект подтверждается повторным замером.</p>
                <ModuleLink href="/plan">Открыть план</ModuleLink>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-lavender-600" />Рекомендации AI</CardTitle>
                <CardDescription>С указанием статуса вывода</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {d.recommendations.length === 0 && <p className="text-sm text-muted">Рекомендации появятся после AI-анализа диагностики.</p>}
                {d.recommendations.map((r) => (
                  <div key={r.id} className="space-y-1 rounded-xl border border-line p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {r.problem && <PriorityBadge value={r.problem.priority} />}
                      <FindingBadge value={r.findingStatus} />
                    </div>
                    <p className="text-sm font-semibold">{r.title}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Users className="size-4 text-peach-600" />Состояние команды</CardTitle>
                <CardDescription>Направление TEAM{team?.score !== null && team ? ` — ${Math.round(team.score!)} из 100` : ""}</CardDescription>
              </CardHeader>
              <CardContent>
                <CriteriaList criteria={team?.criteria ?? []} />
                <p className="mt-3 text-xs text-muted">Только агрегированные данные анонимных опросов.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><HeartHandshake className="size-4 text-lavender-600" />Клиентский опыт</CardTitle>
                <CardDescription>Направление CUSTOMER{customer?.score !== null && customer ? ` — ${Math.round(customer.score!)} из 100` : ""}</CardDescription>
              </CardHeader>
              <CardContent>
                <CriteriaList criteria={customer?.criteria ?? []} />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="size-4 text-lavender-600" />Бизнес-показатели</CardTitle>
            <CardDescription>Фактические данные, расчётные оценки и прогнозы показываются раздельно</CardDescription>
          </div>
          <ModuleLink href="/metrics">Все показатели</ModuleLink>
        </CardHeader>
        <CardContent>
          {d.metrics.revenue ? (
            <div className="grid gap-6 lg:grid-cols-12">
              <div className="grid grid-cols-2 gap-5 lg:col-span-4">
                <Stat label={`Выручка, ${formatMonth(d.metrics.revenue.periodStart)}`} value={formatRub(d.metrics.revenue.value)} hint="Факт" />
                <Stat
                  label="Изменение выручки"
                  value={d.metrics.revenueChange ? `${d.metrics.revenueChange.change >= 0 ? "+" : ""}${formatNumber(d.metrics.revenueChange.change * 100, 1)}%` : "—"}
                  hint={d.metrics.revenueChange ? (d.metrics.revenueChange.basis === "yoy" ? "3 мес. к прошлому году" : "3 мес. к предыдущим 3") : "Недостаточно данных"}
                />
                <Stat label="Средний чек" value={formatRub(d.metrics.averageCheck?.value)} hint="Факт" />
                <Stat label="Повторные продажи" value={d.metrics.repeatSales ? `${formatNumber(d.metrics.repeatSales.value)}%` : "—"} hint="Факт" />
                <Stat label="Клиентов" value={formatNumber(d.metrics.customers?.value)} hint="Факт" />
                <Stat label="Стоимость ошибок" value={formatRub(d.metrics.errorCost?.value)} hint="Факт" />
              </div>
              <div className="lg:col-span-8">
                <RevenueChart data={d.metrics.revenueSeries.map((r) => ({ label: formatMonth(r.month + "-01"), fact: r.fact, forecast: r.forecast }))} />
                <p className="mt-2 text-xs text-muted">
                  Изменение выручки не приписывается качеству сервиса автоматически: перед выводами проверяются сезонность, цены, трафик и внешние факторы.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Показатели ещё не внесены.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CriteriaList({ criteria }: { criteria: { code: string; title: string; score: number | null }[] }) {
  const withData = criteria.filter((c) => c.score !== null).sort((a, b) => a.score! - b.score!);
  if (!withData.length) return <p className="text-sm text-muted">Нет данных.</p>;
  return (
    <ul className="space-y-2.5">
      {withData.map((c) => {
        const pct = ((c.score! - 1) / 4) * 100;
        return (
          <li key={c.code} className="space-y-1">
            <div className="flex justify-between gap-2 text-sm">
              <span className="truncate">{c.title}</span>
              <span className="font-semibold" title={scoreLevel(pct).label}>{c.score!.toFixed(1)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-lavender-100">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: levelColor(pct) }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
