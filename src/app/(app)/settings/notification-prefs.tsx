"use client";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/input";
import { updateNotificationPrefsAction } from "@/app/actions/profile";

export function NotificationPrefs(p: { notifyEmail: boolean; notifyTelegram: boolean; hasTelegram: boolean; emailConfigured: boolean; telegramConfigured: boolean }) {
  return (
    <ActionForm action={updateNotificationPrefsAction}>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="notifyEmail" defaultChecked={p.notifyEmail} className="mt-0.5 size-4 accent-lavender-500" />
        <span>
          E-mail {!p.emailConfigured && <span className="text-peach-600">— канал не подключён на сервере (не задан SMTP_URL)</span>}
        </span>
      </label>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="notifyTelegram" defaultChecked={p.notifyTelegram} className="mt-0.5 size-4 accent-lavender-500" />
        <span>
          Telegram {!p.telegramConfigured && <span className="text-peach-600">— бот не подключён на сервере (не задан TELEGRAM_BOT_TOKEN)</span>}
        </span>
      </label>
      <div className="space-y-1.5">
        <Label htmlFor="tg">Telegram chat ID</Label>
        <Input id="tg" name="telegramChatId" inputMode="numeric" placeholder={p.hasTelegram ? "Сохранён (зашифрован). Введите новый, чтобы заменить" : "Например, 123456789"} />
        <p className="text-xs text-muted">Хранится в зашифрованном виде.</p>
      </div>
      <SubmitButton>Сохранить</SubmitButton>
    </ActionForm>
  );
}
