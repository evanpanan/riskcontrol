"use client";

export interface RiskRecipient {
  id: string;
  name: string;
  role: "RISK_MANAGER" | "RISK_ANALYST" | "RISK_DIRECTOR" | "BD_MANAGER" | "OPERATIONS" | "DIRECTOR" | "CUSTOM";
  email: string;
  whatsapp?: string;
  enabled: boolean;
}

export const DEFAULT_RISK_RECIPIENTS: RiskRecipient[] = [
  {
    id: "r1",
    name: "风控总监 - Evan Pan",
    role: "RISK_MANAGER",
    email: "evan.pan@institution.com",
    whatsapp: "+852-9123-4567",
    enabled: true,
  },
  {
    id: "r2",
    name: "风控主管 - Michael Chen",
    role: "RISK_MANAGER",
    email: "michael.chen@institution.com",
    whatsapp: "+852-6234-5678",
    enabled: true,
  },
  {
    id: "r3",
    name: "风控分析师 - Sarah Wu",
    role: "RISK_MANAGER",
    email: "sarah.wu@institution.com",
    enabled: true,
  },
  {
    id: "r4",
    name: "BD经理 - 李晓明 (Evan Li)",
    role: "BD_MANAGER",
    email: "evan.li@bd-team.com",
    whatsapp: "+86-138-0000-0001",
    enabled: true,
  },
  {
    id: "r5",
    name: "BD经理 - 王思远 (Sylvia Wang)",
    role: "BD_MANAGER",
    email: "sylvia.wang@bd-team.com",
    whatsapp: "+86-139-0000-0002",
    enabled: true,
  },
  {
    id: "r6",
    name: "BD经理 - 张志强 (Jack Zhang)",
    role: "BD_MANAGER",
    email: "jack.zhang@bd-team.com",
    whatsapp: "+86-137-0000-0003",
    enabled: true,
  },
  {
    id: "r7",
    name: "BD经理 - 刘佳 (Jennifer Liu)",
    role: "BD_MANAGER",
    email: "jennifer.liu@bd-team.com",
    whatsapp: "+86-136-0000-0004",
    enabled: true,
  },
  {
    id: "r8",
    name: "运营总监 - David Zhao",
    role: "OPERATIONS",
    email: "david.zhao@institution.com",
    enabled: true,
  },
];

let globalRecipients = [...DEFAULT_RISK_RECIPIENTS];

export function getRiskRecipients(): RiskRecipient[] {
  return globalRecipients;
}

export function setRiskRecipients(recipients: RiskRecipient[]) {
  globalRecipients = [...recipients];
}

export type RiskRole = RiskRecipient["role"];

export function getEnabledRecipientEmails(
  roles?: RiskRole[] | string[],
  extraBDEmails?: string[]
): string[] {
  const emails = globalRecipients
    .filter((r) => r.enabled)
    .filter((r) => !roles || (roles as string[]).includes(r.role))
    .map((r) => r.email);
  return [...new Set([...emails, ...(extraBDEmails || [])])];
}

export function getEnabledRecipientWhatsApps(
  roles?: RiskRole[] | string[],
  extraNumbers?: string[]
): string[] {
  const numbers = globalRecipients
    .filter((r) => r.enabled && r.whatsapp)
    .filter((r) => !roles || (roles as string[]).includes(r.role))
    .map((r) => r.whatsapp as string);
  return [...new Set([...numbers, ...(extraNumbers || [])])];
}
