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
  Building2,
  Shield,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/branding/Logo";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { hasInstitutionView, isBDManager } from "@/lib/auth";

type NavRoleScope = "all" | "institution" | "bd";

type NavItem = {
  title: string;
  icon: any;
  href: string;
  description?: string;
  badge?: { text: string; variant: "primary" | "danger" | "warning" | "success" | "secondary" | "outline" };
  scope: NavRoleScope;
};

const NAV_ITEMS: NavItem[] = [
  {
    title: "风控大盘",
    icon: LayoutDashboard,
    href: "/",
    description: "全局概览 & 批次看板",
    scope: "all",
  },
  {
    title: "风险警报中心",
    icon: AlertTriangle,
    href: "/alerts",
    badge: { text: "3", variant: "danger" },
    description: "补仓预警 & 通知日志",
    scope: "institution",
  },
  {
    title: "补仓历史",
    icon: History,
    href: "/margin-calls",
    description: "补仓记录 & 执行跟踪",
    scope: "institution",
  },
  {
    title: "客户管理",
    icon: Users,
    href: "/clients",
    description: "客户名录 & 商务经理分配",
    scope: "all",
  },
  {
    title: "行情分析",
    icon: LineChart,
    href: "/market",
    description: "股票行情 & 波动监控",
    scope: "institution",
  },
];

const SECONDARY_NAV: NavItem[] = [
  {
    title: "系统设置",
    icon: Settings,
    href: "/settings",
    scope: "institution",
  },
];

function isNavVisible(item: NavItem, user: ReturnType<typeof useCurrentUser>["user"]): boolean {
  if (item.scope === "all") return true;
  if (item.scope === "institution") return hasInstitutionView(user);
  if (item.scope === "bd") return isBDManager(user);
  return true;
}

export function AppSidebar() {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const isBD = isBDManager(user);

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border/60 bg-card/50 backdrop-blur-sm">
      <div className="p-6 border-b border-border/60">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative">
            <Logo size={40} />
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
        {isBD && user && (
          <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 flex items-start gap-2">
            <Shield className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10.5px] font-semibold text-primary leading-tight">商务经理专属工作台</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                仅展示归属您的客户与批次数据
              </p>
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto scrollbar-thin">
        <div className="mb-2 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          主控制台
        </div>
        {NAV_ITEMS.filter((item) => isNavVisible(item, user)).map((item) => {
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
                {item.description && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    {item.description}
                  </span>
                )}
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
        {SECONDARY_NAV.filter((item) => isNavVisible(item, user)).map((item) => {
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

      {!isBD ? (
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
      ) : (
        <div className="p-4 border-t border-border/60">
          <div className="rounded-xl p-4 border border-border/50 bg-background/40">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-success" />
              <span className="text-xs font-semibold">我的在管客户</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              客户归属由 ADMIN / 风控总监 在「客户管理」中分配。
              如有数据范围变更，请联系机构管理员。
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
