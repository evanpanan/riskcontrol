/**
 * Phase 5: 多档风控阈值系统
 *
 * 从固定 2 档（预警 15% / 击穿 20%）扩展为可配置的多档阈值。
 * 每档独立设置：跌幅%、通知渠道、通知对象、触发动作、颜色标识。
 *
 * 约束：不修改 riskEngine.ts 核心计算（结算、PnL、补仓分摊），
 * 仅在此模块提供档位配置和触发判断，供 UI 层和通知层使用。
 */

import { readSharedSetting, writeSharedSetting } from "./settingsStore";

/** 通知渠道 */
export type NotifyChannel = "email" | "whatsapp" | "sms";

/** 通知对象 */
export type NotifyTarget = "risk" | "bd" | "all";

/** 触发动作 */
export type TriggerAction = "notify" | "margin_call" | "liquidation";

/** 单一风控档位 */
export interface RiskTier {
  /** 唯一标识 */
  id: string;
  /** 档位名称，如 "关注线" / "预警线" / "击穿线" / "强平线" */
  name: string;
  /** 档位级别，数字越大越严重（1=最轻） */
  level: number;
  /** 触发跌幅百分比，如 10 表示 10% */
  dropPercent: number;
  /** 通知渠道 */
  notifyChannels: NotifyChannel[];
  /** 通知对象 */
  notifyTargets: NotifyTarget[];
  /** 触发动作 */
  action: TriggerAction;
  /** UI 颜色（Tailwind 类名后缀，如 "warning" / "danger" / "success"） */
  color: string;
  /** 是否启用 */
  enabled: boolean;
}

const TIERS_LS_KEY = "risk_control_risk_tiers";

/**
 * 默认 4 档风控阈值（Phase 5.2 建议方案）：
 * ① 10% 关注线：仅邮件通知风控
 * ② 15% 预警线：邮件+WhatsApp 通知风控+BD，黄色弹窗
 * ③ 20% 击穿线：全员通知 + 自动生成补仓指令，红色弹窗+蜂鸣
 * ④ 25% 强平线：触发券商强平预案
 */
export const DEFAULT_RISK_TIERS: RiskTier[] = [
  {
    id: "tier_attention",
    name: "关注线",
    level: 1,
    dropPercent: 10,
    notifyChannels: ["email"],
    notifyTargets: ["risk"],
    action: "notify",
    color: "info",
    enabled: true,
  },
  {
    id: "tier_warning",
    name: "预警线",
    level: 2,
    dropPercent: 15,
    notifyChannels: ["email", "whatsapp"],
    notifyTargets: ["risk", "bd"],
    action: "notify",
    color: "warning",
    enabled: true,
  },
  {
    id: "tier_critical",
    name: "击穿线",
    level: 3,
    dropPercent: 20,
    notifyChannels: ["email", "whatsapp", "sms"],
    notifyTargets: ["all"],
    action: "margin_call",
    color: "danger",
    enabled: true,
  },
  {
    id: "tier_liquidation",
    name: "强平线",
    level: 4,
    dropPercent: 25,
    notifyChannels: ["email", "whatsapp", "sms"],
    notifyTargets: ["all"],
    action: "liquidation",
    color: "destructive",
    enabled: true,
  },
];

/** 校验档位配置合法性 */
export function validateRiskTiers(tiers: RiskTier[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!tiers || tiers.length === 0) {
    errors.push("至少需要配置一个风控档位");
    return { valid: false, errors };
  }
  const enabled = tiers.filter((t) => t.enabled);
  if (enabled.length === 0) {
    errors.push("至少需要启用一个风控档位");
  }
  for (const t of tiers) {
    if (!t.name?.trim()) errors.push(`档位 ${t.id} 名称不能为空`);
    if (!Number.isFinite(t.dropPercent) || t.dropPercent <= 0 || t.dropPercent > 100) {
      errors.push(`档位「${t.name}」跌幅须在 0~100% 之间`);
    }
    if (!Number.isFinite(t.level) || t.level < 1) {
      errors.push(`档位「${t.name}」级别须为正整数`);
    }
  }
  // 跌幅必须严格递增
  const sorted = [...enabled].sort((a, b) => a.dropPercent - b.dropPercent);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].dropPercent <= sorted[i - 1].dropPercent) {
      errors.push(`启用档位的跌幅须严格递增（${sorted[i - 1].name} ${sorted[i - 1].dropPercent}% ≥ ${sorted[i].name} ${sorted[i].dropPercent}%）`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** 读取存储的档位配置，失败则返回默认值 */
export function getStoredRiskTiers(): RiskTier[] {
  if (typeof window === "undefined") return [...DEFAULT_RISK_TIERS];
  try {
    const raw = readSharedSetting(TIERS_LS_KEY);
    if (!raw) return [...DEFAULT_RISK_TIERS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_RISK_TIERS];
    // 合并默认值，补齐缺失字段
    const merged: RiskTier[] = parsed.map((t: Partial<RiskTier>) => ({
      id: t.id ?? `tier_${Math.random().toString(36).slice(2, 8)}`,
      name: t.name ?? "未命名档位",
      level: Number(t.level ?? 1),
      dropPercent: Number(t.dropPercent ?? 20),
      notifyChannels: Array.isArray(t.notifyChannels) ? t.notifyChannels as NotifyChannel[] : ["email"],
      notifyTargets: Array.isArray(t.notifyTargets) ? t.notifyTargets as NotifyTarget[] : ["risk"],
      action: (t.action as TriggerAction) ?? "notify",
      color: t.color ?? "warning",
      enabled: t.enabled !== false,
    }));
    const { valid } = validateRiskTiers(merged);
    return valid ? merged : [...DEFAULT_RISK_TIERS];
  } catch {
    return [...DEFAULT_RISK_TIERS];
  }
}

/** 保存档位配置（多端共享） */
export function saveRiskTiers(tiers: RiskTier[]): boolean {
  const { valid, errors } = validateRiskTiers(tiers);
  if (!valid) {
    console.error("[riskTiers] 保存失败:", errors);
    return false;
  }
  try {
    writeSharedSetting(TIERS_LS_KEY, JSON.stringify(tiers));
    window.dispatchEvent(new CustomEvent("risk-control:tiers-updated"));
    return true;
  } catch {
    return false;
  }
}

/** 重置为默认档位 */
export function resetRiskTiers(): RiskTier[] {
  saveRiskTiers([...DEFAULT_RISK_TIERS]);
  return [...DEFAULT_RISK_TIERS];
}

/**
 * 根据当前跌幅返回触发的最高档位（level 最大的已启用档位）。
 * @param dropPercent 当前跌幅百分比（如 12.5 表示 12.5%）
 * @param tiers 档位配置，默认从 localStorage 读取
 * @returns 触发的档位，若无则返回 null（NORMAL）
 */
export function getActiveRiskTier(
  dropPercent: number,
  tiers: RiskTier[] = getStoredRiskTiers()
): RiskTier | null {
  if (!Number.isFinite(dropPercent) || dropPercent <= 0) return null;
  const enabled = tiers.filter((t) => t.enabled).sort((a, b) => b.level - a.level);
  for (const t of enabled) {
    if (dropPercent + Number.EPSILON >= t.dropPercent - 1e-8) {
      return t;
    }
  }
  return null;
}

/** 获取所有已触发的档位（按 level 升序） */
export function getTriggeredTiers(
  dropPercent: number,
  tiers: RiskTier[] = getStoredRiskTiers()
): RiskTier[] {
  if (!Number.isFinite(dropPercent) || dropPercent <= 0) return [];
  return tiers
    .filter((t) => t.enabled && dropPercent + Number.EPSILON >= t.dropPercent - 1e-8)
    .sort((a, b) => a.level - b.level);
}

/** 距离下一档位的剩余跌幅百分比 */
export function getNextTierGap(
  dropPercent: number,
  tiers: RiskTier[] = getStoredRiskTiers()
): { tier: RiskTier; gap: number } | null {
  if (!Number.isFinite(dropPercent)) return null;
  const next = tiers
    .filter((t) => t.enabled && t.dropPercent > dropPercent)
    .sort((a, b) => a.dropPercent - b.dropPercent)[0];
  if (!next) return null;
  return { tier: next, gap: Math.max(0, next.dropPercent - dropPercent) };
}
