import { NextResponse } from "next/server";
import { getOrgContext } from "@/server/context";
import { storage } from "@/server/storage";
import { taskVisibilityWhere } from "@/server/services/tasks";
import { audit } from "@/server/audit";

/** Выдача файла только участнику компании, которому доступна связанная запись. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const { id } = await params;
  const file = await ctx.db.storedFile.findFirst({ where: { id }, include: { taskEvidence: { select: { taskId: true } }, reports: { select: { id: true } } } });
  if (!file) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  let allowed = false;
  if (file.reports.length) allowed = ctx.can("reports.view");
  if (!allowed && file.taskEvidence.length) {
    const visible = await ctx.db.task.count({ where: { id: { in: file.taskEvidence.map((t) => t.taskId) }, ...taskVisibilityWhere(ctx) } });
    allowed = visible > 0;
  }
  if (!allowed && file.uploadedById === ctx.user.id) allowed = true;
  if (!allowed) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const body = await storage().get(file.storageKey);
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "file.download", "StoredFile", file.id);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": file.mimeType,
      "content-disposition": `${file.mimeType.startsWith("image/") || file.mimeType === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
