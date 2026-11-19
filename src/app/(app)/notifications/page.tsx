import Link from "next/link";
import { Bell } from "lucide-react";
import { requireOrgContext } from "@/server/context";
import { listNotifications } from "@/server/services/notifications";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { markReadAction } from "@/app/actions/team";
import { formatDate, cn } from "@/lib/utils";

export const metadata = { title: "Уведомления" };

export default async function NotificationsPage() {
  const ctx = await requireOrgContext();
  const items = await listNotifications(ctx.user.id, ctx.org.id, 100);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Уведомления"
        actions={items.some((n) => !n.readAt) && (
          <ActionForm action={markReadAction} quiet><SubmitButton variant="secondary">Отметить все прочитанными</SubmitButton></ActionForm>
        )}
      />
      {items.length === 0 ? (
        <EmptyState icon={<Bell className="size-6" />} title="Уведомлений нет" />
      ) : (
        <Card>
          <CardContent className="divide-y divide-line pt-2">
            {items.map((n) => (
              <div key={n.id} className={cn("flex gap-3 py-3", !n.readAt && "font-medium")}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-lavender-500")} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  {n.link ? <Link href={n.link} className="hover:text-lavender-600">{n.title}</Link> : <p>{n.title}</p>}
                  <p className="line-clamp-2 text-sm font-normal text-muted">{n.body}</p>
                  <p className="text-xs font-normal text-muted">
                    {formatDate(n.createdAt)}
                    {n.emailSentAt ? " · отправлено на e-mail" : ""}
                    {n.telegramSentAt ? " · отправлено в Telegram" : ""}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
