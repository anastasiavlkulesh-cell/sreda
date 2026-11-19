"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { encrypt } from "@/server/crypto";

export const updateNotificationPrefsAction = defineAction(
  "updateNotificationPrefs",
  z.object({
    notifyEmail: z.string().optional(),
    notifyTelegram: z.string().optional(),
    telegramChatId: z.string().trim().regex(/^-?\d{4,20}$/, "Chat ID — число из Telegram").optional().or(z.literal("")),
  }),
  async (i) => {
    const user = await requireUser();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        notifyEmail: i.notifyEmail === "on",
        notifyTelegram: i.notifyTelegram === "on",
        ...(i.telegramChatId ? { telegramChatIdEnc: encrypt(i.telegramChatId) } : {}),
      },
    });
    revalidatePath("/settings");
    return { ok: true, message: "Настройки уведомлений сохранены" };
  },
);
