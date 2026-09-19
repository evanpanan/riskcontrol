import * as React from "react";
import { cn } from "@/lib/utils";

const BadgeVariants = {
  default: "bg-primary/15 text-primary border-primary/30",
  primary: "bg-primary/15 text-primary border-primary/30",
  secondary: "bg-secondary text-secondary-foreground border-transparent",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  outline: "text-foreground border-input",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-danger/15 text-danger border-danger/30",
} as const;

export type BadgeVariant = keyof typeof BadgeVariants;

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        BadgeVariants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
