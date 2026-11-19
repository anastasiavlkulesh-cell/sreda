import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getOrgContext } from "@/server/context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { CreateOrgForm, CreateDemoForm } from "./forms";

export const metadata = { title: "Подключение компании" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const ctx = await getOrgContext();
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
      <div className="mb-8 space-y-2">
        <p className="text-sm font-semibold text-lavender-600">Здравствуйте, {user.name}</p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Подключите компанию к СРЕДЕ</h1>
        <p className="max-w-2xl text-muted">
          Создайте свою компанию и первую точку — дальше можно пригласить команду и запустить диагностику SERVICE 5D.
          Чтобы посмотреть систему в работе, создайте демо-компанию с заполненными данными.
        </p>
        {ctx && (
          <Link href="/dashboard" className={buttonVariants({ variant: "link" })}>
            Вернуться в «{ctx.org.name}» →
          </Link>
        )}
      </div>
      <div className="grid gap-6 md:grid-cols-5">
        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle>Моя компания</CardTitle>
            <CardDescription>Вы станете собственником с полным доступом.</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateOrgForm />
          </CardContent>
        </Card>
        <Card className="md:col-span-2 border-peach-200 bg-peach-100/40">
          <CardHeader>
            <CardTitle>Демо-компания</CardTitle>
            <CardDescription>
              Сеть кофеен с заполненной диагностикой, проблемами, планом, задачами и показателями. Все данные помечены «Демо» и
              хранятся отдельно от ваших компаний.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateDemoForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
