import { requireOrgContext } from "@/server/context";
import { listMetrics } from "@/server/services/metrics";
import { METRIC_META, VALUE_KIND_LABELS, type MetricKey } from "@/domain/metrics";
import { PageHeader, Alert, EmptyState } from "@/components/ui/misc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { addMetricAction, importMetricsAction, deleteMetricAction } from "@/app/actions/diagnostics";
import { formatMonth, formatNumber, formatRub } from "@/lib/utils";
import { TrendingUp } from "lucide-react";

export const metadata = { title: "Бизнес-показатели" };

function fmt(key: MetricKey, v: number) {
  const u = METRIC_META[key].unit;
  return u === "rub" ? formatRub(v) : u === "pct" ? `${formatNumber(v, 1)}%` : formatNumber(v);
}

const KIND_VARIANT = { FACT: "good", ESTIMATE: "lavender", FORECAST: "peach" } as const;

export default async function MetricsPage() {
  const ctx = await requireOrgContext("metrics.view");
  const [rows, locations] = await Promise.all([
    listMetrics(ctx),
    ctx.db.location.findMany({ where: { archivedAt: null, ...(ctx.locationScope ? { id: { in: ctx.locationScope } } : {}) } }),
  ]);
  const manage = ctx.can("metrics.manage");
  const thisMonth = new Date().toISOString().slice(0, 7);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Бизнес-показатели"
        badge={ctx.org.isDemo ? <DemoBadge /> : undefined}
        description="Факт, расчётные оценки и прогнозы хранятся раздельно. В расчёт SERVICE 5D (направление «Бизнес-результаты») попадают только фактические данные."
      />
      <Alert tone="info">
        Интеграции с CRM и POS-системами — следующий этап. Сейчас данные вносятся вручную или загружаются CSV-файлом.
      </Alert>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Внесённые данные</CardTitle><CardDescription>Последние 500 значений</CardDescription></CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState icon={<TrendingUp className="size-6" />} title="Показателей пока нет" description="Внесите выручку, средний чек и долю повторных продаж хотя бы за 4 месяца — система оценит динамику." />
            ) : (
              <Table>
                <THead><TR><TH>Месяц</TH><TH>Показатель</TH><TH className="text-right">Значение</TH><TH>Тип</TH><TH>Точка</TH>{manage && <TH />}</TR></THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.id}>
                      <TD className="whitespace-nowrap">{formatMonth(r.periodStart)}</TD>
                      <TD>{METRIC_META[r.key as MetricKey].label}</TD>
                      <TD className="text-right font-semibold">{fmt(r.key as MetricKey, r.value)}</TD>
                      <TD><Badge variant={KIND_VARIANT[r.kind]}>{VALUE_KIND_LABELS[r.kind]}</Badge>{r.note === "Демо" && <DemoBadge className="ml-1" />}</TD>
                      <TD className="text-xs text-muted">{r.location?.name ?? "Вся компания"}</TD>
                      {manage && (
                        <TD>
                          <ActionForm action={deleteMetricAction} quiet confirm="Удалить значение?">
                            <input type="hidden" name="id" value={r.id} />
                            <Button type="submit" variant="ghost" size="sm" aria-label="Удалить">×</Button>
                          </ActionForm>
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        {manage && (
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Внести значение</CardTitle></CardHeader>
              <CardContent>
                <ActionForm action={addMetricAction}>
                  <div className="space-y-1.5">
                    <Label htmlFor="key">Показатель</Label>
                    <Select id="key" name="key">
                      {Object.entries(METRIC_META).map(([k, m]) => <option key={k} value={k}>{m.label} — {m.hint}</option>)}
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="month">Месяц</Label>
                      <Input id="month" name="month" type="month" defaultValue={thisMonth} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="value">Значение</Label>
                      <Input id="value" name="value" inputMode="decimal" required />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="kind">Тип данных</Label>
                    <Select id="kind" name="kind" defaultValue="FACT">
                      <option value="FACT">Факт</option><option value="ESTIMATE">Расчётная оценка</option><option value="FORECAST">Прогноз</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mloc">Точка</Label>
                    <Select id="mloc" name="locationId" defaultValue={ctx.locationScope?.[0] ?? ""}>
                      {!ctx.locationScope && <option value="">Вся компания</option>}
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>
                  </div>
                  <Input name="note" placeholder="Комментарий (необязательно)" aria-label="Комментарий" />
                  <SubmitButton>Сохранить</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Загрузить CSV</CardTitle>
                <CardDescription>Колонки: месяц (ГГГГ-ММ); показатель; значение; тип (факт/оценка/прогноз). Первая строка — заголовок.</CardDescription>
              </CardHeader>
              <CardContent>
                <ActionForm action={importMetricsAction} resetOnSuccess>
                  <Input type="file" name="file" accept=".csv,text/csv" required className="py-2" aria-label="CSV-файл" />
                  <Select name="locationId" defaultValue={ctx.locationScope?.[0] ?? ""} aria-label="Точка">
                    {!ctx.locationScope && <option value="">Вся компания</option>}
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                  <pre className="rounded-lg bg-lavender-50 p-2 text-[11px] text-muted">месяц;показатель;значение;тип{"\n"}2026-09;Выручка;2350000;факт{"\n"}2026-09;Средний чек;415;факт</pre>
                  <SubmitButton variant="secondary">Импортировать</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
