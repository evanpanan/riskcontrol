"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoleGate } from "@/components/auth/RoleGate";
import { APP_ROLES, ROLE_LABELS as APP_ROLE_LABELS } from "@/types/auth";
import { INSTITUTION_ROLES, useAuthContext } from "@/lib/auth";
import { hashCustomUserPassword } from "@/lib/auth/password";
import { logAudit, fetchAuditLogs, type AuditLogEntry, type AuditAction } from "@/lib/auth/audit";
import {
  AUDIT_ACTION_FILTER_OPTIONS,
  describeAuditLog,
  getAuditActionLabel,
  getAuditDetailFields,
  getAuditResourceLabel,
} from "@/lib/auth/auditDisplay";
import { toast } from "sonner";
import { getProfitSettings, validProfitSettings } from "@/lib/profitSettings";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Settings,
  Shield,
  Mail,
  MessageCircle,
  Building2,
  Bell,
  Database,
  Save,
  CheckCircle2,
  AlertTriangle,
  Info,
  RadioTower,
  Plus,
  Trash2,
  Edit3,
  UserPlus,
  Users,
  X,
  MonitorDot,
  Eye,
  ImagePlus,
  Palette,
  RotateCcw,
  Upload,
  Globe,
  Lock,
  LineChart,
  TrendingUp,
  TrendingDown,
  HelpCircle,
  ScrollText,
  Search,
  Filter,
  RefreshCw,
  Layers,
  Zap,
} from "lucide-react";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";
import { useState, useEffect, useMemo, useRef, useCallback, type ComponentProps } from "react";
import { Logo, getStoredLogo, setStoredLogo } from "@/components/branding/Logo";
import { ClientAvatar } from "@/components/branding/ClientAvatar";
import {
  DEFAULT_RISK_RECIPIENTS,
  RiskRecipient,
  getRiskRecipients,
  setRiskRecipients,
} from "@/lib/riskRecipients";
import { sendTestNotification, setNotificationSendToken, hasNotificationSendToken } from "@/lib/notifier";
import { clearAllBusinessData, getMockData, isLedgerEmpty } from "@/lib/mockData";
import {
  getStoredRiskTiers,
  saveRiskTiers,
  resetRiskTiers,
  validateRiskTiers,
  DEFAULT_RISK_TIERS,
  type RiskTier,
  type NotifyChannel,
  type NotifyTarget,
  type TriggerAction,
} from "@/lib/riskTiers";
import {
  getFlashCrashThresholds,
  saveFlashCrashThresholds,
  resetFlashCrashThresholds,
  DEFAULT_FLASH_CRASH_THRESHOLDS,
  type FlashCrashThreshold,
} from "@/lib/flashCrash";
import type { notificationReadiness } from "@/lib/server/notificationDelivery";
import {
  LIVE_QUOTE_SETTINGS_KEY,
  DEFAULT_LIVE_QUOTE,
  getLiveQuoteSettings,
  setLiveQuoteSettings,
  fetchQuoteBrowser,
  getNYSEInfo,
} from "@/lib/liveQuote";
import type { LiveQuoteSettings, BrowserQuote } from "@/lib/liveQuote";
import { QUOTE_PROVIDERS, quoteProviderLabel } from "@/lib/quote/providers";

const LS_KEY = "risk_control_settings";
const RECIPIENTS_LS_KEY = "risk_control_recipients";
const USERS_LS_KEY = "risk_control_users_v1";

type CountryCode = {
  code: string;
  label: string;
  country: string;
  isDefault?: boolean;
};

const COUNTRY_CODES: CountryCode[] = [
  { code: "+852", country: "HK", label: "🇭🇰 香港 Hong Kong", isDefault: true },
  { code: "+86",  country: "CN", label: "🇨🇳 中国大陆 China" },
  { code: "+65",  country: "SG", label: "🇸🇬 新加坡 Singapore" },
  { code: "+886", country: "TW", label: "🇹🇼 台湾 Taiwan" },
  { code: "+60",  country: "MY", label: "🇲🇾 马来西亚 Malaysia" },
  { code: "+66",  country: "TH", label: "🇹🇭 泰国 Thailand" },
  { code: "+81",  country: "JP", label: "🇯🇵 日本 Japan" },
  { code: "+82",  country: "KR", label: "🇰🇷 韩国 Korea" },
  { code: "+1",   country: "US", label: "🇺🇸 美国 United States" },
  { code: "+44",  country: "GB", label: "🇬🇧 英国 United Kingdom" },
  { code: "+61",  country: "AU", label: "🇦🇺 澳大利亚 Australia" },
  { code: "+49",  country: "DE", label: "🇩🇪 德国 Germany" },
  { code: "+33",  country: "FR", label: "🇫🇷 法国 France" },
  { code: "+91",  country: "IN", label: "🇮🇳 印度 India" },
  { code: "+63",  country: "PH", label: "🇵🇭 菲律宾 Philippines" },
  { code: "+62",  country: "ID", label: "🇮🇩 印尼 Indonesia" },
  { code: "+84",  country: "VN", label: "🇻🇳 越南 Vietnam" },
  { code: "CUSTOM", country: "CUSTOM", label: "✏️ 自定义 / 手动输入" },
];

function parseWhatsApp(v?: string | null): { code: string; local: string; customRaw?: string } {
  if (!v) return { code: "+852", local: "" };
  if (v.startsWith("CUSTOM:")) return { code: "CUSTOM", local: "", customRaw: v.slice("CUSTOM:".length) };
  const m = v.match(/^(\+\d+)[-\s]?(.*)$/);
  if (m) {
    const code = COUNTRY_CODES.find((c) => c.code === m[1]) ? m[1] : "+852";
    return { code, local: m[2] || "" };
  }
  return { code: "+852", local: v };
}

function buildWhatsApp(code: string, local: string, customRaw?: string): string {
  if (code === "CUSTOM") {
    const raw = (customRaw || "").trim();
    return raw ? `CUSTOM:${raw}` : "";
  }
  const l = (local || "").replace(/[^\d]/g, "");
  return l ? `${code}-${l}` : "";
}

function displayWhatsApp(v?: string | null): string {
  if (!v) return "";
  if (v.startsWith("CUSTOM:")) return v.slice("CUSTOM:".length);
  return v;
}

interface SystemAppUser {
  id: string;
  displayName: string;
  email: string;
  role: "ADMIN" | "RISK_MANAGER" | "BD_MANAGER" | "OPERATIONS";
  whatsapp?: string;
  bdManagerFullName?: string;
  avatarInitials: string;
  avatarDataUrl?: string;
  enabled: boolean;
  createdAt: string;
  passwordHash?: string;
  salt?: string;
}

type UserFormState = Omit<SystemAppUser, "id" | "createdAt" | "avatarInitials" | "passwordHash" | "salt"> & {
  id?: string;
  password?: string;
  confirmPassword?: string;
};

const emptyUserForm = (): UserFormState => ({
  displayName: "",
  email: "",
  role: "BD_MANAGER",
  whatsapp: "",
  bdManagerFullName: "",
  avatarDataUrl: "",
  enabled: true,
  password: "",
  confirmPassword: "",
});

const SYSTEM_ROLE_LABELS: Record<SystemAppUser["role"], string> = {
  ADMIN: "系统管理员",
  RISK_MANAGER: "风控总监",
  BD_MANAGER: "商务经理",
  OPERATIONS: "运营",
};

function computeInitials(name: string, email?: string): string {
  const src = (name || email || '??').trim();
  if (!src) return 'US';
  const parts = src.split(/[\s\-_\.@]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  return src.slice(0, 2).toUpperCase();
}

const ROLE_LABELS: Record<RiskRecipient["role"], string> = {
  RISK_MANAGER: "风控经理",
  RISK_ANALYST: "风控分析师",
  RISK_DIRECTOR: "风控总监",
  BD_MANAGER: "商务经理",
  OPERATIONS: "运营",
  DIRECTOR: "总监",
  CUSTOM: "自定义",
};

const ROLE_ORDER: RiskRecipient["role"][] = [
  "RISK_MANAGER",
  "RISK_ANALYST",
  "RISK_DIRECTOR",
  "BD_MANAGER",
  "OPERATIONS",
  "DIRECTOR",
  "CUSTOM",
];

type RecipientFormState = Omit<RiskRecipient, "id"> & { id?: string };

const emptyForm = (): RecipientFormState => ({
  name: "",
  role: "RISK_MANAGER",
  email: "",
  whatsapp: "",
  enabled: true,
});

interface SettingsFormState {
  warningThreshold: number;
  marginThreshold: number;
  priorityRatio: number;
  subordinateRatio: number;
  emailWebhook: string;
  whatsappWebhook: string;
  defaultRiskEmail: string;
  emergencyPhone: string;
  dataSource: string;
  apiKey: string;
  vipThreshold: number;
  vipClient: number;
  vipInstitution: number;
  normalClient: number;
  normalInstitution: number;
  webAlertEnabled: boolean;
  webAlertSound: boolean;
  webAlertCriticalOnly: boolean;
  realtimeTickEnabled: boolean;
  realtimeTickIntervalSec: number;
}

type SettingsFieldName =
  | "warningThreshold"
  | "marginThreshold"
  | "priorityRatio"
  | "subordinateRatio"
  | "emailWebhook"
  | "whatsappWebhook"
  | "defaultRiskEmail"
  | "emergencyPhone"
  | "apiKey"
  | "realtimeTickIntervalSec";

const DEFAULT_FORM: SettingsFormState = {
  warningThreshold: 15,
  marginThreshold: 20,
  priorityRatio: 70,
  subordinateRatio: 30,
  emailWebhook: "",
  whatsappWebhook: "",
  defaultRiskEmail: "",
  emergencyPhone: "",
  dataSource: "Yahoo Finance (免费)",
  apiKey: "",
  vipThreshold: 100000,
  vipClient: 40,
  vipInstitution: 60,
  normalClient: 30,
  normalInstitution: 70,
  webAlertEnabled: true,
  webAlertSound: true,
  webAlertCriticalOnly: false,
  realtimeTickEnabled: true,
  realtimeTickIntervalSec: 8,
};

type SettingsFieldProps = Omit<ComponentProps<typeof Input>, "name" | "value" | "defaultValue" | "onChange"> & {
  name: SettingsFieldName;
  value: string | number;
  onValueChange: (name: SettingsFieldName, value: string) => void;
};

function SettingsField({ name, value, onValueChange, ...props }: SettingsFieldProps) {
  return (
    <Input
      {...props}
      name={name}
      value={value}
      onChange={(e) => onValueChange(name, e.target.value)}
    />
  );
}

export default function SettingsPage() {
  const { user: currentUser, role: currentRole } = useAuthContext();
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ title: string; run: () => void } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [form, setForm] = useState<SettingsFormState>(() => DEFAULT_FORM);
  // Phase 5: 多档风控阈值配置
  const [riskTiers, setRiskTiers] = useState<RiskTier[]>(() => {
    try { return getStoredRiskTiers(); } catch { return [...DEFAULT_RISK_TIERS]; }
  });
  // Phase 6: 闪跌检测阈值配置
  const [flashCrashThresholds, setFlashCrashThresholds] = useState<FlashCrashThreshold[]>(() => {
    try { return getFlashCrashThresholds(); } catch { return [...DEFAULT_FLASH_CRASH_THRESHOLDS]; }
  });
  const [quote, setQuote] = useState<LiveQuoteSettings>(() => ({ ...DEFAULT_LIVE_QUOTE }));
  const [quoteTick, setQuoteTick] = useState(0);
  const [quoteLive, setQuoteLive] = useState<BrowserQuote | null>(null);
  const [quoteFetching, setQuoteFetching] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditTick, setAuditTick] = useState(0);
  const [auditFilterAction, setAuditFilterAction] = useState<"__ALL__" | AuditAction>("__ALL__");
  const [auditSearchKw, setAuditSearchKw] = useState<string>("");
  const [auditOpenDetail, setAuditOpenDetail] = useState<AuditLogEntry | null>(null);
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setQuoteTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      try {
        const logs = await fetchAuditLogs({ limit: 1000 });
        if (!cancelled) setAuditLogs(logs);
      } catch {
        if (!cancelled) setAuditLogs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, auditTick]);
  useEffect(() => {
    const onAudit = () => setAuditTick((x) => x + 1);
    window.addEventListener("risk-control:audit-updated", onAudit);
    return () => window.removeEventListener("risk-control:audit-updated", onAudit);
  }, []);
  // 当前业务数据规模，用于清空前核对；已清空时显示为空。
  const ledgerScale = useMemo(() => {
    if (!hydrated || isLedgerEmpty()) return { batches: 0, clients: 0 };
    try {
      const data = getMockData();
      return {
        batches: data.batches.length,
        clients: data.batches.reduce((sum, b) => sum + (b.clients?.length ?? 0), 0),
      };
    } catch {
      return { batches: 0, clients: 0 };
    }
  }, [hydrated, clearDataOpen]);
  const handleClearAllData = useCallback(async () => {
    setClearingData(true);
    try {
      const result = clearAllBusinessData();
      logAudit({
        action: "ledger_clear",
        resource: "/settings",
        detail: { batchCount: result.batches, clientCount: result.clients },
      });
      setAuditTick((x) => x + 1);
      setClearDataOpen(false);
      toast.success(`已清空 ${result.batches} 个批次、${result.clients} 位客户，系统已恢复为空白状态。`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清空失败，请稍后重试。");
      throw err;
    } finally {
      setClearingData(false);
    }
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    setQuoteFetching(true);
    (async () => {
      try {
        const q = await fetchQuoteBrowser(quote.symbol);
        if (!cancelled) setQuoteLive(q);
      } finally {
        if (!cancelled) setQuoteFetching(false);
      }
    })();
    const t2 = setInterval(async () => {
      try {
        const q = await fetchQuoteBrowser(quote.symbol);
        if (!cancelled) setQuoteLive(q);
      } catch {}
    }, Math.max(3000, Math.min(60_000, Number(quote.refreshSec) * 1000)));
    return () => {
      cancelled = true;
      clearInterval(t2);
    };
  }, [hydrated, quote.symbol, quote.refreshSec]);
  useEffect(() => {
    setHydrated(true);
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SettingsFormState>;
        setForm((prev) => ({ ...prev, ...parsed,
          emailWebhook: /example\.com/.test(parsed.emailWebhook ?? "") ? "" : parsed.emailWebhook ?? "",
          defaultRiskEmail: parsed.defaultRiskEmail === "risk-control@institution.com" ? "" : parsed.defaultRiskEmail ?? "",
          emergencyPhone: parsed.emergencyPhone === "+852-9123-4567" ? "" : parsed.emergencyPhone ?? "",
        }));
      }
    } catch (e) {}
    try {
      setQuote(getLiveQuoteSettings());
      const onChange = (e: Event) => {
        const ce = e as CustomEvent<LiveQuoteSettings>;
        if (ce?.detail) setQuote({ ...DEFAULT_LIVE_QUOTE, ...ce.detail });
      };
      window.addEventListener("risk-control:quote-changed", onChange as any);
      return () => window.removeEventListener("risk-control:quote-changed", onChange as any);
    } catch (e) {}
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      const rates = getProfitSettings();
      const stored = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      localStorage.setItem(LS_KEY, JSON.stringify({
        ...form, ...rates, vipInstitution: 100 - rates.vipClient, normalInstitution: 100 - rates.normalClient,
        emailWebhook: stored.emailWebhook ?? "", whatsappWebhook: stored.whatsappWebhook ?? "",
        defaultRiskEmail: stored.defaultRiskEmail ?? "", emergencyPhone: stored.emergencyPhone ?? "",
      }));
    } catch (e) {}
  }, [form, hydrated]);

  // 收件人：持久化 + 联动 riskRecipients global
  const [recipients, setRecipients] = useState<RiskRecipient[]>(() => getRiskRecipients());
  useEffect(() => {
    try {
      setRecipients(getRiskRecipients());
    } catch (e) {}
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { setRiskRecipients(recipients); }
    catch { toast.error("收件人保存失败，请稍后重试。"); }
  }, [recipients, hydrated]);

  // 品牌 Logo 管理（localStorage 持久化）
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const logoFileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    setLogoDataUrl(getStoredLogo());
    const onChange = () => setLogoDataUrl(getStoredLogo());
    window.addEventListener("risk-control:logo-changed", onChange);
    window.addEventListener("storage", (e) => { if (e.key === "risk_control_logo_v1") onChange(); });
    return () => {
      window.removeEventListener("risk-control:logo-changed", onChange);
      window.removeEventListener("storage", onChange as any);
    };
  }, []);
  const handleLogoFile = (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo 文件不能超过 2MB");
      return;
    }
    if (!/^image\//.test(file.type)) {
      toast.error("请上传图片格式的 Logo");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setStoredLogo(dataUrl);
      setLogoDataUrl(dataUrl);
      setSaved("logo");
      setTimeout(() => setSaved(null), 2400);
      toast.success("品牌 Logo 已更新");
    };
    reader.onerror = () => toast.error("读取文件失败");
    reader.readAsDataURL(file);
  };
  const onLogoInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleLogoFile(f);
    e.target.value = "";
  };
  const resetLogo = () => {
    setStoredLogo(null);
    setLogoDataUrl(null);
    toast.success("已恢复默认 Logo");
  };

  // 新增/编辑收件人 Dialog
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rForm, setRForm] = useState<RecipientFormState>(emptyForm());
  const [rErrors, setRErrors] = useState<Record<string, string>>({});
  const [rWA, setRWA] = useState<{ code: string; local: string; customRaw: string }>({ code: "+852", local: "", customRaw: "" });

  // 通知渠道帮助 Dialog（需求4：? 按钮 → 弹窗显示详细配置方法）
  type HelpTopic = "email-webhook" | "whatsapp-webhook" | null;
  const [helpOpen, setHelpOpen] = useState<HelpTopic>(null);
  const HELP_CONTENT: Record<Exclude<HelpTopic, null>, { title: string; icon: "mail" | "wa"; steps: { h: string; p: string }[]; tips: string[] }> = {
    "email-webhook": {
      title: "邮件通知配置指南",
      icon: "mail",
      steps: [
        { h: "① 完成发件域名验证", p: "由系统管理员在邮件服务商处完成发件域名与发件邮箱验证，确保风控通知能够正常投递。" },
        { h: "② 启用系统邮件通道", p: "管理员完成邮件通道配置后，本页「检查服务配置」将显示为就绪状态。" },
        { h: "③ 配置转发地址（可选）", p: "如需将通知同步到内部系统（如钉钉群、工单系统），可填写一个 HTTPS 转发地址；留空则使用系统默认通道。" },
        { h: "④ 添加收件人并发送测试", p: "填写「默认风控收件人」，并在「风控收件人管理」中逐个维护；点击「发送测试邮件」，确认 3 分钟内可收到。" },
      ],
      tips: [
        "长时间未收到邮件，通常是发件域名验证尚未生效",
        "免费额度超限时会自动降级为页面内通知，不会重复扣费",
        "同一事件 30 分钟内去重：同批次、同风险等级只发送一次",
      ],
    },
    "whatsapp-webhook": {
      title: "WhatsApp 通知配置指南",
      icon: "wa",
      steps: [
        { h: "① 开通企业号码", p: "由系统管理员在 WhatsApp 商务平台完成企业号码验证，审核通过后方可对外发送消息。" },
        { h: "② 启用系统消息通道", p: "管理员完成 WhatsApp 消息通道配置后即可使用；未配置时该渠道不生效。" },
        { h: "③ 配置转发地址（可选）", p: "如需将通知同步到内部系统，可填写一个 HTTPS 转发地址；留空则使用系统默认通道。" },
        { h: "④ 填写紧急联系人并发送测试", p: "为收件人填写带区号的完整号码（如 +852-91234567）并发送测试。首次可能因对方未同意消息模板而失败，需对方先回复一条消息。" },
      ],
      tips: [
        "WhatsApp 仅允许向 24 小时内回复过消息的联系人主动发送非模板消息，建议使用已审核模板",
        "同一事件 30 分钟内去重，避免被判定为骚扰",
        "未填写号码的收件人不会收到 WhatsApp 通知，仅走邮件渠道",
      ],
    },
  };

  // 系统账号管理
  const { refreshMe } = useAuthContext();
  const [users, setUsers] = useState<SystemAppUser[]>(() => []);
  const [usersLoadError, setUsersLoadError] = useState<string>("");
  const loadRemoteUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/manage', { method: 'GET', credentials: 'include', cache: 'no-store', headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw new Error(res.status === 401 ? '未登录' : '仅管理员可查看');
        throw new Error('暂时无法读取系统账号，请稍后重试');
      }
      const data: any = await res.json();
      const remote: Array<any> = Array.isArray(data?.users) ? data.users : [];
      // 把 remote（Prisma AppUser 列）补 shadow 到 localStorage 同步，保持离线降级可读
      const merged: SystemAppUser[] = remote.map((u: any): SystemAppUser => {
        const displayName = String(u.displayName ?? '未知用户');
        const email = String(u.email ?? '');
        const ai = typeof u.avatarInitials === 'string' && u.avatarInitials.length > 0
          ? u.avatarInitials
          : computeInitials(displayName, email);
        return {
          id: String(u.id),
          displayName,
          email,
          role: String(u.role) as any,
          bdManagerFullName: u.bdManagerFullName || undefined,
          avatarInitials: ai,
          avatarDataUrl: u.avatarDataUrl || undefined,
          enabled: true,
          createdAt: u.createdAt ?? new Date().toISOString(),
        };
      });
      // 合并已有 localStorage 自定义 shadow（有 passwordHash 或 whatsapp 非空就用 shadow 版本，保持习惯）
      try {
        const raw = localStorage.getItem(USERS_LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const byId = new Map<string, SystemAppUser>();
            for (const r of merged) byId.set(r.id, r);
            for (const s of parsed) {
              if (!s || typeof s !== 'object') continue;
              const sid = String((s as any).id ?? '');
              if (!sid) continue;
              const existing = byId.get(sid);
              if (existing) {
                const next: SystemAppUser = { ...existing, whatsapp: (s as any).whatsapp ?? existing.whatsapp, passwordHash: (s as any).passwordHash, salt: (s as any).salt };
                byId.set(sid, next);
              } else {
                byId.set(sid, s as SystemAppUser);
              }
            }
            const list = Array.from(byId.values());
            setUsers(list);
            try { localStorage.setItem(USERS_LS_KEY, JSON.stringify(list)); } catch {}
            setUsersLoadError("");
            return;
          }
        }
      } catch {}
      setUsers(merged);
      setUsersLoadError("");
      try { localStorage.setItem(USERS_LS_KEY, JSON.stringify(merged)); } catch {}
    } catch (err: any) {
      // 服务端失败：降级读 localStorage 历史
      setUsersLoadError(err?.message ?? "暂时无法读取系统账号");
      try {
        const raw = localStorage.getItem(USERS_LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setUsers(parsed);
        }
      } catch {}
    }
  }, []);
  useEffect(() => {
    void loadRemoteUsers();
  }, [loadRemoteUsers]);
  useEffect(() => {
    if (users.length === 0) return;
    try {
      localStorage.setItem(USERS_LS_KEY, JSON.stringify(users));
    } catch (e) {}
  }, [users]);
  const [usersSaving, setUsersSaving] = useState(false);
  const [userDlgOpen, setUserDlgOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [uForm, setUForm] = useState<UserFormState>(emptyUserForm());
  const [uErrors, setUErrors] = useState<Record<string, string>>({});
  const [uWA, setUWA] = useState<{ code: string; local: string; customRaw: string }>({ code: "+852", local: "", customRaw: "" });
  const uAvatarFileRef = useRef<HTMLInputElement | null>(null);

  const openAddUser = () => {
    setEditingUserId(null);
    setUForm(emptyUserForm());
    setUWA({ code: "+852", local: "", customRaw: "" });
    setUErrors({});
    setUserDlgOpen(true);
  };
  const openEditUser = (u: SystemAppUser) => {
    setEditingUserId(u.id);
    setUForm({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      role: u.role,
      whatsapp: u.whatsapp ?? "",
      bdManagerFullName: u.bdManagerFullName ?? "",
      avatarDataUrl: u.avatarDataUrl ?? "",
      enabled: u.enabled,
    });
    const p = parseWhatsApp(u.whatsapp ?? "");
    setUWA({ code: p.code, local: p.local, customRaw: p.customRaw ?? "" });
    setUErrors({});
    setUserDlgOpen(true);
  };
  const validateUser = (): boolean => {
    const errs: Record<string, string> = {};
    if (!uForm.displayName.trim()) errs.displayName = "请填写姓名";
    if (!uForm.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(uForm.email || ""))
      errs.email = "请填写有效邮箱";
    const pwd = (uForm.password ?? "").trim();
    const confirm = (uForm.confirmPassword ?? "").trim();
    if (!editingUserId) {
      if (!pwd) errs.password = "请设置登录密码";
      else if (pwd.length < 6) errs.password = "密码至少 6 位";
      if (!confirm) errs.confirmPassword = "请再次输入密码";
      else if (pwd && confirm && pwd !== confirm) errs.confirmPassword = "两次输入的密码不一致";
    } else {
      if (pwd || confirm) {
        if (pwd.length < 6) errs.password = "密码至少 6 位";
        if (pwd !== confirm) errs.confirmPassword = "两次输入的密码不一致";
      }
    }
    setUErrors(errs);
    return Object.keys(errs).length === 0;
  };
  const saveUser = async () => {
    if (currentRole !== APP_ROLES.ADMIN) {
      toast.error("仅系统管理员可新增或编辑系统账号。");
      return;
    }
    if (!validateUser()) return;
    setUsersSaving(true);
    const waFinal = buildWhatsApp(uWA.code, uWA.local, uWA.customRaw);
    const nameTrim = uForm.displayName.trim();
    const initials = computeInitials(nameTrim, uForm.email);
    const avatarDataUrl = uForm.avatarDataUrl || undefined;
    const pwd = (uForm.password ?? "").trim();
    const payloadLocal: Partial<SystemAppUser> = {
      displayName: nameTrim,
      email: uForm.email.trim(),
      role: uForm.role,
      whatsapp: waFinal || undefined,
      bdManagerFullName: uForm.bdManagerFullName?.trim() || undefined,
      avatarInitials: initials,
      avatarDataUrl,
      enabled: !!uForm.enabled,
    };
    if (pwd) {
      const hashed = await hashCustomUserPassword(pwd);
      payloadLocal.passwordHash = hashed.passwordHash;
      payloadLocal.salt = hashed.salt;
    }
    const usersBefore = users.slice();
    let optimisticId = editingUserId ?? "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let nextList: SystemAppUser[];
    if (editingUserId) {
      nextList = users.map((u) =>
        u.id === editingUserId
          ? ({
              ...u,
              ...payloadLocal,
              id: editingUserId,
              avatarInitials: initials || u.avatarInitials,
              avatarDataUrl,
              whatsapp: waFinal || undefined,
              password: undefined,
              confirmPassword: undefined,
            } as SystemAppUser)
          : u
      );
    } else {
      const newU: SystemAppUser = {
        id: optimisticId,
        displayName: nameTrim,
        email: uForm.email.trim(),
        role: uForm.role,
        whatsapp: waFinal || undefined,
        bdManagerFullName: uForm.bdManagerFullName?.trim() || undefined,
        avatarInitials: initials,
        avatarDataUrl,
        enabled: !!uForm.enabled,
        createdAt: new Date().toISOString(),
        passwordHash: payloadLocal.passwordHash,
        salt: payloadLocal.salt,
      };
      nextList = [...users, newU];
    }
    // 先乐观更新 UI（让用户看到提交反馈）
    setUsers(nextList);
    try { localStorage.setItem(USERS_LS_KEY, JSON.stringify(nextList)); } catch {}

    let apiOk = false;
    let storedHint: "db" | "pending" | "failed" | null = null;
    let apiError: string | null = null;
    try {
      const apiPayload: any = { ...payloadLocal };
      if (pwd) apiPayload.password = pwd;
      let url = "/api/auth/manage";
      let method: "POST" | "PATCH" = "POST";
      if (editingUserId) {
        url = `/api/auth/manage/${encodeURIComponent(editingUserId)}`;
        method = "PATCH";
      }
      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify(apiPayload),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 200 || resp.status === 202) {
        apiOk = true;
        storedHint = data?.stored === "db" ? "db" : (data?.stored === "pending" || data?.stored === "degraded") ? "pending" : null;
        if (!editingUserId && data?.user?.id) {
          optimisticId = String(data.user.id);
        }
      } else {
        apiError = data?.error ?? "系统暂时无法处理，请稍后重试";
        storedHint = data?.stored === "failed" ? "failed" : null;
      }
    } catch (err: any) {
      apiError = err?.message ?? "网络错误";
    }

    logAudit({
      action: editingUserId ? "account_update" : "account_create",
      actorId: currentUser?.id,
      actorEmail: currentUser?.email,
      role: currentRole,
      resource: `settings:account:${optimisticId}`,
      detail: {
        targetUserId: optimisticId,
        targetEmail: uForm.email,
        targetRole: uForm.role,
        stored: storedHint,
        apiError,
      },
    });

    if (apiOk) {
      const msg = editingUserId ? "账号已更新" : "账号创建成功";
      if (storedHint === "pending") toast.success(msg + "（已受理，正在同步）");
      else toast.success(msg);
      setSaved("user");
      setUserDlgOpen(false);
      setTimeout(async () => {
        try { await loadRemoteUsers(); } catch {}
        try { await refreshMe(); } catch {}
      }, 280);
    } else {
      // 失败：回滚乐观更新 + 清 localStorage 回写备份
      setUsers(usersBefore);
      try { localStorage.setItem(USERS_LS_KEY, JSON.stringify(usersBefore)); } catch {}
      toast.error(
        (editingUserId ? "更新失败：" : "创建失败：") +
        (apiError ?? "系统暂不可用") +
        "（账号未保存，请稍后重试）"
      );
    }
    setUsersSaving(false);
  };
  const removeUser = (id: string) => {
    if (currentRole !== APP_ROLES.ADMIN) {
      toast.error("仅系统管理员可删除系统账号。");
      return;
    }
    const target = users.find((u) => u.id === id);
    setConfirmation({
      title: "确认删除该账号？",
      run: async () => {
        setUsersSaving(true);
        const usersBefore = users.slice();
        // 乐观删除 UI
        setUsers((list) => list.filter((u) => u.id !== id));
        try {
          localStorage.setItem(
            USERS_LS_KEY,
            JSON.stringify(users.filter((u) => u.id !== id))
          );
        } catch (e) {}

        let apiOk = false;
        let storedHint: "db" | "pending" | "failed" | null = null;
        let apiError: string | null = null;
        try {
          const resp = await fetch(`/api/auth/manage/${encodeURIComponent(id)}`, {
            method: "DELETE",
            headers: { "Cache-Control": "no-store" },
          });
          const data = await resp.json().catch(() => ({}));
          if (resp.status === 200 || resp.status === 202) {
            apiOk = true;
            storedHint = data?.stored === "db" ? "db" : (data?.stored === "pending" || data?.stored === "degraded") ? "pending" : null;
          } else {
            apiError = data?.error ?? "系统暂时无法处理，请稍后重试";
            storedHint = data?.stored === "failed" ? "failed" : null;
          }
        } catch (err: any) {
          apiError = err?.message ?? "网络错误";
        }

        logAudit({
          action: "account_delete",
          actorId: currentUser?.id,
          actorEmail: currentUser?.email,
          role: currentRole,
          resource: `settings:account:${id}`,
          detail: {
            targetUserId: id,
            targetEmail: target?.email ?? null,
            targetRole: target?.role ?? null,
            stored: storedHint,
            apiError,
          },
        });
        if (apiOk) {
          const baseMsg = target ? `已删除账号 ${target.email}` : "已删除账号";
          if (storedHint === "pending") toast.success(baseMsg + "（已受理，正在同步）");
          else toast.success(baseMsg);
          setTimeout(async () => {
            try { await loadRemoteUsers(); } catch {}
            try { await refreshMe(); } catch {}
          }, 220);
        } else {
          // 失败：回滚删除
          setUsers(usersBefore);
          try { localStorage.setItem(USERS_LS_KEY, JSON.stringify(usersBefore)); } catch {}
          toast.error("删除失败：" + (apiError ?? "系统暂不可用") + "（账号未删除，请稍后重试）");
        }
        setUsersSaving(false);
      },
    });
  };
  const toggleUserEnabled = (id: string, enabled: boolean) => {
    if (currentRole !== APP_ROLES.ADMIN) {
      toast.error("仅系统管理员可启用或停用系统账号。");
      return;
    }
    const prevEnabledStateMap = new Map<string, boolean>();
    users.forEach((u) => prevEnabledStateMap.set(u.id, !!u.enabled));
    setUsers((list) => {
      const next = list.map((u) => (u.id === id ? { ...u, enabled } : u));
      try {
        localStorage.setItem(USERS_LS_KEY, JSON.stringify(next));
      } catch (e) {}
      return next;
    });
    void (async () => {
      let storedHint: "db" | "pending" | "failed" | null = null;
      let apiError: string | null = null;
      try {
        const resp = await fetch(`/api/auth/manage/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          body: JSON.stringify({ enabled }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.status === 200 || resp.status === 202) {
          storedHint = data?.stored === "db" ? "db" : (data?.stored === "pending" || data?.stored === "degraded") ? "pending" : null;
        } else {
          apiError = data?.error ?? "系统暂时无法处理，请稍后重试";
          storedHint = data?.stored === "failed" ? "failed" : null;
        }
      } catch (err: any) {
        apiError = err?.message ?? "网络错误";
      }
      logAudit({
        action: "account_update",
        actorId: currentUser?.id,
        actorEmail: currentUser?.email,
        role: currentRole,
        resource: `settings:account:${id}`,
        detail: { targetUserId: id, enabled, stored: storedHint, apiError },
      });
      if (storedHint === "db") {
        toast.success(enabled ? "已启用账号" : "已停用账号");
      } else if (storedHint === "pending") {
        toast.success((enabled ? "已启用账号（" : "已停用账号（") + "已受理，正在同步）");
      } else if (storedHint === "failed" || apiError) {
        // 失败回滚 enabled
        setUsers((list) =>
          list.map((u) => {
            if (u.id !== id) return u;
            const oldVal = prevEnabledStateMap.get(id);
            return { ...u, enabled: typeof oldVal === "boolean" ? oldVal : !!u.enabled };
          })
        );
        try {
          const raw = localStorage.getItem(USERS_LS_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const rolled = parsed.map((u: any) =>
                u && String((u as any).id) === String(id)
                  ? { ...u, enabled: prevEnabledStateMap.get(id) ?? !!(u as any).enabled }
                  : u
              );
              localStorage.setItem(USERS_LS_KEY, JSON.stringify(rolled));
            }
          }
        } catch {}
        toast.error("状态同步失败：" + (apiError ?? "未知错误") + "（请稍后重试）");
      }
      try { await loadRemoteUsers(); } catch {}
    })();
  };

  const save = (label: string) => {
    if (label === "risk") {
      if (currentRole !== APP_ROLES.ADMIN && currentRole !== APP_ROLES.RISK_MANAGER) {
        toast.error("仅系统管理员或风控总监可修改风控阈值。");
        return;
      }
      if (Number(form.warningThreshold) <= 0 || Number(form.warningThreshold) >= 100) {
        toast.error("预警阈值须在 0% 到 100% 之间。"); return;
      }
      if (Number(form.marginThreshold) <= Number(form.warningThreshold) || Number(form.marginThreshold) > 100) {
        toast.error("补仓阈值须严格大于预警阈值，且不超过 100%。"); return;
      }
    }
    if (label === "notify") {
      if (currentRole !== APP_ROLES.ADMIN && currentRole !== APP_ROLES.RISK_MANAGER) {
        toast.error("仅系统管理员或风控总监可修改通知配置。");
        return;
      }
      if (form.defaultRiskEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.defaultRiskEmail)) {
        toast.error("请填写有效收件邮箱。"); return;
      }
      if (form.emergencyPhone && !/^\+[1-9]\d{7,14}$/.test(form.emergencyPhone.replace(/[\s()-]/g, ""))) {
        toast.error("WhatsApp 号码须包含国家区号，例如 +85291234567。"); return;
      }
    }
    const rates = label === "分成配置" ? {
      vipThreshold: Number(form.vipThreshold), vipClient: Number(form.vipClient), normalClient: Number(form.normalClient),
    } : getProfitSettings();
    if (!validProfitSettings(rates)) {
      toast.error("档位门槛须大于 0，客户利润比例须在 0% 至 100% 之间。");
      return;
    }
    try {
      const stored = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      const notificationFields = Object.fromEntries(
        (["emailWebhook", "whatsappWebhook", "defaultRiskEmail", "emergencyPhone"] as const)
          .map((key) => [key, label === "notify" ? form[key].trim() : stored[key] ?? ""])
      );
      const beforeWarn = Number(stored?.warningThreshold);
      const beforeMargin = Number(stored?.marginThreshold);
      const afterWarn = Number(form.warningThreshold);
      const afterMargin = Number(form.marginThreshold);
      localStorage.setItem(LS_KEY, JSON.stringify({
        ...form, ...rates, vipInstitution: 100 - rates.vipClient, normalInstitution: 100 - rates.normalClient,
        ...notificationFields,
      }));
      if (label === "risk") {
        logAudit({
          action: "threshold_update",
          actorId: currentUser?.id,
          actorEmail: currentUser?.email,
          role: currentRole,
          resource: "settings:threshold",
          detail: {
            before: { warningDropPercent: Number.isFinite(beforeWarn) ? beforeWarn : null, marginDropPercent: Number.isFinite(beforeMargin) ? beforeMargin : null },
            after: { warningDropPercent: Number.isFinite(afterWarn) ? afterWarn : null, marginDropPercent: Number.isFinite(afterMargin) ? afterMargin : null },
          },
        });
        toast.success(`风控阈值已更新：预警 ${afterWarn.toFixed(2)}% / 补仓 ${afterMargin.toFixed(2)}%`);
      }
    } catch {
      toast.error("配置保存失败，请稍后重试。");
      return;
    }
    if (label === "分成配置") toast.success("分成配置已保存，仅对新签约客户生效。");
    setSaved(label);
    setTimeout(() => setSaved(null), 2200);
  };

  // Phase 5: 多档风控阈值配置
  const updateRiskTier = (id: string, patch: Partial<RiskTier>) => {
    setRiskTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const addRiskTier = () => {
    const maxLevel = riskTiers.reduce((m, t) => Math.max(m, t.level), 0);
    const maxDrop = riskTiers.reduce((m, t) => Math.max(m, t.dropPercent), 0);
    const newTier: RiskTier = {
      id: `tier_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `新档位 ${maxLevel + 1}`,
      level: maxLevel + 1,
      dropPercent: Math.min(100, Math.ceil(maxDrop + 5)),
      notifyChannels: ["email"],
      notifyTargets: ["risk"],
      action: "notify",
      color: "warning",
      enabled: true,
    };
    setRiskTiers((prev) => [...prev, newTier]);
  };

  const removeRiskTier = (id: string) => {
    setRiskTiers((prev) => prev.filter((t) => t.id !== id));
  };

  const saveRiskTiersConfig = () => {
    if (currentRole !== APP_ROLES.ADMIN && currentRole !== APP_ROLES.RISK_MANAGER) {
      toast.error("仅系统管理员或风控总监可修改风控阈值。");
      return;
    }
    const { valid, errors } = validateRiskTiers(riskTiers);
    if (!valid) {
      toast.error(errors[0] ?? "档位配置不合法");
      return;
    }
    const sorted = [...riskTiers].sort((a, b) => a.dropPercent - b.dropPercent);
    const ok = saveRiskTiers(sorted);
    if (!ok) {
      toast.error("保存失败，请稍后重试。");
      return;
    }
    setRiskTiers(sorted);
    logAudit({
      action: "threshold_update",
      actorId: currentUser?.id,
      actorEmail: currentUser?.email,
      role: currentRole,
      resource: "settings:risk_tiers",
      detail: {
        tiers: sorted.map((t) => ({ name: t.name, dropPercent: t.dropPercent, action: t.action, enabled: t.enabled })),
      },
    });
    toast.success(`多档风控阈值已保存（${sorted.filter((t) => t.enabled).length} 档生效）`);
    setSaved("riskTiers");
    setTimeout(() => setSaved(null), 2200);
  };

  const resetRiskTiersConfig = () => {
    const reset = resetRiskTiers();
    setRiskTiers(reset);
    toast.success("已重置为默认 4 档风控阈值");
  };

  // Phase 6: 闪跌阈值配置函数
  const updateFlashCrashThreshold = (index: number, patch: Partial<FlashCrashThreshold>) => {
    setFlashCrashThresholds((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };
  const addFlashCrashThreshold = () => {
    setFlashCrashThresholds((prev) => [...prev, { windowMinutes: 30, dropPercent: 20, enabled: true }]);
  };
  const removeFlashCrashThreshold = (index: number) => {
    setFlashCrashThresholds((prev) => prev.filter((_, i) => i !== index));
  };
  const saveFlashCrashConfig = () => {
    saveFlashCrashThresholds(flashCrashThresholds);
    logAudit({
      action: "threshold_update",
      actorId: currentUser?.id,
      actorEmail: currentUser?.email,
      role: currentRole,
      resource: "settings:flash_crash",
      detail: { thresholds: flashCrashThresholds },
    });
    setSaved("flashCrash");
    toast.success("闪跌检测阈值已保存");
  };
  const resetFlashCrashConfig = () => {
    const reset = resetFlashCrashThresholds();
    setFlashCrashThresholds(reset);
    toast.success("已重置为默认闪跌阈值");
  };

  const openAdd = () => {
    setEditingId(null);
    setRForm(emptyForm());
    setRWA({ code: "+852", local: "", customRaw: "" });
    setRErrors({});
    setDlgOpen(true);
  };
  const openEdit = (r: RiskRecipient) => {
    setEditingId(r.id);
    setRForm({ ...r });
    const p = parseWhatsApp(r.whatsapp ?? "");
    setRWA({ code: p.code, local: p.local, customRaw: p.customRaw ?? "" });
    setRErrors({});
    setDlgOpen(true);
  };
  const validateRecipient = (): boolean => {
    const errs: Record<string, string> = {};
    if (!rForm.name.trim()) errs.name = "请填写收件人姓名";
    if (!rForm.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rForm.email || "")) errs.email = "请填写有效邮箱";
    setRErrors(errs);
    return Object.keys(errs).length === 0;
  };
  const saveRecipient = () => {
    if (!validateRecipient()) return;
    const waFinal = buildWhatsApp(rWA.code, rWA.local, rWA.customRaw);
    let nextList: RiskRecipient[];
    if (editingId) {
      nextList = recipients.map(r =>
        r.id === editingId ? ({ ...r, ...rForm, id: editingId, whatsapp: waFinal || undefined } as RiskRecipient) : r
      );
      setRecipients(nextList);
    } else {
      const newR: RiskRecipient = {
        id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: rForm.name.trim(),
        role: rForm.role,
        email: rForm.email.trim(),
        whatsapp: waFinal || undefined,
        enabled: !!rForm.enabled,
      };
      nextList = [...recipients, newR];
      setRecipients(nextList);
    }
    try {
      localStorage.setItem(RECIPIENTS_LS_KEY, JSON.stringify(nextList));
    } catch (e) {}
    setSaved("recipient");
    setDlgOpen(false);
  };
  const removeRecipient = (id: string) => {
    setConfirmation({ title: "确认删除该收件人？", run: () => setRecipients((list) => list.filter(r => r.id !== id)) });
  };
  const toggleEnabled = (id: string, enabled: boolean) => {
    setRecipients((list) => list.map(r => r.id === id ? { ...r, enabled } : r));
  };
  const resetRecipients = () => {
    setConfirmation({ title: "确认清空收件人？通知将暂停发送给名单中的人员。", run: () => setRecipients([]) });
  };

  const handleSettingsFieldChange = useCallback((name: SettingsFieldName, value: string) => {
    setForm((prev) => {
      switch (name) {
        case "warningThreshold":
          return { ...prev, warningThreshold: value === "" ? 0 : Number(value) };
        case "marginThreshold":
          return { ...prev, marginThreshold: value === "" ? 0 : Number(value) };
        case "priorityRatio":
          return { ...prev, priorityRatio: value === "" ? 0 : Number(value) };
        case "subordinateRatio":
          return { ...prev, subordinateRatio: value === "" ? 0 : Number(value) };
        case "realtimeTickIntervalSec":
          return { ...prev, realtimeTickIntervalSec: value === "" ? 0 : Number(value) };
        case "emailWebhook":
          return { ...prev, emailWebhook: value };
        case "whatsappWebhook":
          return { ...prev, whatsappWebhook: value };
        case "defaultRiskEmail":
          return { ...prev, defaultRiskEmail: value };
        case "emergencyPhone":
          return { ...prev, emergencyPhone: value };
        case "apiKey":
          return { ...prev, apiKey: value };
      }
    });
  }, []);

  const enabledCount = recipients.filter(r => r.enabled).length;

  const [testStatus, setTestStatus] = useState<{ email?: string; whatsapp?: string }>({});
  const [channelStatus, setChannelStatus] = useState<ReturnType<typeof notificationReadiness> | null>(null);
  const [sendToken, setSendToken] = useState("");
  const [tokenReady, setTokenReady] = useState(false);
  const checkChannels = async () => {
    try {
      const response = await fetch("/api/notify/send", { cache: "no-store" });
      if (!response.ok) throw new Error("无法读取通知服务配置。");
      setChannelStatus(await response.json());
    } catch (err) { toast.error(err instanceof Error ? err.message : "配置检查失败"); }
  };
  useEffect(() => { void checkChannels(); setTokenReady(hasNotificationSendToken()); }, []);
  const [sendingTest, setSendingTest] = useState<"email" | "whatsapp" | null>(null);
  const handleSendTest = async (channel: "email" | "whatsapp") => {
    if (sendingTest) return;
    setSendingTest(channel);
    setTestStatus((s) => ({ ...s, [channel]: undefined }));
    try {
      const targets = channel === "email" ? [form.defaultRiskEmail] : [form.emergencyPhone];
      if (!targets[0]) {
        throw new Error(channel === "email" ? "请先填写默认风控收件人" : "请先填写紧急联系人电话");
      }
      const overrideWebhook = channel === "email" ? form.emailWebhook : form.whatsappWebhook;
      const r = await sendTestNotification(channel, targets, overrideWebhook || undefined);
      const sentTo = r.channels[channel]?.sentTo?.join(", ");
      if (r.channels[channel]?.success) {
        setTestStatus((s) => ({ ...s, [channel]: `OK → ${sentTo || targets[0]}` }));
        toast.success(`服务商已受理，请核对 ${sentTo || targets[0]} 是否实际收到。`);
        if (r.logError) toast.warning(r.logError);
      } else {
        throw new Error(r.channels[channel]?.error || (channel === "email" ? "发送测试邮件失败" : "发送测试 WhatsApp 失败"));
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      setTestStatus((s) => ({ ...s, [channel]: `ERR: ${msg.slice(0, 80)}` }));
      toast.error(msg);
    } finally {
      setSendingTest(null);
    }
  };

  return (
    <AuthGuard route="/settings" allowed={[...INSTITUTION_ROLES]}>
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="px-2 py-0.5 rounded bg-secondary text-secondary-foreground font-semibold">
        系统
      </span>
      <span>/</span>
      <span>系统设置</span>
    </div>
    <h1 className="text-2xl font-bold tracking-tight">系统设置</h1>
    <p className="text-sm text-muted-foreground">
      按分类管理风控、行情、通知、账号等系统配置
    </p>
  </div>

  <Tabs defaultValue="risk" className="w-full">
    <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 h-auto p-1.5 gap-1.5">
      <TabsTrigger value="risk" className="h-9 gap-1.5"><Shield className="h-3.5 w-3.5" />风控 · 分成</TabsTrigger>
      <TabsTrigger value="market" className="h-9 gap-1.5"><LineChart className="h-3.5 w-3.5" />行情 · 数据源</TabsTrigger>
      <TabsTrigger value="notify" className="h-9 gap-1.5"><Bell className="h-3.5 w-3.5" />通知 · 收件人</TabsTrigger>
      <TabsTrigger value="brand" className="h-9 gap-1.5"><Palette className="h-3.5 w-3.5" />品牌外观</TabsTrigger>
      <TabsTrigger value="account" className="h-9 gap-1.5"><Users className="h-3.5 w-3.5" />账号权限</TabsTrigger>
      <TabsTrigger value="audit" className="h-9 gap-1.5"><ScrollText className="h-3.5 w-3.5" />操作记录</TabsTrigger>
      <TabsTrigger value="about" className="h-9 gap-1.5"><Info className="h-3.5 w-3.5" />关于系统</TabsTrigger>
    </TabsList>

    <TabsContent value="risk" className="space-y-6 mt-6 lg:grid lg:grid-cols-3 lg:gap-6 [&>div]:lg:col-span-2">
      <div className="space-y-6">
      {/* Risk Thresholds */}
      <RoleGate
        allowed={[APP_ROLES.ADMIN, APP_ROLES.RISK_MANAGER]}
        auditAction="card_removed"
        auditResource="settings_threshold_card"
        fallback={
          <Card className="border-border/50">
            <CardContent className="pt-6 text-center py-10">
              <Lock className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="text-xs text-muted-foreground">仅系统管理员或风控总监可查看与修改阈值</p>
            </CardContent>
          </Card>
        }
      >
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          风控阈值配置
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-warning" />
              预警阈值（跌幅）
            </Label>
            <div className="relative">
              <SettingsField
                type="number"
                name="warningThreshold"
                value={form.warningThreshold}
                onValueChange={handleSettingsFieldChange}
                className="font-mono font-semibold pr-10"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">
                %
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              达到此跌幅后系统开始预警提示（默认 15%）
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-danger" />
              补仓阈值（跌幅）
            </Label>
            <div className="relative">
              <SettingsField
                type="number"
                name="marginThreshold"
                value={form.marginThreshold}
                onValueChange={handleSettingsFieldChange}
                className="font-mono font-semibold pr-10 text-danger"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">
                %
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              触发后立即发送补仓警报（默认 20%）
            </p>
          </div>
          <div className="space-y-1.5 opacity-75">
            <Label className="text-xs flex items-center gap-1.5">
              <Building2 className="h-3 w-3" />
              优先出资比例
              <span className="ml-1 inline-flex h-4 items-center px-1.5 rounded-full border border-dashed border-warning/40 text-[9px] tracking-wide text-warning/90 bg-warning/5">
                当前版本固定
              </span>
            </Label>
            <div className="relative">
              <SettingsField
                type="number"
                name="priorityRatio"
                value={form.priorityRatio}
                onValueChange={handleSettingsFieldChange}
                className="font-mono font-semibold pr-10"
                disabled
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">
                %
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              客户优先出资占比（固定 70%，其余为 WIN100 担保资产）
            </p>
          </div>
          <div className="space-y-1.5 opacity-75">
            <Label className="text-xs flex items-center gap-1.5">
              <Building2 className="h-3 w-3" />
              WIN100 担保出资比例
              <span className="ml-1 inline-flex h-4 items-center px-1.5 rounded-full border border-dashed border-warning/40 text-[9px] tracking-wide text-warning/90 bg-warning/5">
                当前版本固定
              </span>
            </Label>
            <div className="relative">
              <SettingsField
                type="number"
                name="subordinateRatio"
                value={form.subordinateRatio}
                onValueChange={handleSettingsFieldChange}
                className="font-mono font-semibold pr-10"
                disabled
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">
                %
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              WIN100 担保出资占比（默认 30%），按协议 3:7 比例买入标的股票作为履约担保
            </p>
          </div>
        </div>

        {/* Phase 5: 多档风控阈值配置 */}
        <div className="pt-4 border-t border-border/40 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <p className="text-sm font-bold">多档风控阈值</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1 h-8" onClick={addRiskTier}>
                <Plus className="h-3.5 w-3.5" />
                新增档位
              </Button>
              <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={resetRiskTiersConfig}>
                <RotateCcw className="h-3.5 w-3.5" />
                重置默认
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            每档独立设置跌幅阈值、通知渠道、通知对象和触发动作。系统按跌幅自动匹配最高档位。
          </p>
          <div className="space-y-2">
            {riskTiers.map((tier) => {
              const colorDot: Record<string, string> = {
                info: "bg-info",
                warning: "bg-warning",
                danger: "bg-danger",
                destructive: "bg-destructive",
              };
              return (
                <div
                  key={tier.id}
                  className={cn(
                    "rounded-lg border p-3 space-y-2 transition-colors",
                    tier.enabled ? "border-border/60 bg-secondary/20" : "border-dashed border-border/40 bg-secondary/10 opacity-70"
                  )}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("h-3 w-3 rounded-full shrink-0", colorDot[tier.color] ?? "bg-secondary")} />
                    <Input
                      value={tier.name}
                      onChange={(e) => updateRiskTier(tier.id, { name: e.target.value })}
                      className="h-8 w-28 text-xs font-semibold"
                      placeholder="档位名称"
                    />
                    <div className="relative w-20">
                      <Input
                        type="number"
                        value={tier.dropPercent}
                        onChange={(e) => updateRiskTier(tier.id, { dropPercent: Number(e.target.value) })}
                        className="h-8 pr-8 font-mono text-xs"
                        min={0}
                        max={100}
                        step={0.5}
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
                    </div>
                    <Select
                      value={tier.action}
                      onValueChange={(v) => updateRiskTier(tier.id, { action: v as TriggerAction })}
                    >
                      <SelectTrigger className="h-8 w-28 text-xs">
                        <SelectValue placeholder="触发动作" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="notify">仅通知</SelectItem>
                        <SelectItem value="margin_call">生成补仓指令</SelectItem>
                        <SelectItem value="liquidation">触发强平预案</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={tier.color}
                      onValueChange={(v) => updateRiskTier(tier.id, { color: v })}
                    >
                      <SelectTrigger className="h-8 w-20 text-xs">
                        <SelectValue placeholder="颜色" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">蓝色</SelectItem>
                        <SelectItem value="warning">黄色</SelectItem>
                        <SelectItem value="danger">红色</SelectItem>
                        <SelectItem value="destructive">深红</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-3 ml-auto">
                      <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={tier.enabled}
                          onChange={(e) => updateRiskTier(tier.id, { enabled: e.target.checked })}
                          className="rounded border-border accent-primary"
                        />
                        启用
                      </label>
                      {riskTiers.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-danger hover:bg-danger/10"
                          onClick={() => removeRiskTier(tier.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap pl-5">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="font-medium">通知:</span>
                      {(["email", "whatsapp", "sms"] as NotifyChannel[]).map((ch) => (
                        <label key={ch} className="flex items-center gap-1 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={tier.notifyChannels.includes(ch)}
                            onChange={(e) => {
                              const channels = e.target.checked
                                ? [...tier.notifyChannels, ch]
                                : tier.notifyChannels.filter((c) => c !== ch);
                              updateRiskTier(tier.id, { notifyChannels: channels });
                            }}
                            className="rounded border-border accent-primary"
                          />
                          {ch === "email" ? "邮件" : ch === "whatsapp" ? "WhatsApp" : "短信"}
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="font-medium">对象:</span>
                      {(["risk", "bd", "all"] as NotifyTarget[]).map((tg) => (
                        <label key={tg} className="flex items-center gap-1 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={tier.notifyTargets.includes(tg)}
                            onChange={(e) => {
                              const targets = e.target.checked
                                ? [...tier.notifyTargets, tg]
                                : tier.notifyTargets.filter((c) => c !== tg);
                              updateRiskTier(tier.id, { notifyTargets: targets });
                            }}
                            className="rounded border-border accent-primary"
                          />
                          {tg === "risk" ? "风控" : tg === "bd" ? "BD" : "全员"}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {(() => {
            const { valid, errors } = validateRiskTiers(riskTiers);
            if (valid) return null;
            return (
              <div className="flex items-start gap-1.5 text-[11px] text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div>
                  {errors.slice(0, 3).map((err, i) => (
                    <p key={i}>{err}</p>
                  ))}
                </div>
              </div>
            );
          })()}
          <div className="flex items-center gap-3">
            <Button className="gap-1.5" onClick={saveRiskTiersConfig}>
              <Save className="h-4 w-4" />
              保存多档阈值
            </Button>
            {saved === "riskTiers" && <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5" />已保存</Badge>}
          </div>
        </div>

        {/* Phase 6: 闪跌检测阈值配置 */}
        <div className="pt-4 border-t border-border/40 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-warning" />
              <h4 className="text-sm font-bold">闪跌检测阈值</h4>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addFlashCrashThreshold}>新增阈值</Button>
              <Button variant="outline" size="sm" onClick={resetFlashCrashConfig}>重置默认</Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            检测「N 分钟内跌幅超 X%」，即使未到击穿线也触发临时预警。默认：5 分钟 −10% / 15 分钟 −15%。
          </p>
          <div className="space-y-2">
            {flashCrashThresholds.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 p-2">
                <Input
                  type="number"
                  className="w-24"
                  min={1}
                  value={t.windowMinutes}
                  onChange={(e) => updateFlashCrashThreshold(i, { windowMinutes: Number(e.target.value) })}
                  placeholder="窗口(分)"
                />
                <span className="text-xs text-muted-foreground">分钟内跌幅 ≥</span>
                <Input
                  type="number"
                  className="w-20"
                  min={0.1}
                  max={100}
                  step={0.5}
                  value={t.dropPercent}
                  onChange={(e) => updateFlashCrashThreshold(i, { dropPercent: Number(e.target.value) })}
                  placeholder="跌幅%"
                />
                <span className="text-xs text-muted-foreground">%</span>
                <label className="flex items-center gap-1 text-xs ml-2">
                  <Checkbox
                    checked={t.enabled}
                    onCheckedChange={(v) => updateFlashCrashThreshold(i, { enabled: !!v })}
                  />
                  启用
                </label>
                {flashCrashThresholds.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-destructive hover:text-destructive"
                    onClick={() => removeFlashCrashThreshold(i)}
                  >
                    删除
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Button className="gap-1.5" onClick={saveFlashCrashConfig}>
              <Save className="h-4 w-4" />
              保存闪跌阈值
            </Button>
            {saved === "flashCrash" && <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5" />已保存</Badge>}
          </div>
        </div>

        <div className="pt-3 border-t border-border/40 flex items-center gap-3">
          <Button className="gap-1.5" onClick={() => save("risk")}>
            <Save className="h-4 w-4" />
            保存风控参数
          </Button>
          {saved === "risk" && <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5" />已保存</Badge>}
        </div>
      </CardContent>
    </Card>
    </RoleGate>

    {/* 风险预警弹窗 & 实时联动 */}
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <MonitorDot className="h-4 w-4 text-danger" />
          风险预警 & 实时联动
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="rounded-xl border border-border/50 bg-secondary/30 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                <p className="font-semibold text-sm">网页端风险弹窗</p>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                当批次进入预警或击穿状态时，自动弹出页面提醒
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm({ ...form, webAlertEnabled: !form.webAlertEnabled })}
              className={cn(
                "relative shrink-0 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                form.webAlertEnabled ? "bg-success" : "bg-border"
              )}
              role="switch"
              aria-checked={form.webAlertEnabled}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition-transform",
                  form.webAlertEnabled ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>
          <div className={cn(
            "mt-3 space-y-3 transition-opacity",
            form.webAlertEnabled ? "opacity-100" : "opacity-40 pointer-events-none"
          )}>
            <div className="flex items-center justify-between gap-4 py-1.5">
              <div>
                <p className="text-[12px] font-medium">弹窗提示音</p>
                <p className="text-[10.5px] text-muted-foreground">击穿批次弹窗时附带低频提示音</p>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, webAlertSound: !form.webAlertSound })}
                className={cn(
                  "relative shrink-0 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  form.webAlertSound ? "bg-success" : "bg-border"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg transition-transform",
                    form.webAlertSound ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
            <div className="flex items-center justify-between gap-4 py-1.5">
              <div>
                <p className="text-[12px] font-medium">仅击穿弹窗</p>
                <p className="text-[10.5px] text-muted-foreground">预警（15-20%）仅Badge闪烁，击穿才弹大窗</p>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, webAlertCriticalOnly: !form.webAlertCriticalOnly })}
                className={cn(
                  "relative shrink-0 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  form.webAlertCriticalOnly ? "bg-warning" : "bg-border"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg transition-transform",
                    form.webAlertCriticalOnly ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <RadioTower className="h-4 w-4 text-warning animate-pulse" />
                <p className="font-semibold text-sm">开盘状态实时股价联动</p>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                金额数据以跃动形式加载，开盘时段按周期刷新所有相关价格
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm({ ...form, realtimeTickEnabled: !form.realtimeTickEnabled })}
              className={cn(
                "relative shrink-0 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                form.realtimeTickEnabled ? "bg-primary" : "bg-border"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg transition-transform",
                  form.realtimeTickEnabled ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>
          <div className={cn(
            "mt-3 grid grid-cols-2 gap-4 transition-opacity",
            form.realtimeTickEnabled ? "opacity-100" : "opacity-40 pointer-events-none"
          )}>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Bell className="h-3 w-3" /> 刷新周期（秒）
              </Label>
              <div className="relative">
                <SettingsField
                  type="number"
                  name="realtimeTickIntervalSec"
                  value={form.realtimeTickIntervalSec}
                  onValueChange={handleSettingsFieldChange}
                  className="font-mono font-semibold pr-10"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">
                  s
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">推荐 5-10 秒</p>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-border/40 flex items-center gap-3 flex-wrap">
          <Button className="gap-1.5" onClick={() => save("alert")}>
            <Save className="h-4 w-4" />
            保存预警 & 联动配置
          </Button>
          {saved === "alert" && <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5" />已保存并生效</Badge>}
        </div>
      </CardContent>
    </Card>

    {/* 分成档位配置 */}
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Settings className="h-4 w-4" />
          分成档位配置
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <p className="text-xs text-muted-foreground">仅对保存后新签约的客户生效。老客户沿用签约比例，已结算金额保持冻结。</p>
        <label className="block text-xs text-muted-foreground">
          VIP 本金门槛（美元，含等于）
          <Input type="number" min="0.01" step="0.01" value={Number.isFinite(form.vipThreshold) ? form.vipThreshold : ""}
            onChange={(e) => setForm({ ...form, vipThreshold: e.target.value === "" ? NaN : Number(e.target.value) })}
            className="mt-1 font-mono tabular-nums" />
        </label>
        {[
          { threshold: form.vipThreshold, client: form.vipClient, inst: 100 - form.vipClient, label: "VIP 档位" },
          { threshold: 0, client: form.normalClient, inst: 100 - form.normalClient, label: "普通档位" },
        ].map((tier, idx) => (
          <div
            key={idx}
            className={cn(
              "rounded-xl border p-4 space-y-3",
              idx === 0
                ? "bg-primary/5 border-primary/30"
                : "bg-secondary/30 border-border/50"
            )}
          >
            <div className="flex items-center justify-between">
              <Badge
                variant={idx === 0 ? "primary" : "secondary"}
                className="text-[10px]"
              >
                {tier.label}
              </Badge>
              <span className="text-[11px] font-mono text-muted-foreground">
                {idx === 0 ? "≥" : "<"} ${Number(form.vipThreshold).toLocaleString()}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">客户</p>
                <div className="relative">
                  <Input
                    type="number"
                    min="0" max="100" step="0.01"
                    value={Number.isFinite(tier.client) ? tier.client : ""}
                    onChange={(e) => setForm({ ...form, [idx === 0 ? "vipClient" : "normalClient"]: e.target.value === "" ? NaN : Number(e.target.value) })}
                    className="h-9 font-mono font-bold text-xs pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">WIN100 担保</p>
                <div className="relative">
                  <Input
                    type="number"
                    value={Number.isFinite(tier.inst) ? tier.inst : ""}
                    readOnly
                    className="h-9 font-mono font-bold text-xs pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => save("分成配置")}>
          <Save className="h-3.5 w-3.5" />
          保存分成配置
        </Button>
      </CardContent>
    </Card>
      </div>
    </TabsContent>

    <TabsContent value="notify" className="space-y-6 mt-6 lg:grid lg:grid-cols-3 lg:gap-6 [&>div]:lg:col-span-2">
      <div className="space-y-6">
    {/* Notification Channels */}
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Bell className="h-4 w-4 text-warning" />
          通知渠道配置
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-5">
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3 text-xs">
          <p className="font-semibold">1. 配置服务商 → 2. 添加真实收件人 → 3. 点击测试并核对收件</p>
          <p className="text-muted-foreground">邮件与 WhatsApp 通道由系统管理员完成服务商配置后启用。授权密钥等敏感信息由管理员统一保管，无需在此填写。</p>
          <p className="text-muted-foreground">当前为手动发送；页面内的风险提示不等于已发出外部通知。「已受理」不代表已送达，请以收件箱或服务商回执为准。</p>
          <div className="flex flex-wrap gap-2 items-center">
            <Input type="password" aria-label="通知发送授权码" autoComplete="off" value={sendToken}
              onChange={(e) => setSendToken(e.target.value)} placeholder="管理员提供的发送授权码，仅本次会话有效"
              className="max-w-md text-xs" />
            <Button variant="outline" size="sm" onClick={() => {
              if (sendToken.trim().length < 32) { toast.error("授权码至少 32 位。"); return; }
              setNotificationSendToken(sendToken); setSendToken(""); setTokenReady(true);
              toast.success("发送授权码已暂存，刷新页面后需重新输入。");
            }}>{tokenReady ? "更新发送授权码" : "启用本次发送授权"}</Button>
            <Button variant="outline" size="sm" onClick={checkChannels}>检查服务配置</Button>
          </div>
          {channelStatus && (["email", "whatsapp"] as const).map((channel) => (
            <p key={channel} className={channelStatus[channel].ready ? "text-success" : "text-warning"}>
              {channel === "email" ? "邮件" : "WhatsApp"}：{channelStatus[channel].ready
                ? "配置已就绪，待实发验证"
                : channelStatus[channel].issues.join("；")}
            </p>
          ))}
        </div>
        <div className="rounded-xl border border-border/50 bg-secondary/30 p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                <Mail className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-sm">邮件通知通道</p>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0 -mt-0.5 -ml-1"
                    onClick={() => setHelpOpen("email-webhook")} title="如何配置邮件通知通道？">
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  用于触发补仓警报时，通知风控人员与 商务经理
                </p>
              </div>
            </div>
            {hydrated && form.emailWebhook ? (
              <Badge variant="success" className="gap-1 text-[10px]">
                <CheckCircle2 className="h-2.5 w-2.5" />
                已填地址，待验证
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Info className="h-2.5 w-2.5" />
                待配置
              </Badge>
            )}
          </div>
          <SettingsField
            name="emailWebhook"
            value={form.emailWebhook}
            onValueChange={handleSettingsFieldChange}
            placeholder="可选：留空使用系统默认配置；自定义地址须由管理员授权"
            className="font-mono text-xs"
          />
        </div>

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-success/15 border border-success/20 flex items-center justify-center shrink-0">
                <MessageCircle className="h-4 w-4 text-success" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-sm">WhatsApp 通知通道</p>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0 -mt-0.5 -ml-1"
                    onClick={() => setHelpOpen("whatsapp-webhook")} title="如何配置 WhatsApp 通知通道？">
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  紧急警报通过 WhatsApp 发送至相关人员手机
                </p>
              </div>
            </div>
            {hydrated && form.whatsappWebhook ? (
              <Badge variant="success" className="gap-1 text-[10px]">
                <CheckCircle2 className="h-2.5 w-2.5" />
                已填地址，待验证
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Info className="h-2.5 w-2.5" />
                待配置
              </Badge>
            )}
          </div>
          <SettingsField
            name="whatsappWebhook"
            value={form.whatsappWebhook}
            onValueChange={handleSettingsFieldChange}
            placeholder="可选：填入自建转发地址（HTTPS），留空则使用系统默认通道"
            className="font-mono text-xs"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">默认风控收件人</Label>
            <SettingsField
              name="defaultRiskEmail"
              value={form.defaultRiskEmail}
              onValueChange={handleSettingsFieldChange}
              className="text-xs font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">紧急联系人电话</Label>
            <SettingsField
              name="emergencyPhone"
              value={form.emergencyPhone}
              onValueChange={handleSettingsFieldChange}
              className="text-xs font-mono"
            />
          </div>
        </div>

        <div className="pt-3 border-t border-border/40 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button className="gap-1.5" onClick={() => save("notify")}>
              <Save className="h-4 w-4" />
              保存通知配置
            </Button>
            {saved === "notify" && <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5" />已保存</Badge>}
            <div className="h-6 w-px bg-border/50 mx-1 hidden sm:block" />
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => handleSendTest("email")}
              disabled={!!sendingTest}
            >
              <Mail className="h-3.5 w-3.5" />
              {sendingTest === "email" ? "发送中…" : "发送测试邮件"}
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => handleSendTest("whatsapp")}
              disabled={!!sendingTest}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {sendingTest === "whatsapp" ? "发送中…" : "发送测试 WhatsApp"}
            </Button>
          </div>
          {(testStatus.email || testStatus.whatsapp) && (
            <div className="space-y-1 text-[11px] font-mono">
              {testStatus.email && (
                <div className={cn(testStatus.email.startsWith("OK") ? "text-success" : "text-danger")}>
                  Email: {testStatus.email}
                </div>
              )}
              {testStatus.whatsapp && (
                <div className={cn(testStatus.whatsapp.startsWith("OK") ? "text-success" : "text-danger")}>
                  WhatsApp: {testStatus.whatsapp}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>

    {/* ========= 需求1新增：风控收件人管理 ========= */}
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              风控收件人管理
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              当前 {recipients.length} 位收件人 · 启用 {enabledCount} 位 · 可自由增删改（修改后立即生效）
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={resetRecipients}>
              清空收件人
            </Button>
            <Button size="sm" className="gap-1.5 h-8" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" />
              新增收件人
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {recipients.length === 0 && (
          <div className="text-center py-10 text-muted-foreground border rounded-xl border-dashed border-border/60">
            <UserPlus className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">暂无收件人</p>
            <p className="text-[11px] mt-0.5">点击右上角「新增收件人」添加</p>
          </div>
        )}
        {recipients.map((r) => (
          <div
            key={r.id}
            className={cn(
              "rounded-xl border p-4 transition-all",
              r.enabled
                ? "bg-card/70 border-border/60 hover:border-primary/30"
                : "bg-secondary/20 border-border/40 opacity-60"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-sm">{r.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {ROLE_LABELS[r.role]}
                  </Badge>
                  {r.enabled ? (
                    <Badge variant="success" className="text-[10px] gap-1">
                      <CheckCircle2 className="h-2.5 w-2.5" />启用</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">已停用</Badge>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" />{r.email}
                  </span>
                  {r.whatsapp && (
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />{displayWhatsApp(r.whatsapp)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => toggleEnabled(r.id, e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-muted-foreground">
                  {r.enabled ? "接收通知" : "已暂停接收"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
                  onClick={() => openEdit(r)}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-muted-foreground hover:text-danger hover:bg-danger/10"
                  onClick={() => removeRecipient(r.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
            </div>
          </div>
        ))}
        <div className="pt-2 flex items-center gap-3 flex-wrap">
          <Button className="gap-1.5" onClick={() => {
            try {
              setRiskRecipients(recipients);
              save("recipient");
            } catch {
              toast.error("收件人保存失败，请稍后重试。");
            }
          }}>
            <Save className="h-4 w-4" />
            保存收件人配置
          </Button>
          {saved === "recipient" && <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5" />已保存并生效</Badge>}
        </div>
      </CardContent>
    </Card>
      </div>
    </TabsContent>

    <TabsContent value="market" className="space-y-6 mt-6 lg:grid lg:grid-cols-3 lg:gap-6 [&>div]:lg:col-span-2">
      <div className="space-y-6">
    {/* 实时股票行情（TopBar 展示 & 系统设置） */}
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <LineChart className="h-4 w-4 text-primary" />
          实时股票行情 · 顶部展示
        </CardTitle>
        <p className="text-[11px] text-muted-foreground mt-1">
          设置后可在网站顶部展示股票代码、最新价格与当日涨跌幅；行情异常时自动沿用最近一次有效价格，不影响展示。
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-5">
        <div className="rounded-xl border border-border/50 bg-secondary/30 p-4">
          <div className="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
            <div>
              <p className="font-semibold text-sm">顶部导航实时预览</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                保存后，顶部导航会展示行情徽章（下方为当前配置的实时预览，每 {quote.refreshSec} 秒刷新一次价格）。
              </p>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {QUOTE_PROVIDERS.map((p) => (
                  <Badge key={p.id} variant="outline" className="gap-1 text-[10.5px]">
                    <RadioTower className="h-2.5 w-2.5" />
                    {p.label}
                  </Badge>
                ))}
              </div>
            </div>
            {(() => {
              const symbol = (quote.symbol || "").trim().toUpperCase();
              const price = quoteLive ? Number(quoteLive.price) : 41.88;
              const chg = quoteLive ? Number(quoteLive.changePct) : 0.36;
              const up = chg >= 0;
              const nyse = getNYSEInfo();
              return (
                <div className="shrink-0 inline-flex items-center gap-2.5 pl-3 pr-4 py-2 rounded-full border border-border/50 bg-background shadow-sm">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    {nyse.shouldBreathe && (
                      <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />
                    )}
                    <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", nyse.shouldBreathe ? "bg-success" : "bg-muted")} />
                  </span>
                  <div className="flex items-baseline gap-2">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-mono font-bold uppercase tracking-wider leading-none">
                        {symbol}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-lg tabular-nums tracking-tight">
                      ${Number(price || 0).toFixed(2)}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-mono font-semibold",
                        up ? quote.colorUp : quote.colorDown,
                        up ? "bg-success/10" : "bg-danger/10"
                      )}
                    >
                      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {up ? "+" : ""}
                      {Number(chg || 0).toFixed(2)}%
                    </span>
                    {quoteLive?.provider && (
                      <Badge variant="secondary" className="text-[10px] h-5">
                        {quoteProviderLabel(quoteLive.provider)}
                        {quoteLive.source !== "LIVE" && ` · ${quoteLive.source === "CACHE" ? "缓存" : "离线"}`}
                      </Badge>
                    )}
                    {quoteFetching && (
                      <Badge variant="outline" className="text-[10px] h-5 font-mono">
                        更新中…
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-xs">股票代码（必填，用于顶部行情展示）</Label>
            <Input
              className="mt-1.5 font-mono text-sm"
              placeholder="例：AAPL / NVDA / 0700.HK / 600519.SS"
              value={quote.symbol || ""}
              onChange={(e) => setQuote({ ...quote, symbol: String(e.target.value || "").toUpperCase() })}
            />
            <p className="text-[10.5px] text-muted-foreground mt-1.5">
              美股用 ticker，港股带 <code>.HK</code>，A 股带 <code>.SS / .SZ</code>；系统会依次请求 3 个公开源，命中第一个即返回。
            </p>
          </div>
          <div>
            <Label className="text-xs">刷新间隔（秒）</Label>
            <Input
              className="mt-1.5 font-mono"
              type="number"
              min={1}
              max={3600}
              step={1}
              value={String(quote.refreshSec)}
              onChange={(e) => setQuote({ ...quote, refreshSec: Math.max(1, Math.min(3600, Number(e.target.value) || 8)) })}
            />
          </div>
          <div className="md:col-span-2 flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={!!quote.showOnTopBar}
                onChange={(e) => setQuote({ ...quote, showOnTopBar: !!e.target.checked })}
              />
              <span>在顶部导航展示行情</span>
            </label>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">涨跌配色：</span>
              <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 bg-success/10", quote.colorUp)}>
                <TrendingUp className="h-3 w-3" /> 上涨
              </span>
              <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 bg-danger/10", quote.colorDown)}>
                <TrendingDown className="h-3 w-3" /> 下跌
              </span>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-border/40 flex items-center gap-3 flex-wrap">
          <Button
            className="gap-1.5"
            onClick={() => {
              try {
                if (!quote.symbol || !quote.symbol.trim()) {
                  toast.error("请先填写股票代码 Symbol（如 AAPL）");
                  return;
                }
                const next: LiveQuoteSettings = {
                  ...DEFAULT_LIVE_QUOTE,
                  ...quote,
                  symbol: quote.symbol.trim().toUpperCase(),
                  refreshSec: Math.max(1, Math.min(3600, Number(quote.refreshSec) || 8)),
                };
                setLiveQuoteSettings(next);
                setQuote(next);
                setSaved("quote");
                setTimeout(() => setSaved(null), 2200);
                toast.success(
                  `已保存：${next.symbol}（刷新间隔 ${next.refreshSec}s，顶部展示 ${next.showOnTopBar ? "开启" : "关闭"}）`
                );
              } catch (e) {
                console.error(e);
                toast.error("保存行情设置失败，请稍后重试。");
              }
            }}
          >
            <Save className="h-4 w-4" />
            保存行情设置（即时生效）
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setLiveQuoteSettings({ ...DEFAULT_LIVE_QUOTE });
              setQuote({ ...DEFAULT_LIVE_QUOTE });
              toast.success("已恢复默认行情设置。");
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            恢复默认
          </Button>
          {saved === "quote" && (
            <Badge variant="success" className="gap-1 text-[10px]">
              <CheckCircle2 className="h-2.5 w-2.5" />
              已保存 · 已同步
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>

    {/* Data Source */}
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Database className="h-4 w-4 text-success" />
          数据源配置
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-5">
        <div className="rounded-xl border border-border/50 bg-secondary/30 p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-warning/15 border border-warning/20 flex items-center justify-center shrink-0">
                <RadioTower className="h-4 w-4 text-warning" />
              </div>
              <div>
                <p className="font-semibold text-sm">股票行情数据源</p>
                <p className="text-[11px] text-muted-foreground">
                  支持 Yahoo Finance、Finnhub、Alpha Vantage
                </p>
              </div>
            </div>
            <Badge variant="success" className="gap-1 text-[10px]">
              <RadioTower className="h-2.5 w-2.5 animate-breath-warning" />
              {form.dataSource} 运行中
            </Badge>
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">选择数据源</Label>
              <select
                value={form.dataSource}
                onChange={(e) => setForm({ ...form, dataSource: e.target.value })}
                className="w-full mt-1.5 h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option>Yahoo Finance (免费)</option>
                <option>Finnhub</option>
                <option>Alpha Vantage</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">行情访问授权码</Label>
              <SettingsField
                type="password"
                name="apiKey"
                value={form.apiKey}
                onValueChange={handleSettingsFieldChange}
                placeholder="••••••••••••••••"
                className="mt-1.5 font-mono text-xs"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-success/15 border border-success/20 flex items-center justify-center shrink-0">
                <Database className="h-4 w-4 text-success" />
              </div>
              <div>
                <p className="font-semibold text-sm">数据存储服务</p>
                <p className="text-[11px] text-muted-foreground">
                 批次、客户、补仓与结算记录统一存储
                </p>
              </div>
            </div>
            <Badge variant="success" className="gap-1 text-[10px]">
              <CheckCircle2 className="h-2.5 w-2.5" />
              已连接
            </Badge>
          </div>
        </div>

        <div className="pt-3 border-t border-border/40 flex items-center gap-3">
          <Button className="gap-1.5" onClick={() => save("data")}>
            <Save className="h-4 w-4" />
            保存数据源配置
          </Button>
          {saved === "data" && <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5" />已保存</Badge>}
        </div>
      </CardContent>
    </Card>
      </div>
    </TabsContent>

    <TabsContent value="brand" className="space-y-6 mt-6 lg:grid lg:grid-cols-3 lg:gap-6 [&>div]:lg:col-span-2">
      <div className="space-y-6">
    {/* Branding Logo */}
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          品牌外观 · Logo
        </CardTitle>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          仅风控总监可修改，保存后全局生效
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="flex items-center gap-4 p-4 rounded-xl border border-border/50 bg-secondary/30">
          <div className="flex shrink-0 items-center justify-center">
            <Logo size={56} />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-sm font-semibold truncate">当前预览</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {logoDataUrl ? "✅ 自定义 Logo 已启用" : "使用系统默认渐变 Logo"}
            </p>
            {logoDataUrl && (
              <p className="text-[10.5px] text-primary/80 font-mono truncate">
                {(logoDataUrl.length / 1024).toFixed(1)} KB · data URL
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="gap-1.5 h-9"
            onClick={() => logoFileRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            上传 Logo 图片
          </Button>
          <input
            ref={logoFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
            className="hidden"
            onChange={onLogoInput}
          />
          <Button
            variant="ghost"
            className="gap-1.5 h-9 text-muted-foreground hover:text-foreground"
            onClick={resetLogo}
          >
            <RotateCcw className="h-4 w-4" />
            恢复默认
          </Button>
        </div>
        <div className="rounded-lg border border-dashed border-border/70 bg-background/30 p-3">
          <div className="flex items-start gap-2">
            <ImagePlus className="h-4 w-4 shrink-0 mt-0.5 text-primary/80" />
            <div className="min-w-0 space-y-0.5 text-[11px] text-muted-foreground">
              <p className="font-medium text-foreground/90">上传规范</p>
              <p>• 支持 PNG / JPG / WebP / SVG / GIF，最大 2MB</p>
              <p>• 建议尺寸 256×256 或更大的正方形图标</p>
              <p>• 透明背景 PNG 效果最佳，会自动应用阴影和圆角</p>
            </div>
          </div>
        </div>
        {saved === "logo" && <Badge variant="success" className="gap-1 text-[10px] w-fit"><CheckCircle2 className="h-2.5 w-2.5" />Logo 已保存</Badge>}
      </CardContent>
    </Card>
      </div>
    </TabsContent>

    <TabsContent value="account" className="space-y-6 mt-6 lg:grid lg:grid-cols-3 lg:gap-6 [&>div]:lg:col-span-2">
      <div className="space-y-6">
      <RoleGate
        allowed={[APP_ROLES.ADMIN]}
        auditAction="card_removed"
        auditResource="settings_account_management_card"
        fallback={
          <Card className="border-border/50">
            <CardContent className="pt-6 text-center py-10">
              <Lock className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="text-xs text-muted-foreground">仅系统管理员可管理系统账号</p>
            </CardContent>
          </Card>
        }
      >
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            系统账号管理
          </CardTitle>
          <Button size="sm" className="gap-1.5 h-8" onClick={openAddUser}>
            <Plus className="h-3.5 w-3.5" />
            新增账号
          </Button>
        </div>
        {saved === "user" && <Badge variant="success" className="mt-2 gap-1 text-[10px] w-fit"><CheckCircle2 className="h-2.5 w-2.5" />账号已保存</Badge>}
      </CardHeader>
      <CardContent className="pt-0">
        {users.length === 0 ? (
          <div className="text-center py-8 text-[11px] text-muted-foreground">
            <UserPlus className="h-6 w-6 mx-auto mb-2 opacity-50" />
            暂无自定义账号，点击右上角「新增账号」创建
          </div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5 bg-card/50",
                  !u.enabled && "opacity-60"
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <ClientAvatar name={u.bdManagerFullName || u.displayName} role={u.role} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      {u.displayName}
                      <Badge
                        variant={
                          u.role === "ADMIN"
                            ? "danger"
                            : u.role === "RISK_MANAGER"
                            ? "primary"
                            : u.role === "BD_MANAGER"
                            ? "warning"
                            : "outline"
                        }
                        className="text-[9px] h-4 px-1.5 rounded"
                      >
                        {SYSTEM_ROLE_LABELS[u.role]}
                      </Badge>
                      {!u.enabled && (
                        <Badge variant="secondary" className="text-[9px] h-4 px-1.5 rounded">
                          已停用
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10.5px] text-muted-foreground font-mono truncate max-w-[400px]">
                      <span>{u.email}</span>
                      {u.whatsapp && <span>· {displayWhatsApp(u.whatsapp)}</span>}
                      {u.bdManagerFullName && <span className="truncate">· {u.bdManagerFullName}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => toggleUserEnabled(u.id, !u.enabled)}
                      >
                        {u.enabled ? (
                          <Shield className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="text-[11px]">
                      {u.enabled ? "停用账号" : "启用账号"}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => openEditUser(u)}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-danger"
                    onClick={() => removeUser(u.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
    </RoleGate>
      </div>
    </TabsContent>

    <TabsContent value="audit" className="space-y-6 mt-6">
      <RoleGate
        allowed={[APP_ROLES.ADMIN, APP_ROLES.RISK_MANAGER]}
        auditAction="card_removed"
        auditResource="settings_audit_log_card"
        fallback={
          <Card className="border-border/50">
            <CardContent className="pt-6 text-center py-10">
              <p className="text-sm text-muted-foreground">当前角色无权限查看操作记录</p>
            </CardContent>
          </Card>
        }
      >
        <Card className="border-border/50">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-primary" />
              <div>
                <CardTitle className="text-sm font-bold">全员操作记录</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  共 {auditLogs.length} 条记录 · 不可修改或删除
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 border rounded-md p-1 bg-muted/30">
              <Search className="h-3.5 w-3.5 text-muted-foreground ml-2" />
              <Input
                className="h-7 w-44 border-0 bg-transparent shadow-none text-xs"
                placeholder="搜索操作人、行为或模块"
                value={auditSearchKw}
                onChange={(e) => setAuditSearchKw(e.target.value)}
              />
              </div>
              <div className="flex items-center gap-1">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <Select
                  value={auditFilterAction}
                  onValueChange={(v) => setAuditFilterAction(v as "__ALL__" | AuditAction)}
                >
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue placeholder="过滤行为" />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIT_ACTION_FILTER_OPTIONS.map((item) => (
                      <SelectItem key={item.value} value={item.value} className="text-xs">{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setAuditTick((x) => x + 1)}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />刷新
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="rounded-md border">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">时间</th>
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">操作行为</th>
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">操作人</th>
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">涉及模块</th>
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">操作详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const kw = auditSearchKw.trim().toLowerCase();
                      const filtered = auditLogs.filter((l) => {
                        if (auditFilterAction !== "__ALL__" && l.action !== auditFilterAction) return false;
                        if (!kw) return true;
                        const hay = [
                          l.actorEmail ?? "",
                          getAuditResourceLabel(l.resource),
                          getAuditActionLabel(l.action),
                          describeAuditLog(l),
                        ].join(" ").toLowerCase();
                        return hay.includes(kw);
                      });
                      if (!filtered.length) {
                        return (
                          <tr>
                            <td colSpan={5} className="text-center py-10 text-muted-foreground">
                              {hydrated ? "暂无操作记录" : "加载中…"}
                            </td>
                          </tr>
                        );
                      }
                      return filtered.slice(0, 500).map((l) => (
                        <tr key={l.id} className="border-t border-border/50 align-top">
                          <td className="px-3 py-2 font-mono whitespace-nowrap text-muted-foreground">
                            {formatDateTime(l.createdAt)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <Badge variant="outline" className={cn(
                              "text-[11px]",
                              /failed|denied|delete/.test(l.action) && "border-danger/60 text-danger",
                              /success|_create|_update|_topup|_settle|_notify/.test(l.action) && "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
                            )}>
                              {getAuditActionLabel(l.action)}
                            </Badge>
                            {l.role && <span className="ml-2 text-[10px] text-muted-foreground">{APP_ROLE_LABELS[l.role] ?? l.role}</span>}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {l.actorEmail ? (
                              <div className="flex items-center gap-1.5">
                                <ClientAvatar name={(l.actorEmail[0] ?? "?").toUpperCase()} size="xs" />
                                <span>{l.actorEmail}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic">匿名/未登录</span>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                            {getAuditResourceLabel(l.resource)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 text-[11px] text-muted-foreground max-w-[46ch] truncate">
                                {describeAuditLog(l)}
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[11px]"
                                onClick={() => setAuditOpenDetail(l)}
                              >
                                <Eye className="h-3 w-3 mr-1" />展开
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      </RoleGate>
    </TabsContent>

    <TabsContent value="about" className="space-y-6 mt-6 lg:grid lg:grid-cols-3 lg:gap-6 [&>div]:lg:col-span-2">
      <div className="space-y-6">
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Info className="h-4 w-4" />
          系统信息
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2 text-xs">
        {[
          { k: "系统名称", v: "RiskControl 风控预警平台" },
          { k: "服务状态", v: "运行中" },
        ].map((x) => (
          <div
            key={x.k}
            className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0"
          >
            <span className="text-muted-foreground">{x.k}</span>
            <span className="font-mono font-semibold">{x.v}</span>
          </div>
        ))}
      </CardContent>
    </Card>
    <Card className="border-danger/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2 text-danger">
          <Database className="h-4 w-4" />
          数据管理
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <p className="text-xs leading-6 text-muted-foreground">
          清空后，系统中的全部批次、客户、补仓与结算记录都会被移除，系统恢复为空白状态，可重新录入正式数据。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="h-6 font-mono text-[11px]">
            当前 {ledgerScale.batches} 个批次
          </Badge>
          <Badge variant="outline" className="h-6 font-mono text-[11px]">
            当前 {ledgerScale.clients} 位客户
          </Badge>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          清空前系统会自动留存一份数据备份，本次操作会记入操作记录且无法删除。
        </p>
        <Button
          variant="danger"
          size="sm"
          className="gap-1.5 font-semibold"
          disabled={ledgerScale.batches === 0 && ledgerScale.clients === 0}
          onClick={() => setClearDataOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          清空所有业务数据
        </Button>
      </CardContent>
    </Card>
      </div>
    </TabsContent>
  </Tabs>

{/* ========== 新增/编辑收件人 Dialog ========== */}
<Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
  <DialogContent className="sm:max-w-[520px]">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-primary" />
        {editingId ? "编辑收件人" : "新增风控收件人"}
      </DialogTitle>
    </DialogHeader>
    <div className="space-y-4 py-1">
      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1">
          <Users className="h-3 w-3" /> 姓名 / 称呼
        </Label>
        <Input
          placeholder="如：风控总监 - Evan Pan"
          value={rForm.name}
          onChange={(e) => setRForm({ ...rForm, name: e.target.value })}
          className={cn(rErrors.name && "ring-2 ring-danger/60 border-danger")}
        />
        {rErrors.name && <p className="text-[11px] text-danger">{rErrors.name}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">角色</Label>
          <Select
            value={rForm.role}
            onValueChange={(v) => setRForm({ ...rForm, role: v as any })}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_ORDER.map((r) => (
                <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 flex items-end">
          <div className="flex items-center gap-2 h-9 px-3 w-full rounded-md border border-input bg-background">
            <input
              type="checkbox"
              checked={rForm.enabled}
              onChange={(e) => setRForm({ ...rForm, enabled: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-xs text-muted-foreground ml-2">
              {rForm.enabled ? "启用通知" : "停用"}
            </span>
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1">
          <Mail className="h-3 w-3" /> 邮箱
        </Label>
        <Input
          type="email"
          placeholder="evan@institution.com"
          value={rForm.email}
          onChange={(e) => setRForm({ ...rForm, email: e.target.value })}
          className={cn("font-mono text-xs", rErrors.email && "ring-2 ring-danger/60 border-danger")}
        />
        {rErrors.email && <p className="text-[11px] text-danger">{rErrors.email}</p>}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1">
          <MessageCircle className="h-3 w-3" /> WhatsApp（选填）
        </Label>
        <div className="grid grid-cols-[160px_1fr] gap-2">
          <Select value={rWA.code} onValueChange={(v) => setRWA({ ...rWA, code: v })}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRY_CODES.map((c) => (
                <SelectItem key={c.code} value={c.code} className="text-xs">
                  {c.code === "CUSTOM" ? c.label : `${c.label} (${c.code})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {rWA.code !== "CUSTOM" ? (
            <Input
              placeholder="本地号码，如 91234567"
              value={rWA.local}
              onChange={(e) => setRWA({ ...rWA, local: e.target.value.replace(/[^\d]/g, "") })}
              className="font-mono text-xs h-9"
              maxLength={20}
            />
          ) : (
            <Input
              placeholder="手动输入完整号码，如 +000-000000"
              value={rWA.customRaw}
              onChange={(e) => setRWA({ ...rWA, customRaw: e.target.value })}
              className="font-mono text-xs h-9"
              maxLength={40}
            />
          )}
        </div>
        {rWA.code !== "CUSTOM" && rWA.local && (
          <p className="text-[10.5px] text-muted-foreground">
            预览：<span className="font-mono text-foreground">{rWA.code}-{rWA.local}</span>
          </p>
        )}
      </div>
    </div>
    <DialogFooter className="gap-2 sm:gap-2">
      <Button variant="outline" onClick={() => setDlgOpen(false)}>
        取消
      </Button>
      <Button onClick={saveRecipient} className="gap-1.5">
        <CheckCircle2 className="h-4 w-4" />
        {editingId ? "保存修改" : "确认新增"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

{/* ========== 新增/编辑账号 Dialog ========== */}
<Dialog open={userDlgOpen} onOpenChange={setUserDlgOpen}>
  <DialogContent className="sm:max-w-[560px]">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-primary" />
        {editingUserId ? "编辑系统账号" : "新增系统账号"}
      </DialogTitle>
    </DialogHeader>
    <div className="space-y-4 py-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1">
            <Users className="h-3 w-3" /> 姓名 *
          </Label>
          <Input
            placeholder="如：陈大文 (Damon Chen)"
            value={uForm.displayName}
            onChange={(e) => setUForm({ ...uForm, displayName: e.target.value })}
            className={cn(uErrors.displayName && "ring-2 ring-danger/60 border-danger")}
          />
          {uErrors.displayName && (
            <p className="text-[11px] text-danger">{uErrors.displayName}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1">
            <Mail className="h-3 w-3" /> 邮箱 *
          </Label>
          <Input
            type="email"
            placeholder="damon@institution.com"
            value={uForm.email}
            onChange={(e) => setUForm({ ...uForm, email: e.target.value })}
            className={cn(
              "font-mono text-xs",
              uErrors.email && "ring-2 ring-danger/60 border-danger"
            )}
          />
          {uErrors.email && <p className="text-[11px] text-danger">{uErrors.email}</p>}
        </div>
      </div>
      {/* 统一默认头像 */}
      <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-secondary/20 px-4 py-3">
        <ClientAvatar name={uForm.bdManagerFullName || uForm.displayName || "用户"} role={uForm.role} size="xl" />
        <div className="flex-1 min-w-0 space-y-1">
          <Label className="text-xs flex items-center gap-1">
            账户默认头像
          </Label>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            根据姓名自动生成，全站风格一致，无需上传。
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">角色</Label>
          <Select
            value={uForm.role}
            onValueChange={(v) => setUForm({ ...uForm, role: v as any })}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currentRole === APP_ROLES.ADMIN && (
                <SelectItem value="ADMIN" className="text-danger">⚡ 系统管理员（最高权限）</SelectItem>
              )}
              <SelectItem value="RISK_MANAGER">风控总监（全局权限）</SelectItem>
              <SelectItem value="BD_MANAGER">商务经理（仅管辖客户）</SelectItem>
              <SelectItem value="OPERATIONS">运营（只读/录入）</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 flex items-end">
          <div className="flex items-center gap-2 h-9 px-3 w-full rounded-md border border-input bg-background">
            <input
              type="checkbox"
              checked={uForm.enabled}
              onChange={(e) => setUForm({ ...uForm, enabled: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-xs text-muted-foreground ml-2">
              {uForm.enabled ? "账号启用" : "账号已停用"}
            </span>
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1">
          <MessageCircle className="h-3 w-3" /> WhatsApp（选填）
        </Label>
        <div className="grid grid-cols-[160px_1fr] gap-2">
          <Select value={uWA.code} onValueChange={(v) => setUWA({ ...uWA, code: v })}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRY_CODES.map((c) => (
                <SelectItem key={c.code} value={c.code} className="text-xs">
                  {c.code === "CUSTOM" ? c.label : `${c.label} (${c.code})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {uWA.code !== "CUSTOM" ? (
            <Input
              placeholder="本地号码，如 91234567"
              value={uWA.local}
              onChange={(e) => setUWA({ ...uWA, local: e.target.value.replace(/[^\d]/g, "") })}
              className="font-mono text-xs h-9"
              maxLength={20}
            />
          ) : (
            <Input
              placeholder="手动输入完整号码，如 +000-000000"
              value={uWA.customRaw}
              onChange={(e) => setUWA({ ...uWA, customRaw: e.target.value })}
              className="font-mono text-xs h-9"
              maxLength={40}
            />
          )}
        </div>
        {uWA.code !== "CUSTOM" && uWA.local && (
          <p className="text-[10.5px] text-muted-foreground">
            预览：<span className="font-mono text-foreground">{uWA.code}-{uWA.local}</span>
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1">
            <Shield className="h-3 w-3" /> {editingUserId ? "登录密码（留空不修改）" : "登录密码 *"}
          </Label>
          <Input
            type="password"
            placeholder="至少 6 位字符"
            value={uForm.password ?? ""}
            onChange={(e) => setUForm({ ...uForm, password: e.target.value })}
            className={cn("font-mono text-xs", uErrors.password && "ring-2 ring-danger/60 border-danger")}
          />
          {uErrors.password && <p className="text-[11px] text-danger">{uErrors.password}</p>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1">
            <Shield className="h-3 w-3" /> {editingUserId ? "确认密码（留空不修改）" : "确认密码 *"}
          </Label>
          <Input
            type="password"
            placeholder="再次输入相同密码"
            value={uForm.confirmPassword ?? ""}
            onChange={(e) => setUForm({ ...uForm, confirmPassword: e.target.value })}
            className={cn("font-mono text-xs", uErrors.confirmPassword && "ring-2 ring-danger/60 border-danger")}
          />
          {uErrors.confirmPassword && <p className="text-[11px] text-danger">{uErrors.confirmPassword}</p>}
        </div>
      </div>
      {uForm.role === "BD_MANAGER" && (
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1">
            <UserPlus className="h-3 w-3" /> 商务经理归属全称（选填）
          </Label>
          <Input
            placeholder="如：王思远 (Sylvia Wang) — 用于客户表单自动归属"
            value={uForm.bdManagerFullName ?? ""}
            onChange={(e) => setUForm({ ...uForm, bdManagerFullName: e.target.value })}
            className="text-xs"
          />
        </div>
      )}
    </div>
    <DialogFooter className="gap-2 sm:gap-2">
      <Button variant="outline" onClick={() => setUserDlgOpen(false)}>
        取消
      </Button>
      <Button onClick={() => void saveUser()} className="gap-1.5">
        <CheckCircle2 className="h-4 w-4" />
        {editingUserId ? "保存修改" : "创建账号"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
<ConfirmDialog
  open={clearDataOpen}
  onOpenChange={(open) => { if (!open && !clearingData) setClearDataOpen(false); }}
  tone="danger"
  title="确认清空所有业务数据？"
  description="清空后系统将回到空白状态，所有批次、客户、补仓与结算记录都会从工作台移除，页面将不再展示任何历史数据。请确认当前数据已无需保留。"
  confirmText="确认清空"
  cancelText="取消"
  confirmLoading={clearingData}
  summary={[
    { label: "待清空批次", value: `${ledgerScale.batches} 个`, accent: "danger" },
    { label: "待清空客户", value: `${ledgerScale.clients} 位`, accent: "danger" },
  ]}
  onConfirm={handleClearAllData}
/>
<ConfirmDialog
  open={!!confirmation}
  onOpenChange={(open) => { if (!open) setConfirmation(null); }}
  title={confirmation?.title}
  onConfirm={() => confirmation?.run()}
/>

<Dialog open={!!auditOpenDetail} onOpenChange={(open) => { if (!open) setAuditOpenDetail(null); }}>
  <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2 text-sm font-bold">
        <ScrollText className="h-4 w-4 text-primary" />
        操作详情
      </DialogTitle>
    </DialogHeader>
    {auditOpenDetail && (
      <div className="space-y-4 text-xs">
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
          <Badge variant="outline" className="text-[11px]">{getAuditActionLabel(auditOpenDetail.action)}</Badge>
          <p className="mt-2 text-[12.5px] leading-6 text-foreground">{describeAuditLog(auditOpenDetail)}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-muted-foreground">操作时间</p>
            <p>{formatDateTime(auditOpenDetail.createdAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">操作人</p>
            <p>
              {auditOpenDetail.actorEmail ?? "匿名/未登录"}
              {auditOpenDetail.role ? <span className="ml-1 text-muted-foreground">· {APP_ROLE_LABELS[auditOpenDetail.role] ?? auditOpenDetail.role}</span> : null}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">涉及模块</p>
            <p>{getAuditResourceLabel(auditOpenDetail.resource)}</p>
          </div>
        </div>
        {(() => {
          const fields = getAuditDetailFields(auditOpenDetail);
          if (!fields.length) return null;
          return (
            <div>
              <p className="mb-2 text-muted-foreground">操作内容</p>
              <div className="rounded-md border divide-y divide-border/50">
                {fields.map((field, idx) => (
                  <div key={`${field.label}-${idx}`} className="flex items-start justify-between gap-4 px-3 py-2">
                    <span className="shrink-0 text-muted-foreground">{field.label}</span>
                    <span className="text-right font-medium break-all">{field.value}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    )}
  </DialogContent>
</Dialog>

{/* ====== 通知渠道配置帮助 Dialog（需求4）====== */}
<Dialog
  open={!!helpOpen}
  onOpenChange={(o) => { if (!o) setHelpOpen(null); }}
>
  <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        {helpOpen === "email-webhook" ? <Mail className="h-4 w-4 text-primary" /> : <MessageCircle className="h-4 w-4 text-success" />}
        {helpOpen ? HELP_CONTENT[helpOpen].title : ""}
      </DialogTitle>
      <DialogDescription className="text-[11.5px]">
        按顺序完成以下步骤即可启用外部通知。
      </DialogDescription>
    </DialogHeader>
    {helpOpen && (
      <div className="space-y-5 pt-1">
        <ol className="space-y-4">
          {HELP_CONTENT[helpOpen].steps.map((s, i) => (
            <li key={i} className="space-y-1.5">
              <p className="text-xs font-semibold tracking-wide text-foreground">{s.h}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.p}</p>
            </li>
          ))}
        </ol>
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-1.5">
          <p className="text-[11px] font-semibold text-warning flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" />
            注意事项 & 常见问题
          </p>
          <ul className="list-disc list-inside space-y-1 text-[11px] text-muted-foreground leading-relaxed">
            {HELP_CONTENT[helpOpen].tips.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      </div>
    )}
    <DialogFooter>
      <Button variant="outline" onClick={() => setHelpOpen(null)}>我知道了</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

</div>
  </AuthGuard>
  );
}
