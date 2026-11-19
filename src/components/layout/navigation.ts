import { LayoutDashboard, AlertTriangle, ScrollText, History, Users, LineChart, Settings, Landmark } from "lucide-react";
import { hasInstitutionView, isBDManager } from "@/lib/auth";
import type { AppSessionUser } from "@/types/auth";

type NavRoleScope = "all" | "institution" | "bd";

type NavItem = {
  title: string;
  icon: any;
  href: string;
  description?: string;
  badge?: { text: string; variant: "primary" | "danger" | "warning" | "success" | "secondary" | "outline" };
  scope: NavRoleScope;
};

export const NAV_ITEMS: NavItem[] = [
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
    title: "批次&客户管理",
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

export const SECONDARY_NAV: NavItem[] = [
  {
    title: "系统设置",
    icon: Settings,
    href: "/settings",
    scope: "institution",
  },
];

export function isNavVisible(item: NavItem, user: AppSessionUser | null): boolean {
  if (item.scope === "all") return true;
  if (item.scope === "institution") return hasInstitutionView(user);
  if (item.scope === "bd") return isBDManager(user);
  return true;
}

