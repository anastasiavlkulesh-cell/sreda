import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleDashed, Lock } from "lucide-react";
import { requireOrgContext } from "@/server/context";
import { getDiagnosticDetail } from "@/server/services/diagnostics";
import { parseDimensions } from "@/server/services/assessment";
import { AppError } from "@/server/errors";
import { DIMENSIONS, SOURCE_LABELS } from "@/domain/methodology/v1";
import type { SourceType } from "@/domain/types";
import { PageHeader, Alert, Progress } from "@/components/ui/misc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { ConfidenceBadge, LevelBadge, ScoreRing, levelColor } from "@/components/sreda/score";
import {
  launchDiagnosticAction, completeCollectionAction, recalculateAction, reopenAction, archiveDiagnosticAction,
} from "@/app/actions/diagnostics";
import { DIAGNOSTIC_STATUS_LABELS, DIAGNOSTIC_STATUS_VARIANT } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import { CopyLink, InvitesForm } from "./client";
import { DiagnosticAnalysisSection } from "./analysis-section";

export const metadata = { title: "Диагностика" };

export default async function DiagnosticPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const { submitted } = await searchParams;
  let detail;
  try {
    detail = await getDiagnosticDetail(ctx, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const { diagnostic: d, sources, completeness, assessment } = detail;
  const manage = ctx.can("diagnostics.manage");
  const dims = assessment ? parseDimensions(assessment.dimensions) : [];
  const ownerSurvey = sources.find((s) => s.type === "OWNER")?.survey;

  return (
    <div className="space-y-6">
      <PageHeader
        title={d.title}
        badge={
          <>
            <Badge variant={DIAGNOSTIC_STATUS_VARIANT[d.status]}>{DIAGNOSTIC_STATUS_LABELS[d.status]}</Badge>
            {ctx.org.isDemo && <DemoBadge />}
          </>
        }
        description={`Методика ${d.methodologyVersion} · создана ${formatDate(d.createdAt)}${d.completedAt ? ` · завершена ${formatDate(d.completedAt)}` : ""}`}
        actions={
          manage && (
            <>
              {d.status === "DRAFT" && (
                <ActionForm action={launchDiagnosticAction} quiet>
                  <input type="hidden" name="id" value={d.id} />
                  <SubmitButton pendingText="Запускаем…">Запустить сбор данных</SubmitButton>
                </ActionForm>
              )}
              {d.status === "COLLECTING" && (
                <>
                  <ActionForm action={recalculateAction} quiet>
                    <input type="hidden" name="id" value={d.id} />
                    <SubmitButton variant="secondary" pendingText="Считаем…">Предварительный расчёт</SubmitButton>
                  </ActionForm>
                  <ActionForm action={completeCollectionAction} quiet confirm="Завершить сбор? Анкеты закроются, будет выполнен итоговый расчёт.">
                    <input type="hidden" name="id" value={d.id} />
                    <SubmitButton pendingText="Рассчитываем…">Завершить сбор и рассчитать</SubmitButton>
                  </ActionForm>
                </>
              )}
              {d.status === "COMPLETED" && (
                <ActionForm action={reopenAction} quiet>
                  <input type="hidden" name="id" value={d.id} />
                  <SubmitButton variant="secondary">Возобновить сбор</SubmitButton>
                </ActionForm>
              )}
              <ActionForm action={archiveDiagnosticAction} quiet confirm="Перенести диагностику в архив?">
                <input type="hidden" name="id" value={d.id} />
                <Button type="submit" variant="ghost">В архив</Button>
              </ActionForm>
            </>
          )
        }
      />

      {submitted && <Alert tone="success" title="Ответы сохранены">Спасибо! Ваша анкета учтена в расчёте.</Alert>}
      {d.status === "COLLECTING" && ownerSurvey && !ownerSurvey.answeredByMe && ctx.membership.roleKey === "OWNER" && ownerSurvey.status === "OPEN" && (
        <Alert tone="info" title="Заполните анкету собственника">
          <Link href={`/diagnostics/${d.id}/respond/${ownerSurvey.id}`} className="font-semibold text-lavender-600 hover:underline">Открыть анкету →</Link>
        </Alert>
      )}

      <Card>
        <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Сбор данных</CardTitle>
            <CardDescription>Контроль полноты: сколько ответов собрано по каждому источнику</CardDescription>
          </div>
          <div className="w-full max-w-xs space-y-1">
            <div className="flex justify-between text-xs text-muted"><span>Источников с достаточными данными</span><span>{Math.round(completeness * 100)}%</span></div>
            <Progress value={completeness * 100} tone={completeness >= 1 ? "good" : "lavender"} />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>Источник</TH><TH>Ответы</TH><TH>Ссылка и доступ</TH></TR></THead>
            <TBody>
              {sources.map((s) => (
                <TR key={s.type}>
                  <TD className="w-56">
                    <div className="flex items-center gap-2">
                      {s.complete ? <CheckCircle2 className="size-4 text-level-good" /> : <CircleDashed className="size-4 text-muted" />}
                      <span className="font-semibold">{SOURCE_LABELS[s.type as SourceType]}</span>
                    </div>
                    {s.survey?.isAnonymous && <Badge variant="outline" className="mt-1"><Lock className="size-3" />Анонимно</Badge>}
                  </TD>
                  <TD className="w-48">
                    <p className="text-sm"><b>{s.responses}</b> из {s.target}</p>
                    <Progress value={Math.min(100, (s.responses / s.target) * 100)} className="mt-1" tone={s.complete ? "good" : "lavender"} />
                  </TD>
                  <TD>
                    {s.type === "BUSINESS_METRICS" && (
                      <p className="text-sm text-muted">
                        {detail.metricsCount > 0 ? `Фактических значений: ${detail.metricsCount}. ` : "Показатели не внесены. "}
                        <Link href="/metrics" className="font-semibold text-lavender-600 hover:underline">Бизнес-показатели →</Link>
                      </p>
                    )}
                    {s.type === "OWNER" && s.survey && (
                      s.survey.answeredByMe ? <p className="text-sm text-muted">Вы заполнили анкету</p>
                      : s.survey.status === "OPEN" && ctx.membership.roleKey === "OWNER" ? (
                        <Link href={`/diagnostics/${d.id}/respond/${s.survey.id}`} className={buttonVariants({ size: "sm" })}>Заполнить анкету</Link>
                      ) : <p className="text-sm text-muted">{d.status === "DRAFT" ? "Откроется после запуска" : "Заполняет собственник в системе"}</p>
                    )}
                    {s.link && (
                      <div className="space-y-2">
                        <CopyLink url={s.link} />
                        {manage && s.survey && (
                          <InvitesForm surveyId={s.survey.id} baseLink={s.link} used={s.survey.invitesUsed} total={s.survey.invites} />
                        )}
                      </div>
                    )}
                    {!s.link && s.type !== "OWNER" && s.type !== "BUSINESS_METRICS" && (
                      <p className="text-sm text-muted">{d.status === "DRAFT" ? "Ссылка появится после запуска" : "Сбор закрыт"}</p>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {assessment && (
        <>
          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Результат SERVICE 5D</CardTitle>
                <CardDescription>Расчёт от {formatDate(assessment.calculatedAt)}{d.status === "COLLECTING" ? " (предварительный)" : ""}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3 text-center">
                <ScoreRing score={assessment.ssi} label="SSI" />
                <div className="flex flex-wrap justify-center gap-2">
                  <LevelBadge score={assessment.ssi} />
                  <ConfidenceBadge value={assessment.confidence} />
                </div>
              </CardContent>
            </Card>
            <Card className="lg:col-span-8">
              <CardHeader><CardTitle>Ограничения и риски</CardTitle><CardDescription>Что влияет на достоверность и что требует немедленного внимания</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {assessment.criticalRisks.length > 0 && (
                  <Alert tone="critical" title="Критические риски">
                    <ul className="list-disc space-y-1 pl-4">{assessment.criticalRisks.map((r) => <li key={r}>{r}</li>)}</ul>
                  </Alert>
                )}
                {assessment.limitations.length > 0 ? (
                  <Alert tone="warning" title="Ограничения оценки">
                    <ul className="list-disc space-y-1 pl-4">{assessment.limitations.map((r) => <li key={r}>{r}</li>)}</ul>
                  </Alert>
                ) : (
                  <Alert tone="success">Данных достаточно по всем источникам.</Alert>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            {dims.map((dim) => {
              const def = DIMENSIONS.find((x) => x.key === dim.key)!;
              const srcCols = [...new Set(dim.criteria.flatMap((c) => Object.keys(c.bySource)))] as SourceType[];
              return (
                <Card key={dim.key}>
                  <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle>{def.name}</CardTitle>
                      <CardDescription>{def.description}</CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-2xl font-extrabold">{dim.score === null ? "н/д" : Math.round(dim.score)}</span>
                      <LevelBadge score={dim.score} />
                      <ConfidenceBadge value={dim.confidence} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {dim.limitations.length > 0 && <p className="mb-3 text-xs text-peach-600">{dim.limitations.join(" ")}</p>}
                    <Table>
                      <THead>
                        <TR>
                          <TH>Критерий</TH>
                          <TH className="text-center">Итог</TH>
                          {srcCols.map((s) => <TH key={s} className="text-center">{SOURCE_LABELS[s]}</TH>)}
                          <TH className="text-center">Разрыв</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {dim.criteria.map((c) => (
                          <TR key={c.code}>
                            <TD><span className="text-xs text-muted">{c.code}</span> {c.title} <span className="text-xs text-muted">(вес {c.weight})</span></TD>
                            <TD className="text-center font-semibold" style={{ color: c.score === null ? undefined : levelColor(((c.score - 1) / 4) * 100) }}>
                              {c.score === null ? "—" : c.score.toFixed(1)}
                            </TD>
                            {srcCols.map((s) => (
                              <TD key={s} className="text-center text-muted">
                                {c.bySource[s] ? <>{c.bySource[s]!.mean.toFixed(1)} <span className="text-[10px]">n={c.bySource[s]!.n}</span></> : "—"}
                              </TD>
                            ))}
                            <TD className="text-center">{c.spread !== null && c.spread >= 1.5 ? <Badge variant="warning">{c.spread.toFixed(1)}</Badge> : (c.spread?.toFixed(1) ?? "—")}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </CardContent>
                </Card>
              );
            })}
            <p className="text-xs text-muted">Разрыв ≥ 1,5 балла между источниками отмечен цветом — это расхождение восприятия, которое разбирается при анализе.</p>
          </div>
          <DiagnosticAnalysisSection ctx={ctx} diagnosticId={d.id} status={d.status} />
        </>
      )}
    </div>
  );
}
