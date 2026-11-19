import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center p-6">
      <div className="max-w-md space-y-3 text-center">
        <p className="font-display text-5xl font-extrabold text-lavender-500">404</p>
        <h1 className="text-xl font-extrabold">Страница не найдена</h1>
        <p className="text-sm text-muted">Возможно, запись была удалена или у вас нет к ней доступа.</p>
        <Link href="/dashboard" className={buttonVariants({ variant: "secondary" })}>На главную</Link>
      </div>
    </div>
  );
}
