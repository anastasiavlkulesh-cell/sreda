/**
 * Защита анонимности.
 * — Индивидуальные анонимные ответы не показываются никому (включая собственника).
 * — Агрегаты по группе показываются, только если в группе не меньше K ответов.
 * — Открытые комментарии показываются только при группе ≥ K, без дат и в
 *   перемешанном порядке, из текста удаляются телефоны, e-mail и упоминания @.
 */
export const DEFAULT_MIN_GROUP_SIZE = 5;

export function canDisclose(groupSize: number, k = DEFAULT_MIN_GROUP_SIZE): boolean {
  return groupSize >= k;
}

export interface GroupAggregate {
  group: string;
  n: number;
  /** null — скрыто из-за малого размера группы */
  mean: number | null;
  hidden: boolean;
}

export function aggregateGroups(
  groups: Map<string, number[]>,
  k = DEFAULT_MIN_GROUP_SIZE,
): GroupAggregate[] {
  const out: GroupAggregate[] = [];
  for (const [group, values] of groups) {
    const n = values.length;
    if (!canDisclose(n, k)) out.push({ group, n, mean: null, hidden: true });
    else out.push({ group, n, mean: Math.round((values.reduce((a, b) => a + b, 0) / n) * 100) / 100, hidden: false });
  }
  return out;
}

/**
 * Защита от вычитания: зная общий результат и открытые группы, можно
 * вычислить совокупный результат скрытых групп. Поэтому скрытые группы в
 * сумме должны содержать не меньше K ответов; если меньше — скрывается
 * самая маленькая из открытых групп, пока условие не выполнится.
 */
export function protectAgainstDifferencing(aggs: GroupAggregate[], k = DEFAULT_MIN_GROUP_SIZE): GroupAggregate[] {
  const out = aggs.map((a) => ({ ...a }));
  const hiddenN = () => out.filter((a) => a.hidden).reduce((s, a) => s + a.n, 0);
  while (hiddenN() > 0 && hiddenN() < k) {
    const visible = out.filter((a) => !a.hidden).sort((a, b) => a.n - b.n);
    if (visible.length === 0) break;
    visible[0].hidden = true;
    visible[0].mean = null;
  }
  return out;
}

const PII_PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail скрыт]"],
  [/(\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, "[телефон скрыт]"],
  [/@[A-Za-z0-9_]{3,}/g, "[ник скрыт]"],
];

export function scrubPII(text: string): string {
  let t = text;
  for (const [re, rep] of PII_PATTERNS) t = t.replace(re, rep);
  return t;
}

/** Детерминированное перемешивание (порядок не совпадает с порядком отправки). */
export function shuffleStable<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** groupSize — число респондентов в группе (не число комментариев). */
export function disclosableComments(
  comments: string[],
  groupSize: number,
  k = DEFAULT_MIN_GROUP_SIZE,
  seed = "sreda",
): string[] | null {
  if (!canDisclose(groupSize, k)) return null;
  return shuffleStable(
    comments.map((c) => scrubPII(c.trim())).filter((c) => c.length > 0),
    seed,
  );
}
