import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/context";
import { getInAppSurvey } from "@/server/services/diagnostics";
import { AppError } from "@/server/errors";
import { SurveyForm } from "@/components/survey/survey-form";
import { submitInAppAction } from "@/app/actions/diagnostics";
import { PageHeader, Alert } from "@/components/ui/misc";
import { DIMENSIONS } from "@/domain/methodology/v1";

export const metadata = { title: "Анкета" };

export default async function RespondPage({ params }: { params: Promise<{ id: string; surveyId: string }> }) {
  const ctx = await requireOrgContext();
  const { id, surveyId } = await params;
  let survey;
  try {
    survey = await getInAppSurvey(ctx, surveyId);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  if (survey.diagnosticId !== id) notFound();
  const dimName = (k?: string) => DIMENSIONS.find((d) => d.key === k)?.shortName ?? "Открытые вопросы";
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={survey.title} description={survey.intro ?? undefined} />
      {survey.status !== "OPEN" ? (
        <Alert tone="info">Сбор ответов по этой анкете завершён.</Alert>
      ) : (
        <SurveyForm
          action={submitInAppAction}
          hidden={{ surveyId, diagnosticId: id }}
          questions={survey.questions.map((q) => ({ id: q.id, type: q.type, text: q.text, isRequired: q.isRequired, group: dimName(q.criterion?.dimension.key) }))}
          submitText="Сохранить ответы"
        />
      )}
    </div>
  );
}
