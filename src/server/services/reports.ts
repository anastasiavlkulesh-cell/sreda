import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { OrgContext } from "../context-core";
import { audit } from "../audit";
import { AppError, forbidden, notFound } from "../errors";
import { saveBuffer } from "../storage";
import { parseDimensions } from "./assessment";
import { DIMENSIONS, SOURCE_LABELS } from "@/domain/methodology/v1";
import { scoreLevel } from "@/domain/ssi";
import { CONFIDENCE_LABELS, FINDING_LABELS, type SourceType } from "@/domain/types";
import { TASK_STATUS_LABELS, TASK_OUTCOME_LABELS } from "@/lib/labels";
import { revenueChange, type MetricKey } from "@/domain/metrics";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const NAVY = "#0F172A";
const LAVENDER = "#7C6CFC";
const PEACH = "#FFB997";
const MUTED = "#5B6478";
const fmtDate = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

export async function buildReportData(ctx: OrgContext, diagnosticId: string) {
  const diagnostic = await ctx.db.diagnostic.findFirst({ where: { id: diagnosticId, archivedAt: null } });
  if (!diagnostic) throw notFound("Диагностика не найдена");
  const assessment = await ctx.db.assessment.findFirst({ where: { diagnosticId }, orderBy: { calculatedAt: "desc" } });
  if (!assessment) throw new AppError("По диагностике ещё нет расчёта");
  const previous = await ctx.db.assessment.findFirst({
    where: { diagnosticId: { not: diagnosticId }, calculatedAt: { lt: assessment.calculatedAt }, diagnostic: { status: "COMPLETED" } },
    orderBy: { calculatedAt: "desc" },
  });
  const analysis = await ctx.db.aIAnalysis.findFirst({ where: { diagnosticId, kind: "DIAGNOSTIC", status: "COMPLETED" }, orderBy: { createdAt: "desc" } });
  const problems = await ctx.db.problem.findMany({
    where: { diagnosticId, status: { in: ["OPEN", "IN_PLAN", "MONITORING"] } },
    orderBy: [{ priority: "asc" }, { priorityScore: "desc" }],
    include: { causes: true, recommendations: { take: 1, orderBy: { createdAt: "desc" } } },
    take: 8,
  });
  const tasks = await ctx.db.task.findMany({ where: { archivedAt: null, planId: { not: null } }, select: { title: true, status: true, outcome: true, outcomeNote: true, dueDate: true } });
  const metrics = await ctx.db.businessMetric.findMany({ where: { kind: "FACT" }, orderBy: { periodStart: "asc" } });
  return { diagnostic, assessment, previous, analysis, problems, tasks, metrics };
}

export async function generatePdfReport(ctx: OrgContext, diagnosticId: string) {
  if (!ctx.can("reports.view")) throw forbidden();
  const data = await buildReportData(ctx, diagnosticId);
  const buf = await renderPdf(ctx.org.name, ctx.org.isDemo, data);
  const title = `Отчёт SERVICE 5D — ${data.diagnostic.title}`;
  const file = await saveBuffer(ctx.db, ctx.org.id, ctx.user.id, `${title.replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 80)}.pdf`, "application/pdf", buf);
  const report = await ctx.db.report.create({
    data: { organizationId: ctx.org.id, diagnosticId, title, fileId: file.id, createdById: ctx.user.id },
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "report.generate", "Report", report.id);
  return { report, file, size: buf.length };
}

export async function listReports(ctx: OrgContext) {
  if (!ctx.can("reports.view")) throw forbidden();
  return ctx.db.report.findMany({ orderBy: { createdAt: "desc" }, include: { file: { select: { id: true, sizeBytes: true } } } });
}

type Data = Awaited<ReturnType<typeof buildReportData>>;

export function renderPdf(orgName: string, isDemo: boolean, d: Data): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `СРЕДА — ${d.diagnostic.title}`, Author: "Платформа СРЕДА" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("R", path.join(FONT_DIR, "Inter-Regular.otf"));
    doc.registerFont("B", path.join(FONT_DIR, "Inter-Bold.otf"));
    const W = doc.page.width - 96;

    const header = () => {
      const { x, y } = doc;
      doc.rect(0, 0, doc.page.width, 6).fill(LAVENDER);
      if (isDemo) {
        doc.save().roundedRect(doc.page.width - 48 - 60, 20, 60, 20, 10).fill(PEACH);
        doc.fillColor(NAVY).font("B").fontSize(9).text("ДЕМО", doc.page.width - 48 - 60, 26, { width: 60, align: "center", lineBreak: false });
        doc.restore();
      }
      doc.x = 48;
      doc.y = Math.max(y, 48);
      void x;
    };
    header();
    doc.on("pageAdded", header);

    const h = (t: string, size = 14) => {
      doc.moveDown(0.8).fillColor(NAVY).font("B").fontSize(size).text(t, { width: W });
      doc.moveDown(0.3);
    };
    const p = (t: string, opts: { color?: string; size?: number; bold?: boolean } = {}) =>
      doc.fillColor(opts.color ?? NAVY).font(opts.bold ? "B" : "R").fontSize(opts.size ?? 10).text(t, { width: W, lineGap: 2 });
    const ensure = (space: number) => {
      if (doc.y + space > doc.page.height - 60) doc.addPage();
    };

    // Титул
    doc.moveDown(1.5).fillColor(LAVENDER).font("B").fontSize(11).text("СРЕДА · интеллектуальная система управления качеством бизнеса");
    doc.moveDown(0.6).fillColor(NAVY).font("B").fontSize(22).text(orgName, { width: W });
    doc.moveDown(0.2).font("R").fontSize(13).fillColor(MUTED).text(`Отчёт SERVICE 5D: ${d.diagnostic.title}`);
    p(`Расчёт от ${fmtDate(d.assessment.calculatedAt)} · методика ${d.assessment.methodologyVersion} · сформирован ${fmtDate(new Date())}`, { color: MUTED, size: 9 });
    if (isDemo) p("Все данные отчёта демонстрационные.", { color: "#C2621F", size: 9 });

    // SSI
    h("Индекс SSI", 16);
    const ssi = d.assessment.ssi;
    doc.fillColor(NAVY).font("B").fontSize(40).text(ssi === null ? "н/д" : String(Math.round(ssi)), { width: W });
    doc.font("R").fontSize(12).fillColor(MUTED).text(ssi === null ? "Данных недостаточно для расчёта" : `из 100 · ${scoreLevel(ssi).label.toLowerCase()}`, { width: W });
    p(`Достоверность оценки: ${CONFIDENCE_LABELS[d.assessment.confidence].toLowerCase()}.${d.previous?.ssi != null && ssi !== null ? ` Изменение к предыдущей диагностике: ${ssi - d.previous.ssi >= 0 ? "+" : ""}${(ssi - d.previous.ssi).toFixed(1)}.` : ""}`);

    // Направления
    h("Пять направлений SERVICE 5D");
    const dims = parseDimensions(d.assessment.dimensions);
    const prevDims = d.previous ? parseDimensions(d.previous.dimensions) : [];
    for (const dim of dims) {
      ensure(40);
      const def = DIMENSIONS.find((x) => x.key === dim.key)!;
      const y = doc.y;
      doc.fillColor(NAVY).font("B").fontSize(10).text(def.name, 48, y, { width: 260 });
      const score = dim.score;
      const barX = 320;
      const barW = 160;
      doc.roundedRect(barX, y + 2, barW, 8, 4).fill("#E8E4FF");
      if (score !== null) doc.roundedRect(barX, y + 2, Math.max(4, (barW * score) / 100), 8, 4).fill(LAVENDER);
      const prev = prevDims.find((x) => x.key === dim.key)?.score;
      doc.fillColor(NAVY).font("B").fontSize(10).text(score === null ? "н/д" : String(Math.round(score)), barX + barW + 10, y, { width: 40 });
      if (prev != null && score !== null) {
        const delta = score - prev;
        doc.fillColor(delta >= 0 ? "#2F8F6B" : "#D9485F").font("R").fontSize(8).text(`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`, barX + barW + 40, y + 1);
      }
      doc.x = 48;
      doc.moveDown(0.9);
    }

    if (d.assessment.criticalRisks.length) {
      h("Критические риски");
      for (const r of d.assessment.criticalRisks) p(`• ${r}`);
    }
    if (d.assessment.limitations.length) {
      h("Ограничения оценки");
      for (const r of d.assessment.limitations) p(`• ${r}`, { color: MUTED });
    }

    // Выводы анализа
    const summary = (d.analysis?.output as { summary?: string } | null)?.summary;
    if (summary) {
      h("Выводы AI-анализа");
      p(summary);
      p(`Анализ: ${d.analysis!.provider === "rules" ? "встроенный алгоритмический анализ" : `внешний провайдер ${d.analysis!.model}`}, ${fmtDate(d.analysis!.createdAt)}.`, { color: MUTED, size: 8 });
    }
    if (d.problems.length) {
      h("Приоритетные проблемы");
      for (const pr of d.problems) {
        ensure(80);
        p(`${pr.priority} · ${pr.title}`, { bold: true });
        p(`Статус вывода: ${FINDING_LABELS[pr.findingStatus]} · достоверность ${CONFIDENCE_LABELS[pr.confidence].toLowerCase()} · источники: ${pr.dataSources.map((s) => SOURCE_LABELS[s as SourceType]).join(", ")}`, { color: MUTED, size: 8 });
        p(pr.description, { size: 9 });
        const causes = pr.causes.filter((c) => c.findingStatus !== "HYPOTHESIS");
        if (causes.length) p(`Подтверждённые причины: ${causes.map((c) => c.title.replace(/\.$/, "")).join("; ")}.`, { size: 9 });
        if (pr.recommendations[0]) p(`Рекомендация: ${pr.recommendations[0].title}`, { size: 9, color: LAVENDER });
        doc.moveDown(0.5);
      }
    }

    // План и результаты
    if (d.tasks.length) {
      h("Выполнение плана улучшений");
      const done = d.tasks.filter((t) => t.status === "DONE");
      const improved = done.filter((t) => t.outcome === "IMPROVED").length;
      const noEffect = done.filter((t) => t.outcome === "NO_EFFECT").length;
      p(`Задач в планах: ${d.tasks.length}. Выполнено: ${done.length}. Просрочено: ${d.tasks.filter((t) => t.status === "OVERDUE").length}.`);
      p(`Повторный замер: улучшение подтверждено — ${improved}, эффект не подтверждён — ${noEffect}, ожидают замера — ${done.length - improved - noEffect}.`);
      p("Закрытие задачи не считается устранением проблемы: эффект подтверждается только повторной диагностикой.", { color: MUTED, size: 8 });
      for (const t of done.filter((x) => x.outcomeNote)) p(`• ${t.title} — ${TASK_OUTCOME_LABELS[t.outcome].toLowerCase()} (${t.outcomeNote})`, { size: 9 });
      void TASK_STATUS_LABELS;
    }

    // Показатели
    if (d.metrics.length) {
      h("Бизнес-показатели (факт)");
      const rc = revenueChange(d.metrics.map((m) => ({ key: m.key as MetricKey, kind: m.kind, periodStart: m.periodStart, value: m.value })));
      const last = (k: string) => d.metrics.filter((m) => m.key === k).at(-1);
      const rev = last("REVENUE");
      if (rev) p(`Выручка за ${rev.periodStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}: ${Math.round(rev.value).toLocaleString("ru-RU")} ₽.`);
      if (rc) p(`Изменение выручки за 3 месяца ${rc.basis === "yoy" ? "к прошлому году" : "к предыдущим 3 месяцам"}: ${rc.change >= 0 ? "+" : ""}${(rc.change * 100).toFixed(1)}%.`);
      const rep = last("REPEAT_SALES");
      if (rep) p(`Доля повторных продаж: ${rep.value.toFixed(0)}%.`);
      p("Изменение показателей не приписывается качеству сервиса без проверки сезонности, цен, трафика и внешних факторов.", { color: MUTED, size: 8 });
    }

    doc.moveDown(2);
    p("Отчёт подготовлен платформой СРЕДА. «Сервис начинается с отношения. Результат создаётся системой».", { color: MUTED, size: 8 });
    doc.end();
  });
}
