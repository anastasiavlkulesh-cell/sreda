import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Нет доступа" };

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-peach-100 text-peach-600">
          <ShieldAlert className="size-7" />
        </div>
        <h1 className="text-2xl font-extrabold">Нет доступа к разделу</h1>
        <p className="text-sm text-muted">Ваша роль не даёт доступа к этой странице. Если доступ нужен для работы, обратитесь к собственнику компании.</p>
        <Link href="/dashboard" className={buttonVariants()}>На главную</Link>
      </div>
    </div>
  );
}
