"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { actionContext } from "@/server/context";
import { getOrgContext } from "@/server/context";
import { saveEmployee, archiveEmployee, createPulseSurvey, closePulseSurvey } from "@/server/services/team";
import { generatePdfReport } from "@/server/services/reports";
import { markRead } from "@/server/services/notifications";
import { AppError } from "@/server/errors";

export const saveEmployeeAction = defineAction(
  "saveEmployee",
  z.object({
    id: z.string().optional(),
    fullName: z.string().trim().min(3, "Укажите ФИО").max(150),
    position: z.string().trim().min(2, "Укажите должность").max(100),
    locationId: z.string().optional(),
    departmentId: z.string().optional(),
    contact: z.string().trim().max(150).optional(),
    hiredAt: z.string().optional(),
  }),
  async (i) => {
    const ctx = await actionContext("team.manage");
    await saveEmployee(ctx, { ...i, hiredAt: i.hiredAt ? new Date(i.hiredAt) : null, contact: i.contact });
    revalidatePath("/team");
    return { ok: true, message: i.id ? "Данные сотрудника обновлены" : "Сотрудник добавлен" };
  },
);

export const archiveEmployeeAction = defineAction("archiveEmployee", z.object({ id: z.string() }), async ({ id }) => {
  const ctx = await actionContext("team.manage");
  await archiveEmployee(ctx, id);
  revalidatePath("/team");
  return { ok: true };
});

export const createPulseAction = defineAction("createPulse", z.object({ title: z.string().trim().min(3).max(150) }), async ({ title }) => {
  const ctx = await actionContext("team.manage");
  await createPulseSurvey(ctx, title);
  revalidatePath("/team");
  return { ok: true, message: "Опрос создан. Отправьте ссылку команде." };
});

export const closePulseAction = defineAction("closePulse", z.object({ id: z.string() }), async ({ id }) => {
  const ctx = await actionContext("team.manage");
  await closePulseSurvey(ctx, id);
  revalidatePath("/team");
  return { ok: true, message: "Опрос закрыт" };
});

export const generateReportAction = defineAction("generateReport", z.object({ diagnosticId: z.string() }), async ({ diagnosticId }) => {
  const ctx = await actionContext("reports.view");
  const { file } = await generatePdfReport(ctx, diagnosticId);
  revalidatePath("/reports");
  return { ok: true, message: "Отчёт сформирован", data: { fileId: file.id } };
});

export const markReadAction = defineAction("markRead", z.object({ id: z.string().optional() }), async ({ id }) => {
  const ctx = await getOrgContext();
  if (!ctx) throw new AppError("Требуется вход", "UNAUTHORIZED");
  await markRead(ctx.user.id, ctx.org.id, id);
  revalidatePath("/", "layout");
  return { ok: true };
});
