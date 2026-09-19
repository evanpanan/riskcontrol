"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn, formatCurrency, formatPercent, formatCompactNumber } from "@/lib/utils";
import { type LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

export interface KPICardProps {
  title: string;
  value: number;
  subtitle?: string;
  icon: LucideIcon;
  iconVariant?: "primary" | "success" | "warning" | "danger" | "secondary";
  trend?: {
    value: number;
    label?: string;
    formatter?: "currency" | "percent" | "number";
  };
  formatter?: "currency" | "percent" | "number";
  footer?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

const iconVariants = {
  primary: "bg-primary/15 text-primary border-primary/20",
  success: "bg-success/15 text-success border-success/20",
  warning: "bg-warning/15 text-warning border-warning/20",
  danger: "bg-danger/15 text-danger border-danger/20",
  secondary: "bg-secondary text-secondary-foreground border-transparent",
};

export function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconVariant = "primary",
  trend,
  formatter = "currency",
  footer,
  className,
  compact = false,
}: KPICardProps) {
  const formatValue = (v: number) => {
    switch (formatter) {
      case "currency":
        return formatCurrency(v);
      case "percent":
        return formatPercent(v);
      case "number":
        return formatCompactNumber(v);
      default:
        return v.toLocaleString();
    }
  };

  const formatTrendValue = (v: number, fmt?: "currency" | "percent" | "number") => {
    const f = fmt ?? (formatter === "percent" ? "currency" : formatter);
    if (f === "percent") return formatPercent(v);
    if (f === "number") return formatCompactNumber(v);
    const sign = v >= 0 ? "+" : "";
    return `${sign}${formatCompactNumber(Math.abs(v))}`;
  };

  return (
    <Card className={cn("overflow-hidden border-border/50", className)}>
      <CardContent className={cn(compact ? "p-3.5" : "p-5")}>
        <div className={cn("flex items-start justify-between", compact ? "mb-2" : "mb-4")}>
          <div className="space-y-0.5 min-w-0 flex-1">
            <p className={cn("text-muted-foreground tracking-wide uppercase truncate", compact ? "text-[10px] font-medium" : "text-xs font-medium")}>
              {title}
            </p>
            {subtitle && (
              <p className="text-[10px] text-muted-foreground/70 truncate">
                {subtitle}
              </p>
            )}
          </div>
          <div
            className={cn(
              "rounded-xl border flex items-center justify-center shrink-0 ml-3",
              compact ? "h-8 w-8" : "h-10 w-10",
              iconVariants[iconVariant]
            )}
          >
            <Icon className={cn(compact ? "h-4 w-4" : "h-5 w-5")} />
          </div>
        </div>

        <div className={cn("flex items-baseline gap-2 min-w-0", compact ? "mb-2" : "mb-3")}>
          <h3
            className={cn(
              "font-bold tracking-tight truncate",
              compact ? "text-xl" : "text-2xl",
              formatter === "percent" && value < 0 && "text-danger",
              formatter === "percent" && value > 0 && "text-success"
            )}
          >
            {formatValue(value)}
          </h3>
          {trend !== undefined && (
            <div
              className={cn(
                "flex items-center gap-0.5 font-semibold shrink-0",
                compact ? "text-[10.5px]" : "text-xs",
                trend.value >= 0 ? "text-success" : "text-danger"
              )}
            >
              {trend.value >= 0 ? (
                <TrendingUp className={cn(compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
              ) : (
                <TrendingDown className={cn(compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
              )}
              <span>{formatTrendValue(trend.value, trend.formatter)}</span>
              {trend.label && (
                <span className="text-muted-foreground font-normal ml-0.5">
                  {trend.label}
                </span>
              )}
            </div>
          )}
        </div>

        {footer && (
          <div className={cn("border-t border-border/40", compact ? "pt-2 mt-2" : "pt-3 mt-3")}>
            {footer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
