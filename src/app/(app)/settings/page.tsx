import { requireOrgContext } from "@/server/context";
import { prisma } from "@/server/db/client";
import { PERMISSIONS, ROLE_LABELS, OWNER_ONLY, canAssignRole, type Permission, type RoleKey } from "@/domain/rbac";
import { DEFAULT_PRIORITY_SETTINGS, type PrioritySettings } from "@/domain/priority";
import { INDUSTRIES } from "@/lib/validation";
import { formatDate, formatShortDate } from "@/lib/utils";
import { PageHeader, Alert } from "@/components/ui/misc";
import { LinkTabs } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import {
  updateOrgAction, createLocationAction, archiveLocationAction, createDepartmentAction, inviteMemberAction,
  revokeInvitationAction, changeRoleAction, deactivateMemberAction, updateRolePermissionsAction, updatePrivacyAction,
  updatePriorityAction,
} from "@/app/actions/org";
import { channelStatus } from "@/server/services/notifications";
import { NotificationPrefs } from "./notification-prefs";

export const metadata = { title: "Настройки" };

const ALL_ROLES = Object.keys(ROLE_LABELS) as RoleKey[];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireOrgContext();
  const tabs = [
    ctx.can("org.manage") && { key: "company", label: "Компания" },
    ctx.can("locations.manage") && { key: "locations", label: "Точки" },
    ctx.can("members.view") && { key: "members", label: "Пользователи" },
    ctx.can("roles.manage") && { key: "roles", label: "Роли и права" },
    ctx.can("org.manage") && { key: "data", label: "Данные и согласия" },
    ctx.can("org.manage") && { key: "priority", label: "Приоритизация" },
    { key: "profile", label: "Мои уведомления" },
    ctx.can("audit.view") && { key: "audit", label: "Журнал аудита" },
  ].filter(Boolean) as { key: string; label: string }[];
  const { tab } = await searchParams;
  const active = tabs.find((t) => t.key === tab)?.key ?? tabs[0].key;

  return (
    <div>
      <PageHeader title="Настройки" description="Компания, пользователи, права доступа и правила работы с данными." />
      <LinkTabs tabs={tabs} active={active} base="/settings" />
      {active === "company" && <CompanyTab ctx={ctx} />}
      {active === "locations" && <LocationsTab ctx={ctx} />}
      {active === "members" && <MembersTab ctx={ctx} />}
      {active === "roles" && <RolesTab ctx={ctx} />}
      {active === "data" && <DataTab ctx={ctx} />}
      {active === "priority" && <PriorityTab ctx={ctx} />}
      {active === "profile" && <ProfileTab userId={ctx.user.id} />}
      {active === "audit" && <AuditTab ctx={ctx} />}
    </div>
  );
}

type Ctx = Awaited<ReturnType<typeof requireOrgContext>>;

async function CompanyTab({ ctx }: { ctx: Ctx }) {
  const sub = await prisma.subscription.findUnique({ where: { organizationId: ctx.org.id } });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Данные компании</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={updateOrgAction}>
            <div className="space-y-1.5">
              <Label htmlFor="name">Название</Label>
              <Input id="name" name="name" defaultValue={ctx.org.name} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="industry">Отрасль</Label>
              <Select id="industry" name="industry" defaultValue={ctx.org.industry}>
                {Object.entries(INDUSTRIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <p className="text-xs text-muted">В версии методики 5D-1.0 используются универсальные критерии; отраслевые наборы — следующий этап.</p>
            </div>
            <SubmitButton>Сохранить</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Тариф</CardTitle>
          <CardDescription>Подключение оплаты — следующий этап; сейчас действует пилотный доступ.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Тариф: <Badge variant="lavender">{sub?.plan === "PILOT" ? "Пилот" : sub?.plan}</Badge></p>
          <p>Источники данных: {sub?.enabledSources.length ?? 0} из 6 подключены</p>
        </CardContent>
      </Card>
    </div>
  );
}

async function LocationsTab({ ctx }: { ctx: Ctx }) {
  const [locations, departments] = await Promise.all([
    ctx.db.location.findMany({ where: { archivedAt: null }, orderBy: { createdAt: "asc" } }),
    ctx.db.department.findMany({ where: { archivedAt: null }, include: { location: true }, orderBy: { createdAt: "asc" } }),
  ]);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Точки</CardTitle><CardDescription>Филиалы, салоны, магазины, заведения</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>Название</TH><TH>Город</TH><TH>Адрес</TH><TH /></TR></THead>
            <TBody>
              {locations.map((l) => (
                <TR key={l.id}>
                  <TD className="font-semibold">{l.name}</TD>
                  <TD>{l.city ?? "—"}</TD>
                  <TD>{l.address ?? "—"}</TD>
                  <TD className="text-right">
                    {locations.length > 1 && (
                      <ActionForm action={archiveLocationAction} quiet confirm={`Перенести «${l.name}» в архив?`}>
                        <input type="hidden" name="id" value={l.id} />
                        <Button variant="ghost" size="sm" type="submit">В архив</Button>
                      </ActionForm>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <h4 className="mb-2 mt-6 font-display font-bold">Подразделения</h4>
          {departments.length === 0 ? (
            <p className="text-sm text-muted">Подразделений нет. Они нужны для группировки результатов анонимных опросов.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {departments.map((d) => <Badge key={d.id} variant="outline">{d.name}{d.location ? ` · ${d.location.name}` : ""}</Badge>)}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Добавить точку</CardTitle></CardHeader>
          <CardContent>
            <ActionForm action={createLocationAction} resetOnSuccess>
              <Input name="name" placeholder="Название" required aria-label="Название точки" />
              <Input name="city" placeholder="Город" aria-label="Город" />
              <Input name="address" placeholder="Адрес" aria-label="Адрес" />
              <SubmitButton>Добавить</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Добавить подразделение</CardTitle></CardHeader>
          <CardContent>
            <ActionForm action={createDepartmentAction} resetOnSuccess>
              <Input name="name" placeholder="Например, Кухня" required aria-label="Название подразделения" />
              <Select name="locationId" aria-label="Точка" defaultValue="">
                <option value="">Все точки</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
              <SubmitButton>Добавить</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function MembersTab({ ctx }: { ctx: Ctx }) {
  const [members, invitations, locations] = await Promise.all([
    ctx.db.organizationMembership.findMany({
      where: { archivedAt: null },
      include: { user: { select: { name: true, email: true } }, role: true },
      orderBy: { createdAt: "asc" },
    }),
    ctx.db.invitation.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { role: true },
      orderBy: { createdAt: "desc" },
    }),
    ctx.db.location.findMany({ where: { archivedAt: null } }),
  ]);
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? "—";
  const assignable = ALL_ROLES.filter((r) => canAssignRole(ctx.membership.roleKey, r));
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Пользователи компании</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>Пользователь</TH><TH>Роль и область</TH>{ctx.can("members.manage") && <TH>Изменить</TH>}</TR></THead>
            <TBody>
              {members.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <p className="font-semibold">{m.user.name}</p>
                    <p className="text-xs text-muted">{m.user.email}</p>
                  </TD>
                  <TD className="space-y-1">
                    <Badge variant="lavender">{m.role.name}</Badge>
                    <p className="text-xs text-muted">{m.locationIds.length ? m.locationIds.map(locName).join(", ") : "Вся компания"}</p>
                    {m.expiresAt && <p className="text-xs text-peach-600">Доступ до {formatShortDate(m.expiresAt)}</p>}
                  </TD>
                  {ctx.can("members.manage") && (
                    <TD>
                      {m.userId !== ctx.user.id && canAssignRole(ctx.membership.roleKey, m.role.key) ? (
                        <div className="flex flex-col gap-2">
                          <ActionForm action={changeRoleAction} className="flex flex-wrap items-center gap-2 space-y-0">
                            <input type="hidden" name="membershipId" value={m.id} />
                            <Select name="roleKey" defaultValue={m.role.key} className="h-8 w-auto text-xs" aria-label="Роль">
                              {assignable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                            </Select>
                            <Select name="locationIds" defaultValue={m.locationIds[0] ?? ""} className="h-8 w-auto text-xs" aria-label="Область">
                              <option value="">Вся компания</option>
                              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </Select>
                            <SubmitButton size="sm" variant="secondary">OK</SubmitButton>
                          </ActionForm>
                          <ActionForm action={deactivateMemberAction} quiet confirm={`Отключить доступ ${m.user.name}?`}>
                            <input type="hidden" name="membershipId" value={m.id} />
                            <Button type="submit" variant="link" size="sm" className="h-auto text-xs text-level-critical">Отключить доступ</Button>
                          </ActionForm>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">{m.userId === ctx.user.id ? "Это вы" : "Недостаточно прав"}</span>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
          {invitations.length > 0 && (
            <>
              <h4 className="mb-2 mt-6 font-display font-bold">Ожидают принятия</h4>
              <ul className="divide-y divide-line text-sm">
                {invitations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                    <span>{i.email} · {i.role.name} · до {formatShortDate(i.expiresAt)}</span>
                    {ctx.can("members.invite") && (
                      <ActionForm action={revokeInvitationAction} quiet>
                        <input type="hidden" name="id" value={i.id} />
                        <Button type="submit" variant="ghost" size="sm">Отозвать</Button>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
      {ctx.can("members.invite") && (
        <Card>
          <CardHeader>
            <CardTitle>Пригласить пользователя</CardTitle>
            <CardDescription>Приглашение действует 14 дней. Эксперт платформы получает доступ на ограниченный срок.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={inviteMemberAction} resetOnSuccess>
              <div className="space-y-1.5">
                <Label htmlFor="inv-email">E-mail</Label>
                <Input id="inv-email" name="email" type="email" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-role">Роль</Label>
                <Select id="inv-role" name="roleKey" defaultValue="MANAGER">
                  {assignable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-loc">Область доступа</Label>
                <Select id="inv-loc" name="locationIds" defaultValue="">
                  <option value="">Вся компания</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-days">Срок доступа эксперта, дней</Label>
                <Input id="inv-days" name="expiresInDays" type="number" min={1} max={90} defaultValue={30} />
                <p className="text-xs text-muted">Учитывается только для роли «Эксперт платформы» (до 90 дней).</p>
              </div>
              <SubmitButton>Создать приглашение</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function RolesTab({ ctx }: { ctx: Ctx }) {
  const roles = await ctx.db.role.findMany({ orderBy: { createdAt: "asc" } });
  const editable = roles.filter((r) => r.key !== "OWNER");
  const perms = Object.entries(PERMISSIONS) as [Permission, (typeof PERMISSIONS)[Permission]][];
  return (
    <div className="space-y-4">
      <Alert tone="info">
        Права собственника не настраиваются. Права «{OWNER_ONLY.map((p) => PERMISSIONS[p].description.toLowerCase()).join("», «")}» доступны только собственнику.
        Эксперт платформы никогда не получает права управления компанией и пользователями.
      </Alert>
      <div className="grid gap-6 xl:grid-cols-2">
        {editable.map((role) => (
          <Card key={role.id}>
            <CardHeader><CardTitle>{role.name}</CardTitle></CardHeader>
            <CardContent>
              <ActionForm action={updateRolePermissionsAction}>
                <input type="hidden" name="roleId" value={role.id} />
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {perms.filter(([p]) => !OWNER_ONLY.includes(p)).map(([p, meta]) => (
                    <label key={p} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="permissions" value={p} defaultChecked={role.permissions.includes(p)} className="mt-0.5 size-4 accent-lavender-500" />
                      <span>{meta.description}</span>
                    </label>
                  ))}
                </div>
                <SubmitButton size="sm">Сохранить права</SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

async function DataTab({ ctx }: { ctx: Ctx }) {
  const s = ctx.org.settings;
  const aiProvider = process.env.AI_PROVIDER ?? "rules";
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Использование данных</CardTitle>
          <CardDescription>Все параметры по умолчанию выключены. Изменения фиксируются в журнале аудита.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={updatePrivacyAction}>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" name="allowExternalAI" defaultChecked={!!s.allowExternalAI} className="mt-0.5 size-4 accent-lavender-500" />
              <span>
                <b>Разрешить передачу обезличенных агрегатов внешнему AI-провайдеру.</b> Персональные данные, имена и исходные тексты
                ответов не передаются. Без согласия анализ выполняет встроенный алгоритмический движок.
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" name="allowAnonymizedAnalytics" defaultChecked={!!s.allowAnonymizedAnalytics} className="mt-0.5 size-4 accent-lavender-500" />
              <span><b>Участвовать в отраслевой аналитике</b> обезличенными агрегатами (без названия компании).</span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" name="allowModelTraining" defaultChecked={!!s.allowModelTraining} className="mt-0.5 size-4 accent-lavender-500" />
              <span><b>Разрешить использование обезличенных данных для улучшения моделей.</b></span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="k">Минимальный размер группы для анонимных результатов</Label>
                <Input id="k" name="anonymityMinGroup" type="number" min={3} max={20} defaultValue={s.anonymityMinGroup ?? 5} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ret">Срок хранения ответов анкет, мес.</Label>
                <Input id="ret" name="retentionMonths" type="number" min={6} max={120} defaultValue={s.retentionMonths ?? 36} />
              </div>
            </div>
            <SubmitButton>Сохранить</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Текущая конфигурация</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>AI-провайдер платформы: <Badge variant="lavender">{aiProvider === "rules" ? "Встроенный алгоритмический анализ" : "Внешний (OpenAI-совместимый API)"}</Badge></p>
          <p>Шифрование чувствительных полей: AES-256-GCM.</p>
          <p>Анонимность: индивидуальные анонимные ответы не показываются никому, включая собственника.</p>
          <p className="text-muted">Удаление ответов по сроку хранения выполняет плановая задача (<code>/api/cron/retention</code>).</p>
        </CardContent>
      </Card>
    </div>
  );
}

function PriorityTab({ ctx }: { ctx: Ctx }) {
  const p = (ctx.org.settings.priority as PrioritySettings | undefined) ?? DEFAULT_PRIORITY_SETTINGS;
  const w = p.weights;
  const fields: [keyof typeof w, string][] = [
    ["severity", "Серьёзность"], ["businessImpact", "Влияние на бизнес"], ["urgency", "Срочность"], ["scale", "Масштаб"], ["systemic", "Системность причин"],
  ];
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Параметры приоритизации проблем</CardTitle>
        <CardDescription>
          Приоритет = взвешенная сумма пяти параметров (1–5). Реализуемость оценивается отдельно и на категорию не влияет.
          Стартовые значения калибруются на пилотах.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={updatePriorityAction}>
          <p className="text-sm font-semibold">Веса (сумма = 1)</p>
          <div className="grid gap-3 sm:grid-cols-5">
            {fields.map(([k, label]) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={k} className="text-xs">{label}</Label>
                <Input id={k} name={k} type="number" step="0.05" min={0} max={1} defaultValue={w[k]} />
              </div>
            ))}
          </div>
          <p className="text-sm font-semibold">Пороги категорий</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["P1", "P2", "P3"] as const).map((k) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={k} className="text-xs">{k}: от</Label>
                <Input id={k} name={k} type="number" step="0.1" min={1} max={5} defaultValue={p.thresholds[k]} />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">Ниже порога P3 — категория P4.</p>
          <SubmitButton>Сохранить</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  );
}

async function ProfileTab({ userId }: { userId: string }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ch = channelStatus();
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Каналы уведомлений</CardTitle>
        <CardDescription>Уведомления в приложении приходят всегда.</CardDescription>
      </CardHeader>
      <CardContent>
        <NotificationPrefs
          notifyEmail={user.notifyEmail}
          notifyTelegram={user.notifyTelegram}
          hasTelegram={!!user.telegramChatIdEnc}
          emailConfigured={ch.email}
          telegramConfigured={ch.telegram}
        />
      </CardContent>
    </Card>
  );
}

async function AuditTab({ ctx }: { ctx: Ctx }) {
  const logs = await ctx.db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const userIds = [...new Set(logs.map((l) => l.actorUserId).filter(Boolean))] as string[];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? "Система";
  return (
    <Card>
      <CardHeader><CardTitle>Последние 100 событий</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <THead><TR><TH>Когда</TH><TH>Кто</TH><TH>Действие</TH><TH>Объект</TH></TR></THead>
          <TBody>
            {logs.map((l) => (
              <TR key={l.id}>
                <TD className="whitespace-nowrap">{formatDate(l.createdAt)}, {l.createdAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</TD>
                <TD>{name(l.actorUserId)}</TD>
                <TD><code className="text-xs">{l.action}</code></TD>
                <TD className="text-xs text-muted">{l.entityType}{l.entityId ? ` · ${l.entityId.slice(-6)}` : ""}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
