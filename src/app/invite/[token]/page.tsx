import Link from "next/link";
import { findInvitation } from "@/server/services/organizations";
import { getSessionUser } from "@/server/auth/session";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { AcceptInviteForm } from "./accept-form";

export const metadata = { title: "Приглашение" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await findInvitation(token);
  const user = await getSessionUser();
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Приглашение в СРЕДУ</CardTitle>
          {inv && <CardDescription>Компания «{inv.organization.name}», роль: {inv.role.name}.</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4">
          {!inv && <Alert tone="warning" title="Приглашение недействительно">Ссылка устарела, отозвана или уже использована.</Alert>}
          {inv && !user && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">Приглашение отправлено на {inv.email}.</p>
              <Link className={buttonVariants()} href={`/register?invite=${encodeURIComponent(token)}`}>Зарегистрироваться и принять</Link>
              <Link className={buttonVariants({ variant: "secondary" })} href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>У меня уже есть учётная запись</Link>
            </div>
          )}
          {inv && user && <AcceptInviteForm token={token} email={user.email} />}
        </CardContent>
      </Card>
    </div>
  );
}
