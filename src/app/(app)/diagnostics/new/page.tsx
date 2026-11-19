import { requireOrgContext } from "@/server/context";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { DEFAULT_TARGET_RESPONSES, SOURCE_LABELS } from "@/domain/methodology/v1";
import type { SourceType } from "@/domain/types";
import { NewDiagnosticForm } from "./form";

export const metadata = { title: "Новая диагностика" };

const HINTS: Record<SourceType, string> = {
  OWNER: "Заполняете вы в системе",
  MANAGER: "Ссылка для управляющих и менеджеров",
  EMPLOYEE: "Анонимная ссылка для команды",
  CUSTOMER: "Ссылка или QR-код для клиентов",
  MYSTERY_SHOPPER: "Отчёт по итогам визита",
  BUSINESS_METRICS: "Данные из раздела «Бизнес-показатели»",
};

export default async function NewDiagnosticPage() {
  const ctx = await requireOrgContext("diagnostics.manage");
  const [locations, sub] = await Promise.all([
    ctx.db.location.findMany({ where: { archivedAt: null, ...(ctx.locationScope ? { id: { in: ctx.locationScope } } : {}) } }),
    prisma.subscription.findUnique({ where: { organizationId: ctx.org.id } }),
  ]);
  const enabled = new Set(sub?.enabledSources ?? []);
  const sources = (Object.keys(SOURCE_LABELS) as SourceType[]).map((s) => ({
    type: s,
    label: SOURCE_LABELS[s],
    hint: HINTS[s],
    target: DEFAULT_TARGET_RESPONSES[s],
    available: enabled.has(s),
  }));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Новая диагностика" description="Выберите источники данных: чем их больше, тем выше достоверность оценки. Система сопоставит мнения и покажет расхождения." />
      <Card>
        <CardContent className="pt-5">
          <NewDiagnosticForm locations={locations.map((l) => ({ id: l.id, name: l.name }))} sources={sources} scoped={!!ctx.locationScope} />
        </CardContent>
      </Card>
    </div>
  );
}
