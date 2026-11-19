import * as React from "react";
import { AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Progress({ value, className, tone = "lavender" }: { value: number; className?: string; tone?: "lavender" | "peach" | "good" }) {
  const v = Math.max(0, Math.min(100, value));
  const color = tone === "peach" ? "bg-peach-400" : tone === "good" ? "bg-level-good" : "bg-lavender-500";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-lavender-100", className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "success" | "critical"; title?: string; children?: React.ReactNode; className?: string }) {
  const styles = {
    info: "bg-lavender-50 border-lavender-200 text-navy-800",
    warning: "bg-peach-100 border-peach-200 text-navy-800",
    success: "bg-level-good/10 border-level-good/30 text-navy-800",
    critical: "bg-level-critical/8 border-level-critical/30 text-navy-800",
  }[tone];
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <div role={tone === "critical" ? "alert" : "status"} className={cn("flex gap-3 rounded-2xl border p-4 text-sm", styles, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-navy-700">{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-white/60 px-6 py-10 text-center", className)}>
      {icon && <div className="flex size-12 items-center justify-center rounded-2xl bg-lavender-50 text-lavender-600">{icon}</div>}
      <div className="space-y-1">
        <p className="font-display font-bold">{title}</p>
        {description && <p className="mx-auto max-w-md text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, badge }: { title: string; description?: string; actions?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1>
          {badge}
        </div>
        {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-xs text-level-critical">{errors[0]}</p>;
}

export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="font-display text-2xl font-extrabold">{value}</p>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}
