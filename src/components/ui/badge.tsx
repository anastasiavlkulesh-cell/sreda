import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", {
  variants: {
    variant: {
      neutral: "bg-navy-900/5 text-navy-700",
      lavender: "bg-lavender-100 text-lavender-700",
      peach: "bg-peach-100 text-peach-600",
      critical: "bg-level-critical/10 text-level-critical",
      warning: "bg-level-low/10 text-[#c2621f]",
      basic: "bg-level-basic/15 text-[#8a6a10]",
      good: "bg-level-good/12 text-level-high",
      demo: "bg-peach-400 text-navy-900",
      outline: "border border-line text-muted",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge variant="demo" className={className} title="Демонстрационные данные">
      Демо
    </Badge>
  );
}
