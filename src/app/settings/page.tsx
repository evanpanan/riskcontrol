"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { APP_ROLES } from "@/types/auth";
import { INSTITUTION_ROLES } from "@/lib/auth";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useMemo, useRef } from "react";
import { Logo, getStoredLogo, setStoredLogo } from "@/components/branding/Logo";
import { ClientAvatar } from "@/components/branding/ClientAvatar";
import {
  DEFAULT_RISK_RECIPIENTS,
  RiskRecipient,
  getRiskRecipients,
  setRiskRecipients,
} from "@/lib/riskRecipients";
import { sendTestNotification, setNotificationSendToken, hasNotificationSendToken } from "@/lib/notifier";
import type { notificationReadiness } from "@/lib/server/notificationDelivery";

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
}

type UserFormState = Omit<SystemAppUser, "id" | "createdAt" | "avatarInitials"> & {
  id?: string;
};

const emptyUserForm = (): UserFormState => ({
  displayName: "",
  email: "",
  role: "BD_MANAGER",
  whatsapp: "",
  bdManagerFullName: "",
  avatarDataUrl: "",
  enabled: true,
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

export default function SettingsPage() {
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ title: string; run: () => void } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [form, setForm] = useState<SettingsFormState>(() => DEFAULT_FORM);
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
    catch { toast.error("收件人保存失败，请检查浏览器存储。"); }
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

  // 系统账号管理
  const [users, setUsers] = useState<SystemAppUser[]>(() => []);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(USERS_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setUsers(parsed);
      }
    } catch (e) {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(USERS_LS_KEY, JSON.stringify(users));
    } catch (e) {}
  }, [users]);
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
    setUErrors(errs);
    return Object.keys(errs).length === 0;
  };
  const saveUser = () => {
    if (!validateUser()) return;
    const waFinal = buildWhatsApp(uWA.code, uWA.local, uWA.customRaw);
    const nameTrim = uForm.displayName.trim();
    const initials = computeInitials(nameTrim, uForm.email);
    const avatarDataUrl = uForm.avatarDataUrl || undefined;
    let nextList: SystemAppUser[];
    if (editingUserId) {
      nextList = users.map((u) =>
        u.id === editingUserId
          ? {
              ...u,
              ...uForm,
              id: editingUserId,
              avatarInitials: initials || u.avatarInitials,
              avatarDataUrl,
              whatsapp: waFinal || undefined,
            }
          : u
      );
      setUsers(nextList);
    } else {
      const newU: SystemAppUser = {
        id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        displayName: nameTrim,
        email: uForm.email.trim(),
        role: uForm.role,
        whatsapp: waFinal || undefined,
        bdManagerFullName: uForm.bdManagerFullName?.trim() || undefined,
        avatarInitials: initials,
        avatarDataUrl,
        enabled: !!uForm.enabled,
        createdAt: new Date().toISOString(),
      };
      nextList = [...users, newU];
      setUsers(nextList);
    }
    try {
      localStorage.setItem(USERS_LS_KEY, JSON.stringify(nextList));
    } catch (e) {}
    setSaved("user");
    setUserDlgOpen(false);
  };
  const removeUser = (id: string) => {
    setConfirmation({ title: "确认删除该账号？", run: () => setUsers((list) => list.filter((u) => u.id !== id)) });
  };
  const toggleUserEnabled = (id: string, enabled: boolean) => {
    setUsers((list) => list.map((u) => (u.id === id ? { ...u, enabled } : u)));
  };

  const save = (label: string) => {
    if (label === "notify") {
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
      localStorage.setItem(LS_KEY, JSON.stringify({
        ...form, ...rates, vipInstitution: 100 - rates.vipClient, normalInstitution: 100 - rates.normalClient,
        ...notificationFields,
      }));
    } catch {
      toast.error("配置保存失败，请检查浏览器存储后重试。");
      return;
    }
    if (label === "分成配置") toast.success("分成配置已保存，仅对新签约客户生效。");
    setSaved(label);
    setTimeout(() => setSaved(null), 2200);
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

  const Field = (props: any) => (
    <Input
      {...props}
      onChange={(e: any) => setForm({ ...form, [props.name as keyof SettingsFormState]: e.target.value } as any)}
      defaultValue={undefined}
      value={(form as any)[props.name] ?? props.defaultValue ?? ""}
    />
  );

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
      配置风控参数、通知渠道与 API 集成
    </p>
  </div>

  <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
    <div className="lg:col-span-2 space-y-6">
      {/* Risk Thresholds */}
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
              <Field type="number" name="warningThreshold" className="font-mono font-semibold pr-10" />
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
              <Field type="number" name="marginThreshold" className="font-mono font-semibold pr-10 text-danger" />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">
                %
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              触发后立即发送补仓警报（默认 20%）
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Building2 className="h-3 w-3" />
              优先出资比例
            </Label>
            <div className="relative">
              <Field type="number" name="priorityRatio" className="font-mono font-semibold pr-10" />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">
                %
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              客户优先出资占比（默认 70%）
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Building2 className="h-3 w-3" />
              劣后出资比例
            </Label>
            <div className="relative">
              <Field type="number" name="subordinateRatio" className="font-mono font-semibold pr-10" />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">
                %
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              机构劣后出资占比（默认 30%）
            </p>
          </div>
        </div>
        <div className="pt-3 border-t border-border/40 flex items-center gap-3">
          <Button className="gap-1.5" onClick={() => save("risk")}>
            <Save className="h-4 w-4" />
            保存风控参数
          </Button>
          {saved === "risk" && <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5" />已保存到本地</Badge>}
        </div>
      </CardContent>
    </Card>

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
                当批次进入预警或击穿状态时，自动弹出浏览器级弹窗提醒
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
                <Field
                  type="number"
                  name="realtimeTickIntervalSec"
                  className="font-mono font-semibold pr-10"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">
                  s
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">推荐 5-10 秒，避免 API 限流</p>
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
          <p className="text-muted-foreground">邮件推荐 Resend：管理员配置 API Key 和已验证发件域名。WhatsApp 推荐 Twilio：配置企业号码、收件人授权及审核通过的消息模板。密钥只放服务器，不填入 Webhook 地址。</p>
          <p className="text-muted-foreground">当前为按钮手动发送；网页风险弹窗不等于已发送外部通知。“已受理”不代表已送达，需查看收件箱或服务商回执。</p>
          <div className="flex flex-wrap gap-2 items-center">
            <Input type="password" aria-label="通知发送授权码" autoComplete="off" value={sendToken}
              onChange={(e) => setSendToken(e.target.value)} placeholder="管理员提供的发送授权码，仅当前页面会话保留"
              className="max-w-md text-xs" />
            <Button variant="outline" size="sm" onClick={() => {
              if (sendToken.trim().length < 32) { toast.error("授权码至少32位。"); return; }
              setNotificationSendToken(sendToken); setSendToken(""); setTokenReady(true);
              toast.success("发送授权码已暂存，本页刷新后需重新输入。");
            }}>{tokenReady ? "更新发送授权码" : "启用本次发送授权"}</Button>
            <Button variant="outline" size="sm" onClick={checkChannels}>检查服务配置</Button>
          </div>
          {channelStatus && (["email", "whatsapp"] as const).map((channel) => (
            <p key={channel} className={channelStatus[channel].ready ? "text-success" : "text-warning"}>
              {channel === "email" ? "邮件" : "WhatsApp"}：{channelStatus[channel].ready
                ? `${channelStatus[channel].provider} 配置已就绪，待实发验证`
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
                <p className="font-semibold text-sm">Email Webhook</p>
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
          <Field name="emailWebhook" placeholder="可选：留空使用服务端配置；自定义地址须由管理员在服务端授权" className="font-mono text-xs" />
        </div>

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-success/15 border border-success/20 flex items-center justify-center shrink-0">
                <MessageCircle className="h-4 w-4 text-success" />
              </div>
              <div>
                <p className="font-semibold text-sm">WhatsApp Business Webhook</p>
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
          <Field name="whatsappWebhook" placeholder="可选：Make / n8n Webhook，不能直接填 Meta API 地址" className="font-mono text-xs" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">默认风控收件人</Label>
            <Field name="defaultRiskEmail" className="text-xs font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">紧急联系人电话</Label>
            <Field name="emergencyPhone" className="text-xs font-mono" />
          </div>
        </div>

        <div className="pt-3 border-t border-border/40 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button className="gap-1.5" onClick={() => save("notify")}>
              <Save className="h-4 w-4" />
              保存通知配置
            </Button>
            {saved === "notify" && <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5" />已保存到本地</Badge>}
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
              toast.error("收件人保存失败，请检查浏览器存储后重试。");
            }
          }}>
            <Save className="h-4 w-4" />
            保存收件人配置
          </Button>
          {saved === "recipient" && <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5" />已保存并生效</Badge>}
        </div>
      </CardContent>
    </Card>

    {/* Data Source */}
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Database className="h-4 w-4 text-success" />
          数据源 & API 集成
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
                <p className="font-semibold text-sm">股票行情 API</p>
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
              <Label className="text-xs">API Key</Label>
              <Field type="password" name="apiKey" placeholder="••••••••••••••••" className="mt-1.5 font-mono text-xs" />
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
                <p className="font-semibold text-sm">Supabase / PostgreSQL</p>
                <p className="text-[11px] text-muted-foreground">
                  主数据库连接 · 批次、客户、补仓记录存储
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
          {saved === "data" && <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5" />已保存到本地</Badge>}
        </div>
      </CardContent>
    </Card>
  </div>

  <div className="space-y-6">
    {/* Branding Logo */}
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          品牌外观 · Logo
        </CardTitle>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          仅风控总监可修改，保存后全局生效（本地持久化）
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
                <p className="text-[10px] text-muted-foreground mb-1">机构</p>
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

    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Info className="h-4 w-4" />
          系统信息
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2 text-xs">
        {[
          { k: "系统版本", v: "v2.0.1 Professional" },
          { k: "构建时间", v: "2026-09-19 15:42" },
          { k: "Next.js", v: "14.2.8" },
          { k: "Prisma ORM", v: "5.18.0" },
          { k: "UI 框架", v: "Shadcn UI + Tailwind" },
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
  </div>
</div>

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
              <SelectItem value="ADMIN" className="text-danger">⚡ 系统管理员（最高权限）</SelectItem>
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
      <Button onClick={saveUser} className="gap-1.5">
        <CheckCircle2 className="h-4 w-4" />
        {editingUserId ? "保存修改" : "创建账号"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
<ConfirmDialog
  open={!!confirmation}
  onOpenChange={(open) => { if (!open) setConfirmation(null); }}
  title={confirmation?.title}
  onConfirm={() => confirmation?.run()}
/>
</div>
  </AuthGuard>
  );
}
