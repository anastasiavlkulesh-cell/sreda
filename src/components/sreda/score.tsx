import { scoreLevel } from "@/domain/ssi";
import { CONFIDENCE_LABELS, FINDING_LABELS, type Confidence, type FindingStatus } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const LEVEL_VARIANT = { critical: "critical", low: "warning", basic: "basic", good: "good", high: "good" } as const;
const LEVEL_COLOR = {
  critical: "var(--color-level-critical)",
  low: "var(--color-level-low)",
  basic: "var(--color-level-basic)",
  good: "var(--color-level-good)",
  high: "var(--color-level-high)",
} as const;

export function levelColor(score: number) {
  return LEVEL_COLOR[scoreLevel(score).key as keyof typeof LEVEL_COLOR];
}

export function LevelBadge({ score }: { score: number | null }) {
  if (score === null) return <Badge variant="outline">Нет данных</Badge>;
  const l = scoreLevel(score);
  return <Badge variant={LEVEL_VARIANT[l.key as keyof typeof LEVEL_VARIANT]}>{l.label}</Badge>;
}

export function ConfidenceBadge({ value }: { value: Confidence }) {
  const v = { HIGH: "good", MEDIUM: "lavender", LOW: "warning", INSUFFICIENT: "outline" } as const;
  return <Badge variant={v[value]} title="Достоверность оценки">Достоверность: {CONFIDENCE_LABELS[value].toLowerCase()}</Badge>;
}

export function FindingBadge({ value }: { value: FindingStatus }) {
  const v = { CONFIRMED: "good", PARTIALLY_CONFIRMED: "lavender", HYPOTHESIS: "peach" } as const;
  return <Badge variant={v[value]}>{FINDING_LABELS[value]}</Badge>;
}

export function PriorityBadge({ value }: { value: "P1" | "P2" | "P3" | "P4" }) {
  const v = { P1: "critical", P2: "warning", P3: "basic", P4: "neutral" } as const;
  return <Badge variant={v[value]}>{value}</Badge>;
}

export function ScoreRing({ score, size = 132, label }: { score: number | null; size?: number; label?: string }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : score / 100;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-lavender-100)" strokeWidth="12" fill="none" />
        {score !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} stroke={levelColor(score)} strokeWidth="12" fill="none" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} />
        )}
      </svg>
      <div className="absolute text-center">
        <p className={cn("font-display font-extrabold leading-none", score === null ? "text-xl text-muted" : "text-4xl")}>
          {score === null ? "н/д" : Math.round(score)}
        </p>
        {label && <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>}
      </div>
    </div>
  );
}

export function Delta({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || before === null) return null;
  const d = Math.round((now - before) * 10) / 10;
  if (d === 0) return <span className="text-xs text-muted">без изменений</span>;
  return (
    <span className={cn("text-xs font-semibold", d > 0 ? "text-level-high" : "text-level-critical")}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d)} к прошлой диагностике
    </span>
  );
}
