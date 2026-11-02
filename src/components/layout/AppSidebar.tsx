"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FINANCE_STORE_KEY, getMockData, reloadMockData } from "@/lib/mockData";
import { calculatePortfolioSummary } from "@/lib/riskEngine";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  AlertTriangle,
  ScrollText,
  History,
  Users,
  LineChart,
  Settings,
  Building2,
  Shield,
  FlaskConical,
  Landmark,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Logo } from "@/components/branding/Logo";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { hasInstitutionView, isBDManager } from "@/lib/auth";

type NavRoleScope = "all" | "institution" | "bd";

const SIDEBAR_COLLAPSED_KEY = "risk_control_sidebar_collapsed_v1";

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
    title: "数据分析",
    icon: LineChart,
    href: "/market",
    description: "机构 & 风控多维图表",
    scope: "institution",
  },
  {
    title: "压力测试",
    icon: FlaskConical,
    href: "/stress-test",
    description: "情景模拟 & 补仓测算",
    scope: "institution",
  },
  {
    title: "WIN100 台账",
    icon: Landmark,
    href: "/win100-ledger",
    description: "担保品 · 收益 · 履约台账",
    scope: "institution",
  },
  {
    title: "操作记录",
    icon: ScrollText,
    href: "/operation-records",
    description: "全员操作留痕",
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
  const [summary, setSummary] = useState<ReturnType<typeof calculatePortfolioSummary> | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedReady, setCollapsedReady] = useState(false);
  const institution = hasInstitutionView(user);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      /* ignore */
    }
    setCollapsedReady(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    if (!institution) { setSummary(null); return; }
    const update = (reload = false) => {
      try { setSummary(calculatePortfolioSummary((reload ? reloadMockData() : getMockData()).batches)); }
      catch { setSummary(null); }
    };
    const onFinance = () => update();
    const onStorage = (event: StorageEvent) => {
      if (event.key === FINANCE_STORE_KEY || event.key === null) update(true);
    };
    update();
    window.addEventListener("risk-control:finance-changed", onFinance);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("risk-control:finance-changed", onFinance);
      window.removeEventListener("storage", onStorage);
    };
  }, [institution]);

  return (
    <aside
      className={cn(
        "hidden lg:flex shrink-0 flex-col border-r border-border/60 bg-card/50 backdrop-blur-sm",
        collapsedReady && "transition-[width] duration-300 ease-out",
        collapsed ? "w-[76px]" : "w-64"
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-3 border-b border-border/60 px-2 py-4">
          <Link href="/" className="relative block">
            <Logo size={32} />
            <div className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-success animate-pulse" />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCollapsed}
            title="展开侧边栏"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="relative border-b border-border/60 p-6">
          <Link href="/" className="group flex items-center gap-3 pr-7">
            <div className="relative">
              <Logo size={40} />
              <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-success border-2 border-card animate-pulse" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-base tracking-tight text-gradient-primary">
                RiskControl
              </span>
              <span className="text-[10px] text-muted-foreground tracking-wider">
                机构级股票风控平台
              </span>
            </div>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCollapsed}
            title="收起侧边栏"
            className="absolute right-3 top-5 h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
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
      )}

      <nav className={cn("flex-1 space-y-1 overflow-y-auto scrollbar-thin", collapsed ? "px-2 py-4" : "p-4")}>
        {collapsed ? (
          <div className="mx-auto mb-3 h-px w-8 bg-border/60" />
        ) : (
          <div className="mb-2 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            主控制台
          </div>
        )}
        {NAV_ITEMS.filter((item) => isNavVisible(item, user)).map((item) => {
          const isActive =
            (item.href === "/" && pathname === "/") ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;
          const alertCount = summary ? summary.criticalCount + summary.warningCount : 0;
          const showAlertBadge = !item.badge && item.href === "/alerts" && alertCount > 0;
          const badgeText = item.badge?.text ?? (showAlertBadge ? String(alertCount) : null);
          const badgeVariant = item.badge?.variant ?? "danger";

          const link = (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.title : undefined}
              className={cn(
                "group relative flex items-center rounded-lg text-sm font-medium transition-all duration-200",
                collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
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
              {!collapsed && (
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
              )}
              {!collapsed && badgeText && (
                <Badge variant={badgeVariant} className="ml-auto">
                  {badgeText}
                </Badge>
              )}
              {collapsed && badgeText && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger" />
              )}
            </Link>
          );

          if (!collapsed) return link;

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <p className="text-[11px] font-medium">{item.title}</p>
                {item.description && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{item.description}</p>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {collapsed ? (
          <div className="mx-auto mt-4 mb-3 h-px w-8 bg-border/60" />
        ) : (
          <div className="mt-6 mb-2 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            系统
          </div>
        )}
        {SECONDARY_NAV.filter((item) => isNavVisible(item, user)).map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          const link = (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.title : undefined}
              className={cn(
                "group flex items-center rounded-lg text-sm font-medium transition-all",
                collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
                isActive
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.title}</span>}
            </Link>
          );

          if (!collapsed) return link;

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {item.title}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {collapsed ? null : !isBD ? (
        <div className="p-4 border-t border-border/60">
          <div className="rounded-xl p-4 gradient-card border border-border/60">
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold">WIN100 担保资金池</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">WIN100 累计补仓</span>
                <span className="text-xs font-bold text-warning tabular-nums">{summary ? formatCurrency(summary.totalMarginCalls) : "--"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">在管资产总额</span>
                <span className="text-xs font-bold text-success tabular-nums">{summary ? formatCurrency(summary.totalAUM) : "--"}</span>
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
