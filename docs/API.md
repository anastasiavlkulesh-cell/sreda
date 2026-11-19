# API СРЕДЫ

Основное взаимодействие интерфейса с сервером идёт через **серверные действия Next.js** (`src/app/actions/*`). Это типизированные функции, которые вызываются из форм и защищены от CSRF механизмами Next.js. Каждое действие:

1. валидирует вход схемой Zod (ошибки возвращаются в `fieldErrors`);
2. получает контекст `actionContext(право)`: без входа — `UNAUTHORIZED`, без права — `FORBIDDEN`;
3. вызывает сервис из `src/server/services`, где права проверяются повторно;
4. возвращает `ActionState { ok, message?, error?, fieldErrors?, data? }` или выполняет перенаправление.

## HTTP-маршруты

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET/POST | `/api/auth/[...nextauth]` | публично | Auth.js: вход, выход, сессия |
| GET | `/api/files/{id}` | участник компании, которому видна связанная запись | Выдача файла (доказательство, отчёт). Ответ `private, no-store`; запись в аудит. Чужой файл → 404 |
| GET | `/api/health` | публично | Проверка готовности: `{status:"ok"}` или 503 |
| POST | `/api/cron/overdue` | `Authorization: Bearer CRON_SECRET` | Отметка просроченных задач и уведомления. Ответ `{ok, markedOverdue}` |
| POST | `/api/cron/retention` | `Authorization: Bearer CRON_SECRET` | Политика хранения. Ответ `{ok, responses, loginAttempts, notifications}` |
| GET | `/s/{token}` | по ссылке | Публичная анкета (руководители, сотрудники, клиенты, тайный покупатель, пульс-опрос). `?i={invite}` — одноразовая ссылка |

## Серверные действия (по модулям)

| Модуль | Действие | Право |
| --- | --- | --- |
| auth | `loginAction`, `registerAction`, `logoutAction`, `switchOrgAction`, `acceptInviteAction` | — |
| org | `createOrgAction`, `createDemoAction` | вход |
| | `updateOrgAction`, `updatePrivacyAction`, `updatePriorityAction` | `org.manage` |
| | `createLocationAction`, `archiveLocationAction`, `createDepartmentAction` | `locations.manage` |
| | `inviteMemberAction`, `revokeInvitationAction` | `members.invite` |
| | `changeRoleAction`, `deactivateMemberAction` | `members.manage` |
| | `updateRolePermissionsAction` | `roles.manage` (только собственник) |
| profile | `updateNotificationPrefsAction` | вход |
| diagnostics | `createDiagnosticAction`, `launchDiagnosticAction`, `createInvitesAction`, `recalculateAction`, `completeCollectionAction`, `reopenAction`, `archiveDiagnosticAction`, `addCriterionAction`, `toggleCriterionAction` | `diagnostics.manage` |
| | `submitInAppAction` (анкета собственника или руководителя) | `diagnostics.respond` / `diagnostics.manage` |
| | `submitPublicAction` (публичная анкета) | по токену ссылки |
| | `addMetricAction`, `importMetricsAction`, `deleteMetricAction` | `metrics.manage` |
| analysis | `runAnalysisAction` | `analysis.run` |
| | `problemStatusAction` | `plan.manage` |
| plan | `generatePlanAction`, `submitPlanAction`, `removeTaskAction` | `plan.manage` |
| | `approvePlanAction`, `returnPlanAction` | `plan.approve` (только собственник) |
| | `updateTaskAction` | `tasks.manage` / `plan.manage` |
| | `createTaskAction` | `tasks.manage` |
| | `startTaskAction`, `submitReviewAction` | исполнитель задачи |
| | `checklistAction`, `evidenceAction` | исполнитель или `tasks.manage` |
| | `commentAction` | видимость задачи |
| | `reviewTaskAction` | `tasks.manage`, не исполнитель |
| team | `saveEmployeeAction`, `archiveEmployeeAction`, `createPulseAction`, `closePulseAction` | `team.manage` |
| reports | `generateReportAction` | `reports.view` |
| notifications | `markReadAction` | вход |
| assistant | `askAction` | `assistant.use` |

## Коды ошибок сервисов (`AppError.code`)

`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `RATE_LIMIT`.

Сообщения ошибок — на русском и безопасны для показа пользователю. Внутренние ошибки пишутся в лог (JSON), а пользователь видит нейтральное сообщение.

## Внешний REST API для интеграций (CRM, POS)

Следующий этап: `/api/v1/*` с ключами API на уровне компании и OpenAPI-спецификацией.
