import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-lavender-500 text-white hover:bg-lavender-600 shadow-sm shadow-lavender-500/20",
        secondary: "bg-white text-ink border border-line hover:bg-lavender-50",
        accent: "bg-peach-400 text-navy-900 hover:bg-peach-600 hover:text-white",
        ghost: "text-ink hover:bg-lavender-50",
        danger: "bg-white text-level-critical border border-level-critical/30 hover:bg-level-critical/5",
        link: "text-lavender-600 underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
