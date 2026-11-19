import { CheckCircle2 } from "lucide-react";

export const metadata = { title: "Спасибо", robots: { index: false } };

export default function ThanksPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md space-y-3 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-level-good/12 text-level-high">
          <CheckCircle2 className="size-7" />
        </div>
        <h1 className="text-2xl font-extrabold">Спасибо, ответы сохранены</h1>
        <p className="text-sm text-muted">Ваше мнение поможет сделать сервис лучше. Страницу можно закрыть.</p>
      </div>
    </div>
  );
}
