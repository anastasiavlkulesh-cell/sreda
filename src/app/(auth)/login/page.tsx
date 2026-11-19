import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Вход" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { next } = await searchParams;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-extrabold">Вход в СРЕДУ</h1>
        <p className="text-sm text-muted">Введите e-mail и пароль вашей учётной записи.</p>
      </div>
      <LoginForm next={next} />
      <p className="text-sm text-muted">
        Нет учётной записи?{" "}
        <Link href="/register" className="font-semibold text-lavender-600 hover:underline">
          Зарегистрироваться
        </Link>
      </p>
    </div>
  );
}
