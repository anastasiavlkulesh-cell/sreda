import { notFound } from "next/navigation";
import { getPublicSurvey } from "@/server/services/diagnostics";
import { SurveyForm } from "@/components/survey/survey-form";
import { submitPublicAction } from "@/app/actions/diagnostics";
import { DemoBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { DIMENSIONS } from "@/domain/methodology/v1";

export const metadata = { title: "Анкета", robots: { index: false } };

export default async function PublicSurveyPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ i?: string }> }) {
  const { token } = await params;
  const { i } = await searchParams;
  const found = await getPublicSurvey(token);
  if (!found) notFound();
  const { survey, departments } = found;
  const dimName = (k?: string) => DIMENSIONS.find((d) => d.key === k)?.shortName ?? null;
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <div className="mb-6 space-y-2">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-lavender-500 to-lilac-400 font-display font-extrabold text-white">С</span>
          <span className="text-sm font-semibold text-muted">{survey.organization.name}</span>
          {survey.organization.isDemo && <DemoBadge />}
        </div>
        <h1 className="text-2xl font-extrabold sm:text-3xl">{survey.title}</h1>
        {survey.intro && <p className="text-sm text-muted">{survey.intro}</p>}
      </div>
      {survey.status !== "OPEN" ? (
        <Alert tone="info" title="Сбор ответов завершён">Спасибо за интерес! Эта анкета больше не принимает ответы.</Alert>
      ) : (
        <SurveyForm
          action={submitPublicAction}
          hidden={{ token, ...(i ? { invite: i } : {}) }}
          departments={survey.sourceType === "EMPLOYEE" ? departments : undefined}
          askLabel={survey.sourceType === "MYSTERY_SHOPPER" || survey.sourceType === "MANAGER"}
          labelPlaceholder={survey.sourceType === "MANAGER" ? "Должность и точка" : "Дата и точка визита"}
          questions={survey.questions.map((q) => ({
            id: q.id,
            type: q.type,
            text: q.text,
            isRequired: q.isRequired,
            group: survey.sourceType === "CUSTOMER" ? null : (dimName(q.criterion?.dimension.key) ?? "Открытые вопросы"),
          }))}
        />
      )}
      <p className="mt-8 text-xs text-muted">
        {survey.isAnonymous
          ? "Анкета анонимная: мы не собираем имя, e-mail или телефон, а время ответа сохраняем с точностью до дня."
          : "Ответы используются только для оценки качества сервиса компании."}{" "}
        Платформа СРЕДА.
      </p>
    </div>
  );
}
