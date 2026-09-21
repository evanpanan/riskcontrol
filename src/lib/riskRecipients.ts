"use client";

export interface RiskRecipient {
  id: string;
  name: string;
  role: "RISK_MANAGER" | "RISK_ANALYST" | "RISK_DIRECTOR" | "BD_MANAGER" | "OPERATIONS" | "DIRECTOR" | "CUSTOM";
  email: string;
  whatsapp?: string;
  enabled: boolean;
}
export type RiskRole = RiskRecipient["role"];
export const DEFAULT_RISK_RECIPIENTS: RiskRecipient[] = [];
const KEY = "risk_control_recipients";
let globalRecipients: RiskRecipient[] = [];

export function getRiskRecipients(): RiskRecipient[] {
  if (typeof window !== "undefined") {
    try {
      const saved = JSON.parse(window.localStorage.getItem(KEY) || "[]");
      if (Array.isArray(saved)) globalRecipients = saved.filter((r) =>
        r && typeof r.name === "string" && typeof r.email === "string").map((r) => ({
          ...r, name: r.name.replace(/BD\s*经理/g, "商务经理"),
          // Retire bundled sample addresses, including copies persisted by old versions.
          enabled: !!r.enabled && !/@(?:institution\.com|bd-team\.com|example\.com)$/i.test(r.email),
        }));
    } catch { return []; }
  }
  return globalRecipients;
}
export function setRiskRecipients(recipients: RiskRecipient[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(recipients));
  globalRecipients = [...recipients];
}
export function getEnabledRecipientEmails(roles?: RiskRole[] | string[], extra: string[] = []): string[] {
  return [...new Set([...getRiskRecipients().filter((r) => r.enabled &&
    (!roles || roles.includes(r.role))).map((r) => r.email), ...extra].filter(Boolean))];
}
export function getEnabledRecipientWhatsApps(roles?: RiskRole[] | string[], extra: string[] = []): string[] {
  return [...new Set([...getRiskRecipients().filter((r) => r.enabled && r.whatsapp &&
    (!roles || roles.includes(r.role))).map((r) => r.whatsapp!), ...extra].filter(Boolean))];
}
