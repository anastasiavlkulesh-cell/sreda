import { requireOrgContext } from "@/server/context";
import { loadCriteria } from "@/server/services/methodology";
import { prisma } from "@/server/db/client";
import { DIMENSIONS, METHODOLOGY_VERSION, SOURCE_LABELS } from "@/domain/methodology/v1";
import type { SourceType } from "@/domain/types";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { addCriterionAction, toggleCriterionAction } from "@/app/actions/diagnostics";

export const metadata = { title: "Критерии SERVICE 5D" };

export default async function CriteriaPage() {
  const ctx = await requireOrgContext("diagnostics.manage");
  const [criteria, inactive] = await Promise.all([
    loadCriteria(ctx.org.id),
    prisma.assessmentCriterion.findMany({ where: { organizationId: ctx.org.id, isActive: false } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Критерии SERVICE 5D"
        description={`Методика ${METHODOLOGY_VERSION}: универсальные критерии и индивидуальные критерии вашей компании. Веса универсальных критериев фиксированы версией методики.`}
      />
      <Alert tone="info">
        Отраслевые наборы критериев (HoReCa, ритейл, медицина и др.) — следующий этап развития методики. Сейчас можно добавить
        собственные критерии: их оценивают собственник и руководители, они входят в расчёт направления со своим весом.
      </Alert>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {DIMENSIONS.map((dim) => (
            <Card key={dim.key}>
              <CardHeader><CardTitle>{dim.name}</CardTitle><CardDescription>{dim.description}</CardDescription></CardHeader>
              <CardContent>
                <ul className="divide-y divide-line">
                  {criteria.filter((c) => c.dimension === dim.key).map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">
                          <span className="text-muted">{c.code}</span> {c.title}{" "}
                          {c.isCustom && <Badge variant="peach">Индивидуальный</Badge>}
                        </p>
                        <p className="text-xs text-muted">{c.description}</p>
                        <p className="text-xs text-muted">Источники: {(Object.keys(c.questions) as SourceType[]).map((s) => SOURCE_LABELS[s]).join(", ")}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge variant="outline">вес {c.weight}</Badge>
                        {c.isCustom && (
                          <ActionForm action={toggleCriterionAction} quiet>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="active" value="0" />
                            <Button type="submit" variant="link" size="sm" className="h-auto text-xs">Отключить</Button>
                          </ActionForm>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Добавить критерий</CardTitle><CardDescription>Войдёт в анкеты новых диагностик</CardDescription></CardHeader>
            <CardContent>
              <ActionForm action={addCriterionAction} resetOnSuccess>
                <div className="space-y-1.5">
                  <Label htmlFor="dimension">Направление</Label>
                  <Select id="dimension" name="dimension">
                    {DIMENSIONS.map((d) => <option key={d.key} value={d.key}>{d.shortName}</option>)}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ctitle">Название</Label>
                  <Input id="ctitle" name="title" placeholder="Например, Работа с предзаказами" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cdesc">Утверждение для оценки</Label>
                  <Textarea id="cdesc" name="description" placeholder="Предзаказы выдаются вовремя и без ошибок." required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cweight">Вес</Label>
                  <Select id="cweight" name="weight" defaultValue="1">
                    <option value="1">1 — обычный</option><option value="2">2 — важный</option><option value="3">3 — ключевой</option>
                  </Select>
                </div>
                <SubmitButton>Добавить</SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
          {inactive.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Отключённые критерии</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {inactive.map((c) => (
                  <ActionForm key={c.id} action={toggleCriterionAction} quiet className="flex items-center justify-between gap-2 space-y-0">
                    <span className="text-sm">{c.title}</span>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="active" value="1" />
                    <Button type="submit" variant="secondary" size="sm">Включить</Button>
                  </ActionForm>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
