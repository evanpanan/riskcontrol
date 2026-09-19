"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  AlertTriangle,
  History,
  Users,
  LineChart,
  Settings,
  ShieldAlert,
  Building2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const NAV_ITEMS = [
  {
    title: "风控大盘",
    icon: LayoutDashboard,
    href: "/",
    description: "全局概览 & 批次看板",
  },
  {
    title: "风险警报中心",
    icon: AlertTriangle,
    href: "/alerts",
    badge: { text: "3", variant: "danger" as const },
    description: "补仓预警 & 通知日志",
  },
  {
    title: "补仓历史",
    icon: History,
    href: "/margin-calls",
    description: "补仓记录 & 执行跟踪",
  },
  {
    title: "客户管理",
    icon: Users,
    href: "/clients",
    description: "客户名录 & BD 分配",
  },
  {
    title: "行情分析",
    icon: LineChart,
    href: "/market",
    description: "股票行情 & 波动监控",
  },
];

const SECONDARY_NAV = [
  {
    title: "系统设置",
    icon: Settings,
    href: "/settings",
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border/60 bg-card/50 backdrop-blur-sm">
      <div className="p-6 border-b border-border/60">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative">
            <div className="h-10 w-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/30">
              <ShieldAlert className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-success border-2 border-card animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-base tracking-tight text-gradient-primary">
              RiskControl
            </span>
            <span className="text-[10px] text-muted-foreground tracking-wider uppercase">
              v2.0 Professional
            </span>
          </div>
        </Link>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto scrollbar-thin">
        <div className="mb-2 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          主控制台
        </div>
        {NAV_ITEMS.map((item) => {
          const isActive =
            (item.href === "/" && pathname === "/") ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-primary shadow-sm"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-primary" />
              )}
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform group-hover:scale-110",
                  isActive && "text-primary"
                )}
              />
              <div className="flex flex-col flex-1 min-w-0">
                <span
                  className={cn(
                    isActive ? "text-primary font-semibold" : ""
                  )}
                >
                  {item.title}
                </span>
                <span className="text-[10px] text-muted-foreground truncate">
                  {item.description}
                </span>
              </div>
              {item.badge && (
                <Badge variant={item.badge.variant} className="ml-auto">
                  {item.badge.text}
                </Badge>
              )}
            </Link>
          );
        })}

        <div className="mt-6 mb-2 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          系统
        </div>
        {SECONDARY_NAV.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.title}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border/60">
        <div className="rounded-xl p-4 gradient-card border border-border/60">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold">机构资金池</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">机构累计补仓</span>
              <span className="text-sm font-bold text-warning">$2.45M</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">在管资产总额</span>
              <span className="text-sm font-bold text-success">$18.05M</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
