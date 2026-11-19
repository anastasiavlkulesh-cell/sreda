import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { findInvitation } from "@/server/services/organizations";
import { Alert } from "@/components/ui/misc";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Регистрация" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  if (await getSessionUser()) redirect(invite ? `/invite/${encodeURIComponent(invite)}` : "/dashboard");
  const invitation = invite ? await findInvitation(invite) : null;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-extrabold">Регистрация</h1>
        <p className="text-sm text-muted">
          {invitation ? "Создайте учётную запись, чтобы принять приглашение." : "Создайте учётную запись собственника и подключите свою компанию."}
        </p>
      </div>
      {invite && !invitation && <Alert tone="warning" title="Приглашение недействительно">Ссылка устарела или уже использована. Попросите отправить новое приглашение.</Alert>}
      {invitation && (
        <Alert tone="info" title={`Приглашение в «${invitation.organization.name}»`}>
          Роль: {invitation.role.name}. Используйте e-mail {invitation.email}.
        </Alert>
      )}
      <RegisterForm inviteToken={invitation ? invite : undefined} email={invitation?.email} />
      <p className="text-sm text-muted">
        Уже есть учётная запись?{" "}
        <Link href="/login" className="font-semibold text-lavender-600 hover:underline">Войти</Link>
      </p>
    </div>
  );
}
