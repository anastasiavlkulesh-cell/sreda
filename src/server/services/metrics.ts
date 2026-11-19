import "server-only";
import type { OrgContext } from "../context-core";
import { assertLocationInScope } from "../context-core";
import { audit } from "../audit";
import { AppError, forbidden, notFound } from "../errors";
import { METRIC_META, type MetricKey } from "@/domain/metrics";

const KIND_ALIASES: Record<string, "FACT" | "ESTIMATE" | "FORECAST"> = {
  факт: "FACT", fact: "FACT", оценка: "ESTIMATE", расчёт: "ESTIMATE", расчет: "ESTIMATE", estimate: "ESTIMATE",
  прогноз: "FORECAST", forecast: "FORECAST",
};

export function parseMonth(v: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{1,2})$/.exec(v.trim()) ?? /^(\d{1,2})\.(\d{4})$/.exec(v.trim());
  if (!m) throw new AppError(`Неверный формат месяца «${v}». Используйте ГГГГ-ММ или ММ.ГГГГ`);
  const [y, mo] = v.includes("-") ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
  if (mo < 1 || mo > 12) throw new AppError(`Неверный месяц «${v}»`);
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 1) - 1);
  return { start, end };
}

export function resolveMetricKey(v: string): MetricKey | null {
  const t = v.trim().toLowerCase();
  for (const [k, meta] of Object.entries(METRIC_META)) {
    if (k.toLowerCase() === t || meta.label.toLowerCase() === t) return k as MetricKey;
  }
  return null;
}

export async function listMetrics(ctx: OrgContext) {
  if (!ctx.can("metrics.view")) throw forbidden();
  return ctx.db.businessMetric.findMany({
    where: ctx.locationScope ? { OR: [{ locationId: null }, { locationId: { in: ctx.locationScope } }] } : {},
    orderBy: [{ periodStart: "desc" }, { key: "asc" }],
    include: { location: { select: { name: true } } },
    take: 500,
  });
}

export async function addMetric(
  ctx: OrgContext,
  input: { key: MetricKey; kind: "FACT" | "ESTIMATE" | "FORECAST"; month: string; value: number; locationId?: string | null; note?: string },
  source: "MANUAL" | "FILE_IMPORT" = "MANUAL",
) {
  if (!ctx.can("metrics.manage")) throw forbidden();
  if (!Number.isFinite(input.value)) throw new AppError("Значение должно быть числом");
  const meta = METRIC_META[input.key];
  if (meta.unit === "pct" && (input.value < -100 || input.value > 1000)) throw new AppError(`${meta.label}: значение в процентах вне допустимого диапазона`);
  if (meta.unit !== "pct" && input.value < 0 && input.key !== "IMPROVEMENT_ROI") throw new AppError(`${meta.label} не может быть отрицательным`);
  if (input.locationId) {
    const loc = await ctx.db.location.findFirst({ where: { id: input.locationId } });
    if (!loc) throw notFound("Точка не найдена");
    assertLocationInScope(ctx, input.locationId);
  } else if (ctx.locationScope) throw forbidden("Укажите свою точку");
  const { start, end } = parseMonth(input.month);
  const existing = await ctx.db.businessMetric.findFirst({
    where: { key: input.key, kind: input.kind, periodStart: start, locationId: input.locationId || null },
  });
  const data = { value: input.value, note: input.note || null, source, createdById: ctx.user.id };
  const row = existing
    ? await ctx.db.businessMetric.update({ where: { id: existing.id }, data })
    : await ctx.db.businessMetric.create({
        data: {
          organizationId: ctx.org.id,
          key: input.key,
          kind: input.kind,
          periodStart: start,
          periodEnd: end,
          locationId: input.locationId || null,
          ...data,
        },
      });
  return { row, updated: !!existing };
}

/**
 * Импорт CSV (разделитель «;» или «,»). Колонки: месяц; показатель; значение; тип (факт/оценка/прогноз).
 * Первая строка — заголовок. Числа допускаются с пробелами и запятой как десятичным разделителем.
 */
export async function importMetricsCsv(ctx: OrgContext, csv: string, locationId?: string | null) {
  if (!ctx.can("metrics.manage")) throw forbidden();
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new AppError("Файл пуст: нужен заголовок и хотя бы одна строка данных");
  if (lines.length > 5001) throw new AppError("Не более 5000 строк за один импорт");
  const sep = lines[0].includes(";") ? ";" : ",";
  let imported = 0;
  const errors: string[] = [];
  for (const [i, line] of lines.slice(1).entries()) {
    const [month, keyRaw, valueRaw, kindRaw = "факт"] = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    try {
      const key = resolveMetricKey(keyRaw ?? "");
      if (!key) throw new AppError(`неизвестный показатель «${keyRaw}»`);
      const kind = KIND_ALIASES[kindRaw.toLowerCase()];
      if (!kind) throw new AppError(`неизвестный тип «${kindRaw}»`);
      const value = Number((valueRaw ?? "").replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(value)) throw new AppError(`значение «${valueRaw}» не число`);
      await addMetric(ctx, { key, kind, month: month ?? "", value, locationId }, "FILE_IMPORT");
      imported++;
    } catch (e) {
      errors.push(`Строка ${i + 2}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "metrics.import", "BusinessMetric", null, { imported, errors: errors.length });
  return { imported, errors };
}

export async function deleteMetric(ctx: OrgContext, id: string) {
  if (!ctx.can("metrics.manage")) throw forbidden();
  const m = await ctx.db.businessMetric.findFirst({ where: { id } });
  if (!m) throw notFound();
  if (m.locationId) assertLocationInScope(ctx, m.locationId);
  await ctx.db.businessMetric.delete({ where: { id } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "metrics.delete", "BusinessMetric", id);
}
