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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import {
  DEFAULT_RISK_RECIPIENTS,
  RiskRecipient,
  getRiskRecipients,
  setRiskRecipients,
} from "@/lib/riskRecipients";

const LS_KEY = "risk_control_settings";
const RECIPIENTS_LS_KEY = "risk_control_recipients";
const USERS_LS_KEY = "risk_control_users_v1";

interface SystemAppUser {
  id: string;
  displayName: string;
  email: string;
  role: "RISK_MANAGER" | "BD_MANAGER" | "OPERATIONS";
  whatsapp?: string;
  bdManagerFullName?: string;
  avatarInitials: string;
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
  enabled: true,
});

const SYSTEM_ROLE_LABELS: Record<SystemAppUser["role"], string> = {
  RISK_MANAGER: "风控总监",
  BD_MANAGER: "BD经理",
  OPERATIONS: "运营",
};

const ROLE_LABELS: Record<RiskRecipient["role"], string> = {
  RISK_MANAGER: "风控经理",
  RISK_ANALYST: "风控分析师",
  RISK_DIRECTOR: "风控总监",
  BD_MANAGER: "BD经理",
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

export default function SettingsPage() {
  const [saved, setSaved] = useState<string | null>(null);
  const [form, setForm] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      warningThreshold: 15,
      marginThreshold: 20,
      priorityRatio: 70,
      subordinateRatio: 30,
      emailWebhook: "https://api.example.com/email-webhook",
      whatsappWebhook: "",
      defaultRiskEmail: "risk-control@institution.com",
      emergencyPhone: "+852-9123-4567",
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
  });
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(form));
    } catch (e) {}
  }, [form]);

  // 收件人：持久化 + 联动 riskRecipients global
  const [recipients, setRecipients] = useState<RiskRecipient[]>(() => {
    try {
      const raw = localStorage.getItem(RECIPIENTS_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRiskRecipients(parsed);
          return parsed;
        }
      }
    } catch (e) {}
    return getRiskRecipients();
  });
  useEffect(() => {
    try {
      localStorage.setItem(RECIPIENTS_LS_KEY, JSON.stringify(recipients));
    } catch (e) {}
    setRiskRecipients(recipients);
  }, [recipients]);

  // 新增/编辑收件人 Dialog
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rForm, setRForm] = useState<RecipientFormState>(emptyForm());
  const [rErrors, setRErrors] = useState<Record<string, string>>({});

  // 系统账号管理
  const [users, setUsers] = useState<SystemAppUser[]>(() => {
    try {
      const raw = localStorage.getItem(USERS_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  });
  useEffect(() => {
    try {
      localStorage.setItem(USERS_LS_KEY, JSON.stringify(users));
    } catch (e) {}
  }, [users]);
  const [userDlgOpen, setUserDlgOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [uForm, setUForm] = useState<UserFormState>(emptyUserForm());
  const [uErrors, setUErrors] = useState<Record<string, string>>({});

  const openAddUser = () => {
    setEditingUserId(null);
    setUForm(emptyUserForm());
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
      enabled: u.enabled,
    });
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
    const nameTrim = uForm.displayName.trim();
    const initials = nameTrim
      .split(/\s+/)
      .map((s) => s[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
    let nextList: SystemAppUser[];
    if (editingUserId) {
      nextList = users.map((u) =>
        u.id === editingUserId
          ? { ...u, ...uForm, id: editingUserId, avatarInitials: initials || u.avatarInitials }
          : u
      );
      setUsers(nextList);
    } else {
      const newU: SystemAppUser = {
        id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        displayName: nameTrim,
        email: uForm.email.trim(),
        role: uForm.role,
        whatsapp: uForm.whatsapp?.trim() || undefined,
        bdManagerFullName: uForm.bdManagerFullName?.trim() || undefined,
        avatarInitials: initials || "US",
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
    if (!confirm("确认删除该账号？")) return;
    setUsers((list) => list.filter((u) => u.id !== id));
  };
  const toggleUserEnabled = (id: string, enabled: boolean) => {
    setUsers((list) => list.map((u) => (u.id === id ? { ...u, enabled } : u)));
  };

  const save = (label: string) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(form));
    } catch (e) {}
    setSaved(label);
    setTimeout(() => setSaved(null), 2200);
  };

  const openAdd = () => {
    setEditingId(null);
    setRForm(emptyForm());
    setRErrors({});
    setDlgOpen(true);
  };
  const openEdit = (r: RiskRecipient) => {
    setEditingId(r.id);
    setRForm({ ...r });
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
    let nextList: RiskRecipient[];
    if (editingId) {
      nextList = recipients.map(r =>
        r.id === editingId ? ({ ...r, ...rForm, id: editingId } as RiskRecipient) : r
      );
      setRecipients(nextList);
    } else {
      const newR: RiskRecipient = {
        id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: rForm.name.trim(),
        role: rForm.role,
        email: rForm.email.trim(),
        whatsapp: rForm.whatsapp?.trim() || undefined,
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
    if (!confirm("确认删除该收件人？")) return;
    setRecipients((list) => list.filter(r => r.id !== id));
  };
  const toggleEnabled = (id: string, enabled: boolean) => {
    setRecipients((list) => list.map(r => r.id === id ? { ...r, enabled } : r));
  };
  const resetRecipients = () => {
    if (!confirm("确认恢复为默认 8 位收件人？当前配置将丢失。")) return;
    setRecipients([...DEFAULT_RISK_RECIPIENTS]);
  };

  const Field = (props: any) => (
    <Input
      {...props}
      onChange={(e: any) => setForm({ ...form, [props.name]: e.target.value })}
      defaultValue={undefined}
      value={form[props.name] ?? props.defaultValue ?? ""}
    />
  );

  const enabledCount = recipients.filter(r => r.enabled).length;

  return (
    <AuthGuard route="/settings" allowed={[APP_ROLES.RISK_MANAGER]}>
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
        <div className="rounded-xl border border-border/50 bg-secondary/30 p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                <Mail className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">Email Webhook</p>
                <p className="text-[11px] text-muted-foreground">
                  用于触发补仓警报时，通知风控人员与 BD 经理
                </p>
              </div>
            </div>
            <Badge variant="success" className="gap-1 text-[10px]">
              <CheckCircle2 className="h-2.5 w-2.5" />
              已配置
            </Badge>
          </div>
          <Field name="emailWebhook" placeholder="https://api.example.com/email-webhook" className="font-mono text-xs" />
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
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Info className="h-2.5 w-2.5" />
              待配置
            </Badge>
          </div>
          <Field name="whatsappWebhook" placeholder="https://api.whatsapp.com/send..." className="font-mono text-xs" />
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

        <div className="pt-3 border-t border-border/40 flex items-center gap-3">
          <Button className="gap-1.5" onClick={() => save("notify")}>
            <Save className="h-4 w-4" />
            保存通知配置
          </Button>
          {saved === "notify" && <Badge variant="success" className="gap-1 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5" />已保存到本地</Badge>}
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
              恢复默认
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
                      <MessageCircle className="h-3 w-3" />{r.whatsapp}
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
            try { localStorage.setItem(RECIPIENTS_LS_KEY, JSON.stringify(recipients)); } catch(e){}
            setRiskRecipients(recipients);
            save("recipient");
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
                  <div className="h-9 w-9 rounded-lg gradient-primary shrink-0 flex items-center justify-center shadow-sm shadow-primary/20">
                    <span className="text-[11px] font-bold text-primary-foreground">
                      {u.avatarInitials}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      {u.displayName}
                      <Badge
                        variant={
                          u.role === "RISK_MANAGER"
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
                      {u.whatsapp && <span>· {u.whatsapp}</span>}
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
        {[
          { threshold: 100000, client: 40, inst: 60, label: "VIP 档位" },
          { threshold: 0, client: 30, inst: 70, label: "普通档位" },
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
                ≥ ${tier.threshold.toLocaleString()}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">客户</p>
                <div className="relative">
                  <Input
                    type="number"
                    defaultValue={tier.client}
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
                    defaultValue={tier.inst}
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
        <Button variant="outline" size="sm" className="w-full gap-1.5">
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
        <Input
          placeholder="+852-9123-4567"
          value={rForm.whatsapp ?? ""}
          onChange={(e) => setRForm({ ...rForm, whatsapp: e.target.value })}
          className="font-mono text-xs"
        />
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
              <SelectItem value="RISK_MANAGER">风控总监（全局权限）</SelectItem>
              <SelectItem value="BD_MANAGER">BD经理（仅管辖客户）</SelectItem>
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
        <Input
          placeholder="+852-9123-4567"
          value={uForm.whatsapp ?? ""}
          onChange={(e) => setUForm({ ...uForm, whatsapp: e.target.value })}
          className="font-mono text-xs"
        />
      </div>
      {uForm.role === "BD_MANAGER" && (
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1">
            <UserPlus className="h-3 w-3" /> BD 归属全称（选填）
          </Label>
          <Input
            placeholder="如：王思远 (Sylvia Wang) — 用于客户表单自动归属"
            value={uForm.bdManagerFullName ?? ""}
            onChange={(e) => setUForm({ ...uForm, bdManagerFullName: e.target.value })}
            className="text-xs"
          />
        </div>
      )}
      <div className="rounded-lg bg-secondary/30 border border-border/40 px-3 py-2 text-[10.5px] text-muted-foreground/90 leading-relaxed">
        <Info className="h-3 w-3 inline-block mr-1 -mt-0.5" />
        账号将保存至本地 localStorage（mock 模式），生产环境需接入 Supabase Auth。
      </div>
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
</div>
  </AuthGuard>
  );
}
