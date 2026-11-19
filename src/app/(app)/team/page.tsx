import { Users, AlertTriangle, Lock } from "lucide-react";
import { requireOrgContext } from "@/server/context";
import { listEmployees, listPulseSurveys, pulseResults, teamOverview } from "@/server/services/team";
import { PageHeader, Alert, EmptyState, Stat } from "@/components/ui/misc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { LinkTabs } from "@/components/ui/tabs";
import { LevelBadge } from "@/components/sreda/score";
import { CopyLink } from "@/components/ui/copy-link";
import { saveEmployeeAction, archiveEmployeeAction, createPulseAction, closePulseAction } from "@/app/actions/team";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Команда" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tab?: string; pulse?: string }> }) {
  const ctx = await requireOrgContext("team.view");
  const sp = await searchParams;
  const tabs = [
    { key: "overview", label: "Обзор" },
    { key: "people", label: "Сотрудники" },
    { key: "pulse", label: "Анонимные опросы" },
    { key: "development", label: "Обучение и развитие" },
  ];
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "overview";
  return (
    <div>
      <PageHeader title="Команда" badge={ctx.org.isDemo ? <DemoBadge /> : undefined} description="Состав команды, вовлечённость, удовлетворённость, оценка руководителей, риски перегрузки и ухода." />
      <LinkTabs tabs={tabs} active={tab} base="/team" />
      {tab === "overview" && <Overview ctx={ctx} />}
      {tab === "people" && <People ctx={ctx} />}
      {tab === "pulse" && <Pulse ctx={ctx} selected={sp.pulse} />}
      {tab === "development" && (
        <Alert tone="info" title="Модуль обучения и индивидуального развития — следующий этап">
          Библиотека уроков, персональные программы по результатам диагностики, тесты, AI-тренажёр и сертификаты запланированы после MVP. Модели данных
          для курсов и прогресса уже заложены в базе.
        </Alert>
      )}
    </div>
  );
}

type Ctx = Awaited<ReturnType<typeof requireOrgContext>>;

async function Overview({ ctx }: { ctx: Ctx }) {
  const o = await teamOverview(ctx);
  const pulses = await listPulseSurveys(ctx);
  const latest = pulses.find((p) => p.responses > 0);
  const res = latest && ctx.can("team.insights") ? await pulseResults(ctx, latest.id) : null;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-5"><Stat label="Сотрудников" value={o.employees} /></CardContent></Card>
        <Card><CardContent className="pt-5"><Stat label="Подразделений" value={o.departments} /></CardContent></Card>
        <Card><CardContent className="space-y-1 pt-5"><Stat label="TEAM (5D)" value={o.team?.score != null ? Math.round(o.team.score) : "н/д"} /><LevelBadge score={o.team?.score ?? null} /></CardContent></Card>
        <Card><CardContent className="space-y-1 pt-5"><Stat label="LEADERSHIP (5D)" value={o.leadership?.score != null ? Math.round(o.leadership.score) : "н/д"} /><LevelBadge score={o.leadership?.score ?? null} /></CardContent></Card>
      </div>
      {res && (
        <div className="grid gap-6 lg:grid-cols-2">
          <PulseMetrics res={res} />
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-peach-600" />Риски</CardTitle><CardDescription>По опросу «{res.survey.title}»</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              {res.risks.map((r) => (
                <Alert key={r.key} tone={r.level === "high" ? "critical" : r.level === "medium" ? "warning" : "success"}>{r.text}</Alert>
              ))}
              {!res.enough && <p className="text-sm text-muted">Ответов меньше {res.k} — результаты скрыты для защиты анонимности.</p>}
            </CardContent>
          </Card>
        </div>
      )}
      {!ctx.can("team.insights") && <Alert tone="info">Результаты анонимных опросов доступны руководителям с правом просмотра аналитики команды.</Alert>}
    </div>
  );
}

function PulseMetrics({ res }: { res: Awaited<ReturnType<typeof pulseResults>> }) {
  const groups = [...new Set(res.metrics.flatMap((m) => m.groups.map((g) => g.group)))];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Результаты: «{res.survey.title}»</CardTitle>
        <CardDescription>Ответов: {res.n}. Группы меньше {res.k} человек скрыты.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <THead><TR><TH>Показатель</TH><TH className="text-center">Всего</TH>{groups.map((g) => <TH key={g} className="text-center">{g}</TH>)}</TR></THead>
          <TBody>
            {res.metrics.map((m) => (
              <TR key={m.metricKey}>
                <TD>{m.label}</TD>
                <TD className="text-center font-semibold">{m.overall?.toFixed(1) ?? <Lock className="mx-auto size-3.5 text-muted" />}</TD>
                {groups.map((g) => {
                  const x = m.groups.find((y) => y.group === g);
                  return <TD key={g} className="text-center text-muted">{x && !x.hidden ? x.mean!.toFixed(1) : <span title="Скрыто: мало ответов"><Lock className="mx-auto size-3.5" /></span>}</TD>;
                })}
              </TR>
            ))}
          </TBody>
        </Table>
        {res.comments && res.comments.length > 0 && (
          <div className="mt-4 space-y-1.5">
            <p className="text-sm font-semibold">Комментарии (обезличены, порядок перемешан)</p>
            {res.comments.map((c) => <blockquote key={c} className="border-l-2 border-lilac-400 pl-3 text-sm text-muted">«{c}»</blockquote>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

async function People({ ctx }: { ctx: Ctx }) {
  const [employees, locations, departments] = await Promise.all([
    listEmployees(ctx),
    ctx.db.location.findMany({ where: { archivedAt: null, ...(ctx.locationScope ? { id: { in: ctx.locationScope } } : {}) } }),
    ctx.db.department.findMany({ where: { archivedAt: null } }),
  ]);
  const manage = ctx.can("team.manage");
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Сотрудники ({employees.length})</CardTitle></CardHeader>
        <CardContent>
          {employees.length === 0 ? (
            <EmptyState icon={<Users className="size-6" />} title="Сотрудников пока нет" description="Добавьте сотрудников — это нужно для структуры команды и анонимных опросов по подразделениям." />
          ) : (
            <Table>
              <THead><TR><TH>ФИО</TH><TH>Должность</TH><TH>Точка / подразделение</TH><TH>В компании с</TH>{manage && <TH />}</TR></THead>
              <TBody>
                {employees.map((e) => (
                  <TR key={e.id}>
                    <TD className="font-semibold">{e.fullName}{e.contact && <p className="text-xs font-normal text-muted">{e.contact}</p>}</TD>
                    <TD>{e.position}</TD>
                    <TD className="text-xs text-muted">{e.location?.name ?? "—"} · {e.department?.name ?? "—"}</TD>
                    <TD className="text-xs">{formatDate(e.hiredAt)}</TD>
                    {manage && (
                      <TD>
                        <ActionForm action={archiveEmployeeAction} quiet confirm={`Перевести ${e.fullName} в архив? Контактные данные будут удалены.`}>
                          <input type="hidden" name="id" value={e.id} />
                          <Button type="submit" variant="ghost" size="sm">В архив</Button>
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
        <Card>
          <CardHeader><CardTitle>Добавить сотрудника</CardTitle><CardDescription>Контакт хранится в зашифрованном виде</CardDescription></CardHeader>
          <CardContent>
            <ActionForm action={saveEmployeeAction} resetOnSuccess>
              <Input name="fullName" placeholder="ФИО" required aria-label="ФИО" />
              <Input name="position" placeholder="Должность" required aria-label="Должность" />
              <Select name="locationId" defaultValue={ctx.locationScope?.[0] ?? ""} aria-label="Точка">
                {!ctx.locationScope && <option value="">Без точки</option>}
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
              <Select name="departmentId" defaultValue="" aria-label="Подразделение">
                <option value="">Без подразделения</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
              <Input name="contact" placeholder="Телефон или e-mail (необязательно)" aria-label="Контакт" />
              <div className="space-y-1"><Label htmlFor="hired" className="text-xs">Дата приёма</Label><Input id="hired" name="hiredAt" type="date" /></div>
              <SubmitButton>Добавить</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function Pulse({ ctx, selected }: { ctx: Ctx; selected?: string }) {
  const surveys = await listPulseSurveys(ctx);
  const current = surveys.find((s) => s.id === selected) ?? surveys[0];
  const res = current && ctx.can("team.insights") ? await pulseResults(ctx, current.id) : null;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6">
        {ctx.can("team.manage") && (
          <Card>
            <CardHeader><CardTitle>Новый пульс-опрос</CardTitle><CardDescription>6 вопросов + открытый комментарий, около 2 минут</CardDescription></CardHeader>
            <CardContent>
              <ActionForm action={createPulseAction} resetOnSuccess>
                <Input name="title" defaultValue={`Пульс команды — ${new Date().toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}`} required aria-label="Название" />
                <SubmitButton>Создать опрос</SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>Опросы</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {surveys.length === 0 && <p className="text-sm text-muted">Опросов пока нет.</p>}
            {surveys.map((s) => (
              <div key={s.id} className="space-y-2 rounded-xl border border-line p-3">
                <a href={`/team?tab=pulse&pulse=${s.id}`} className="font-semibold hover:text-lavender-600">{s.title}</a>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={s.status === "OPEN" ? "lavender" : "neutral"}>{s.status === "OPEN" ? "Идёт сбор" : "Закрыт"}</Badge>
                  <Badge variant="outline">Ответов: {s.responses}</Badge>
                </div>
                {s.link && <CopyLink url={s.link} />}
                {s.status === "OPEN" && ctx.can("team.manage") && (
                  <ActionForm action={closePulseAction} quiet>
                    <input type="hidden" name="id" value={s.id} />
                    <Button type="submit" variant="link" size="sm" className="h-auto">Закрыть опрос</Button>
                  </ActionForm>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="lg:col-span-2">
        {res ? <PulseMetrics res={res} /> : <Alert tone="info">Выберите опрос. Результаты видны только руководителям с правом аналитики команды и только в обобщённом виде.</Alert>}
      </div>
    </div>
  );
}
