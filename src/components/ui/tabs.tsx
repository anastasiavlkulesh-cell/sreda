import Link from "next/link";
import { cn } from "@/lib/utils";

export function LinkTabs({ tabs, active, base }: { tabs: { key: string; label: string }[]; active: string; base: string }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-white p-1" aria-label="Разделы">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}?tab=${t.key}`}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
            t.key === active ? "bg-navy-900 text-white" : "text-muted hover:bg-lavender-50 hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
