import { Sparkles } from "lucide-react";
import { requireOrgContext } from "@/server/context";
import { assistantHistory, SUGGESTED_QUESTIONS } from "@/server/services/assistant";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { AskForm } from "./ask-form";

export const metadata = { title: "AI-помощник" };

export default async function AssistantPage() {
  const ctx = await requireOrgContext("assistant.use");
  const history = await assistantHistory(ctx);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="AI-помощник СРЕДА"
        badge={ctx.org.isDemo ? <DemoBadge /> : undefined}
        description="Отвечает на вопросы по данным вашей компании: диагностика, проблемы и причины, план, показатели, команда. Каждый ответ — с источниками и ограничениями."
      />
      <AskForm suggestions={SUGGESTED_QUESTIONS} />
      {history.length === 0 ? (
        <EmptyState icon={<Sparkles className="size-6" />} title="Задайте первый вопрос" description="Например: «Что исправить в первую очередь?»" />
      ) : (
        <div className="space-y-4">
          {history.map((h) => (
            <Card key={h.id}>
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-display font-bold">{h.question}</p>
                  <span className="shrink-0 text-xs text-muted">{formatDate(h.createdAt)}</span>
                </div>
                <Badge variant="lavender">{h.answer.role}</Badge>
                <p className="text-sm leading-relaxed">{h.answer.text}</p>
                {h.answer.facts.length > 0 && (
                  <ul className="space-y-1.5 text-sm">
                    {h.answer.facts.map((f) => <li key={f} className="rounded-xl bg-lavender-50/70 px-3 py-2">{f}</li>)}
                  </ul>
                )}
                {h.answer.sources.length > 0 && <p className="text-xs text-muted">Источники: {h.answer.sources.join(", ")}</p>}
                {h.answer.limitations.length > 0 && <p className="text-xs text-peach-600">Ограничения: {h.answer.limitations.join(" ")}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
