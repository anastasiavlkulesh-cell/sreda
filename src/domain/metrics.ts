/**
 * Бизнес-показатели как источник SERVICE 5D.
 * Из фактических (FACT) данных выводятся оценки 1–5 для критериев
 * B1 «Динамика выручки» и B2 «Повторные продажи». Оценки и прогнозы
 * (ESTIMATE, FORECAST) в расчёт не берутся. Пороги — стартовые, калибруются.
 */
export const METRIC_DERIVED_CRITERIA = ["B1", "B2"];

export type MetricKey =
  | "REVENUE" | "AVERAGE_CHECK" | "CUSTOMERS" | "REPEAT_SALES" | "CONVERSION" | "LTV" | "CAC"
  | "MARGIN" | "RETENTION_COST" | "ERROR_COST" | "IMPROVEMENT_ROI";

export const METRIC_META: Record<MetricKey, { label: string; unit: "rub" | "pct" | "count"; hint: string }> = {
  REVENUE: { label: "Выручка", unit: "rub", hint: "За период, ₽" },
  AVERAGE_CHECK: { label: "Средний чек", unit: "rub", hint: "₽" },
  CUSTOMERS: { label: "Количество клиентов", unit: "count", hint: "Уникальных за период" },
  REPEAT_SALES: { label: "Повторные продажи", unit: "pct", hint: "Доля выручки или клиентов, %" },
  CONVERSION: { label: "Конверсия", unit: "pct", hint: "%" },
  LTV: { label: "LTV", unit: "rub", hint: "Пожизненная ценность клиента, ₽" },
  CAC: { label: "CAC", unit: "rub", hint: "Стоимость привлечения клиента, ₽" },
  MARGIN: { label: "Маржинальность", unit: "pct", hint: "%" },
  RETENTION_COST: { label: "Стоимость удержания", unit: "rub", hint: "₽ за период" },
  ERROR_COST: { label: "Стоимость ошибок", unit: "rub", hint: "Списания, переделки, возвраты, ₽" },
  IMPROVEMENT_ROI: { label: "ROI улучшений", unit: "pct", hint: "Расчётная оценка, %" },
};

export const VALUE_KIND_LABELS = { FACT: "Факт", ESTIMATE: "Расчётная оценка", FORECAST: "Прогноз" } as const;

export interface MetricPoint {
  key: MetricKey;
  kind: "FACT" | "ESTIMATE" | "FORECAST";
  periodStart: Date;
  value: number;
}

function monthKey(d: Date) {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Изменение выручки за последние 3 месяца к тем же месяцам год назад (или к предыдущим 3 месяцам). */
export function revenueChange(points: MetricPoint[]): { change: number; basis: "yoy" | "qoq" } | null {
  const rev = points.filter((p) => p.key === "REVENUE" && p.kind === "FACT");
  if (rev.length < 4) return null;
  const byMonth = new Map<number, number>();
  for (const p of rev) byMonth.set(monthKey(p.periodStart), (byMonth.get(monthKey(p.periodStart)) ?? 0) + p.value);
  const last = Math.max(...byMonth.keys());
  const sum = (from: number) => {
    let s = 0;
    for (let m = from; m > from - 3; m--) {
      const v = byMonth.get(m);
      if (v === undefined) return null;
      s += v;
    }
    return s;
  };
  const recent = sum(last);
  if (recent === null) return null;
  const yoy = sum(last - 12);
  if (yoy && yoy > 0) return { change: (recent - yoy) / yoy, basis: "yoy" };
  const qoq = sum(last - 3);
  if (qoq && qoq > 0) return { change: (recent - qoq) / qoq, basis: "qoq" };
  return null;
}

export function scoreRevenueChange(change: number): number {
  if (change >= 0.1) return 5;
  if (change >= 0.03) return 4;
  if (change >= -0.03) return 3;
  if (change >= -0.1) return 2;
  return 1;
}

export function scoreRepeatShare(pct: number): number {
  if (pct >= 50) return 5;
  if (pct >= 35) return 4;
  if (pct >= 20) return 3;
  if (pct >= 10) return 2;
  return 1;
}

/** Оценки 1–5 по критериям, выводимые из фактических показателей. */
export function metricDerivedScores(points: MetricPoint[]): Map<string, { score: number; explanation: string }> {
  const out = new Map<string, { score: number; explanation: string }>();
  const rc = revenueChange(points);
  if (rc) {
    const pct = Math.round(rc.change * 1000) / 10;
    out.set("B1", {
      score: scoreRevenueChange(rc.change),
      explanation: `Выручка за 3 последних месяца ${pct >= 0 ? "+" : ""}${pct}% ${rc.basis === "yoy" ? "к тем же месяцам прошлого года" : "к предыдущим 3 месяцам"} (факт).`,
    });
  }
  const repeat = points
    .filter((p) => p.key === "REPEAT_SALES" && p.kind === "FACT")
    .sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime())
    .slice(0, 3);
  if (repeat.length) {
    const avg = repeat.reduce((a, p) => a + p.value, 0) / repeat.length;
    out.set("B2", {
      score: scoreRepeatShare(avg),
      explanation: `Доля повторных продаж в среднем ${Math.round(avg)}% за последние ${repeat.length} мес. (факт).`,
    });
  }
  return out;
}
