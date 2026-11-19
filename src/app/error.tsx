"use client";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset, error }: { reset: () => void; error: Error & { digest?: string } }) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center p-6">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-extrabold">Что-то пошло не так</h1>
        <p className="text-sm text-muted">Ошибка зафиксирована{error.digest ? ` (код ${error.digest})` : ""}. Попробуйте повторить действие.</p>
        <Button onClick={reset}>Повторить</Button>
      </div>
    </div>
  );
}
