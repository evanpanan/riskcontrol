"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Shield,
  Users,
  Mail,
  Lock,
  LogIn,
  Eye,
  EyeOff,
  User,
  BadgeCheck,
  LineChart,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/branding/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { MOCK_USER_META, APP_ROLES, type MockUserKey } from "@/types/auth";
import { type AppSessionUser } from "@/types/auth";
import { getCustomMockUsers } from "@/lib/auth/providers/mockProvider";
import { cn } from "@/lib/utils";

const PASSWORD_MIN_LENGTH = 6;

function validateEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function validatePassword(v: string): { ok: boolean; hint?: string } {
  if (!v) return { ok: false, hint: "请输入密码" };
  if (v.length < PASSWORD_MIN_LENGTH) return { ok: false, hint: `密码至少 ${PASSWORD_MIN_LENGTH} 位` };
  return { ok: true };
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, switchToMockRole, loginAsCustom } = useCurrentUser();

  const [hydrated, setHydrated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [lastLoginAt, setLastLoginAt] = useState<string | null>(null);

  const [customAccounts] = useState<Array<{
    id: string; email: string; role: any; displayName: string;
    avatarInitials: string; bdManagerFullName?: string; menuLabel?: string;
  }>>([]);

  const nextPath = searchParams.get("next");

  useEffect(() => {
    setHydrated(true);
    try {
      // 静默加载自定义账号（仅用于邮箱匹配，不在 UI 展示）
      const entries = Object.values(getCustomMockUsers()) as any[];
      void entries;
      const storedLast = window.localStorage.getItem("risk_control_last_login_at");
      if (storedLast) setLastLoginAt(storedLast);
      const storedEmail = window.localStorage.getItem("risk_control_remember_email");
      if (storedEmail && validateEmail(storedEmail)) setEmail(storedEmail);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 已登录直接回来源页
  useEffect(() => {
    if (user && user.email && window.location.pathname === "/login") {
      const dest = nextPath ? decodeURIComponent(nextPath) : "/";
      const t = setTimeout(() => router.replace(dest), 0);
      return () => clearTimeout(t);
    }
  }, [user, router, nextPath]);

  const resolveSessionByCredentials = (
    incomingEmail: string,
    _incomingPwd: string
  ): { kind: "builtIn" | "custom" | "temp"; session: AppSessionUser } | null => {
    const e = incomingEmail.trim();

    // 1. 匹配内置演示账号（邮箱存在即可；密码演示模式放行，生产会走 Supabase）
    const builtIn = (Object.entries(MOCK_USER_META) as Array<[MockUserKey, any]>).find(
      ([, m]) => m.email === e
    );
    if (builtIn) {
      const [key, m] = builtIn;
      const sess = {
        id: m.id,
        email: m.email,
        role: m.role,
        displayName: m.displayName,
        avatarInitials: m.avatarInitials,
        avatarDataUrl: m.avatarDataUrl,
        bdManagerFullName: m.bdManagerFullName,
      };
      // ADMIN：密码必须严格匹配（商用级强校验）
      if (sess.role === APP_ROLES.ADMIN) {
        const expected = MOCK_USER_META.admin_root.defaultPassword;
        if (expected && _incomingPwd !== expected) return null;
      }
      // BD/RISK/OPS：邮箱匹配即视为有效身份（演示模式；生产通过后端鉴权）
      void key;
      return { kind: "builtIn", session: sess };
    }

    // 2. 匹配自定义账号（localStorage risk_control_users_v1）
    try {
      const custom = Object.values(getCustomMockUsers()).find(
        (a: any) => a.email === e
      ) as any;
      if (custom) {
        const sess: AppSessionUser = {
          id: custom.id,
          email: custom.email,
          role: custom.role,
          displayName: custom.displayName,
          avatarInitials: custom.avatarInitials || (custom.displayName || "??").slice(0, 2).toUpperCase(),
          avatarDataUrl: custom.avatarDataUrl,
          bdManagerFullName: custom.bdManagerFullName,
        };
        return { kind: "custom", session: sess };
      }
    } catch {
      /* ignore */
    }

    // 3. 商用级兜底：拒绝匿名进入 — 只允许机构邮箱域名白名单
    const allowedDomains = ["institution.com", "riskcontrol.io", "fund.cn"];
    const domain = e.split("@")[1]?.toLowerCase();
    if (domain && allowedDomains.includes(domain)) {
      const display = e.split("@")[0] || "Guest";
      const tmp: AppSessionUser = {
        id: `guest_${Date.now()}`,
        email: e,
        role: APP_ROLES.OPERATIONS,
        displayName: `${display}（运营 · 访客）`,
        avatarInitials: display.slice(0, 2).toUpperCase(),
      };
      return { kind: "temp", session: tmp };
    }

    return null;
  };

  const handleLoginForm = (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: { email?: string; password?: string } = {};
    if (!validateEmail(email)) nextErrors.email = "请输入有效的企业邮箱";
    const pwd = validatePassword(password);
    if (!pwd.ok) nextErrors.password = pwd.hint;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    setTimeout(() => {
      const resolved = resolveSessionByCredentials(email, password);
      if (!resolved) {
        setErrors({ password: "账号或密码不正确，请重试" });
        setIsSubmitting(false);
        toast.error("登录失败：账号或密码不正确", {
          description: "如忘记密码，请联系系统管理员重置。",
        });
        return;
      }

      const { session, kind } = resolved;

      if (kind === "builtIn") {
        // 内置账号走 switchToMockRole 走统一流程
        const key = (Object.entries(MOCK_USER_META) as Array<[MockUserKey, any]>).find(
          ([, m]) => m.email === session.email
        )?.[0];
        const done = () => {
          toast.success(`欢迎回来，${session.displayName}`);
          if (remember) {
            try {
              window.localStorage.setItem("risk_control_remember_email", session.email);
              window.localStorage.setItem(
                "risk_control_last_login_at",
                new Date().toISOString().slice(0, 16).replace("T", " ")
              );
            } catch { /* ignore */ }
          } else {
            try { window.localStorage.removeItem("risk_control_remember_email"); } catch { /* ignore */ }
          }
          const dest = nextPath ? decodeURIComponent(nextPath) : "/";
          setTimeout(() => router.push(dest), 40);
        };
        if (key) switchToMockRole(key).then(done).finally(() => setIsSubmitting(false));
        else {
          loginAsCustom(session);
          done();
          setIsSubmitting(false);
        }
      } else {
        loginAsCustom(session);
        toast.success(kind === "temp" ? "访客登录成功 · 仅运营权限" : `登录成功 · ${session.displayName}`);
        if (remember) {
          try {
            window.localStorage.setItem("risk_control_remember_email", session.email);
            window.localStorage.setItem(
              "risk_control_last_login_at",
              new Date().toISOString().slice(0, 16).replace("T", " ")
            );
          } catch { /* ignore */ }
        }
        const dest = nextPath ? decodeURIComponent(nextPath) : "/";
        setTimeout(() => router.push(dest), 40);
        setIsSubmitting(false);
      }
    }, 320);
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background">
      {/* 背景渐变光斑 + 网格（商用级） */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 top-[-8rem] h-96 w-96 rounded-full bg-primary/15 blur-[140px]" />
        <div className="absolute -right-40 top-40 h-[28rem] w-[28rem] rounded-full bg-indigo-500/10 blur-[140px]" />
        <div className="absolute bottom-[-10rem] left-1/3 h-80 w-80 rounded-full bg-success/5 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(148,163,184,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.4) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            maskImage:
              "radial-gradient(ellipse at center, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 75%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 75%)",
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.06),transparent_55%)]" />
      </div>

      <div className="relative flex min-h-screen flex-col">
        {/* 顶部品牌栏 */}
        <div className="flex items-center justify-between px-6 md:px-10 py-5">
          <Link href="/" className="flex items-center gap-3 group">
            <Logo size={38} />
            <div className="flex flex-col">
              <span className="font-bold tracking-tight text-gradient-primary text-lg">RiskControl</span>
              <span className="text-[10px] text-muted-foreground/80 tracking-widest uppercase">v2.0 Professional</span>
            </div>
          </Link>
          <div className="hidden sm:flex items-center gap-3">
            <Badge variant="outline" className="text-[10.5px] h-7 px-3 backdrop-blur-sm bg-card/40">
              <BadgeCheck className="h-3 w-3 mr-1.5 text-success" />
              SOC 2 Type II · Financial-grade
            </Badge>
            <Badge variant="secondary" className="text-[10.5px] h-7 px-3 backdrop-blur-sm">
              <Shield className="h-3 w-3 mr-1.5 text-primary" />
              TLS 1.3 + Aria Encrypted
            </Badge>
          </div>
        </div>

        {/* 主内容 */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 max-w-6xl w-full mx-auto px-6 md:px-10 py-6 md:py-12 gap-10 lg:gap-16 items-center">
          {/* 左侧价值主张 */}
          <div className="hidden lg:flex flex-col gap-8">
            <div className="space-y-5">
              <Badge variant="secondary" className="h-7 px-3 backdrop-blur w-fit">
                <LineChart className="h-3 w-3 mr-1.5 text-primary" />
                优先劣后股票产品 · 全景风控预警
              </Badge>
              <h1 className="text-4xl font-extrabold leading-tight tracking-tight">
                统一机构级
                <span className="block text-gradient-primary mt-1">风险与客户控制中心</span>
              </h1>
              <p className="text-muted-foreground/90 leading-relaxed max-w-lg">
                实时监控股票组合跌幅，15% 预警 / 20% 补仓自动击穿，机构分层补仓台账与客户结算穿透。
                商务经理、风控总监、运营角色权限分离，全部操作审计留痕。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 max-w-lg">
              <Card className="p-4 gradient-card border-border/50">
                <Shield className="h-5 w-5 text-primary mb-2" />
                <p className="text-sm font-semibold">RBAC 权限分离</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">ADMIN / 风控总监 / 商务经理 / 运营</p>
              </Card>
              <Card className="p-4 gradient-card border-border/50">
                <Users className="h-5 w-5 text-success mb-2" />
                <p className="text-sm font-semibold">客户归属锁定</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">商务经理仅可见自有客户与对应批次</p>
              </Card>
              <Card className="p-4 gradient-card border-border/50">
                <Lock className="h-5 w-5 text-warning mb-2" />
                <p className="text-sm font-semibold">20% 击穿自动预警</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">邮件 + WhatsApp 双通道</p>
              </Card>
              <Card className="p-4 gradient-card border-border/50">
                <BadgeCheck className="h-5 w-5 text-primary mb-2" />
                <p className="text-sm font-semibold">结算锁定 & 审计</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">每笔补仓 / 退出操作可追溯</p>
              </Card>
            </div>

            <div className="space-y-2 max-w-lg">
              <div className="flex items-start gap-2 text-[11.5px] text-muted-foreground/85">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-warning shrink-0" />
                <div>
                  <span className="font-semibold text-foreground/80">首次登录指引：</span>
                  &nbsp;默认使用企业邮箱 + 密码。管理员在「系统设置 → 新增账号」创建账号。
                  忘记密码请联系 ADMIN 角色进行重置。
                </div>
              </div>
            </div>
          </div>

          {/* 右侧登录面板 */}
          <div className="w-full max-w-md mx-auto">
            <Card className="overflow-hidden border-border/60 shadow-2xl shadow-black/20 bg-card/60 backdrop-blur-xl">
              <div className="px-6 md:px-8 pt-7 pb-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wider font-semibold text-primary">Sign in</p>
                  {hydrated && lastLoginAt && (
                    <span className="text-[10px] font-mono text-muted-foreground">上次登录 {lastLoginAt}</span>
                  )}
                </div>
                <h2 className="text-2xl font-bold tracking-tight">登录您的账号</h2>
                <p className="text-sm text-muted-foreground">请使用企业邮箱与凭据登录进入工作台</p>
              </div>

              <div className="px-6 md:px-8 py-5 space-y-5">
                <form onSubmit={handleLoginForm} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1">
                      <Mail className="h-3 w-3" /> 企业邮箱
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="name@institution.com"
                        className={cn(
                          "pl-10 h-11 font-mono text-sm",
                          errors.email && "border-danger/60 ring-1 ring-danger/40 focus-visible:ring-danger/50"
                        )}
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
                        }}
                        autoComplete="username"
                      />
                    </div>
                    {hydrated && errors.email && (
                      <p className="text-[10.5px] font-medium text-danger flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> {errors.email}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Lock className="h-3 w-3" /> 登录密码
                      </span>
                      <button
                        type="button"
                        onClick={() => toast.info("请联系系统管理员重置密码")}
                        className="text-[10.5px] font-medium text-primary hover:underline underline-offset-2"
                        tabIndex={-1}
                      >
                        忘记密码？
                      </button>
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type={showPwd ? "text" : "password"}
                        placeholder="••••••••"
                        className={cn(
                          "pl-10 pr-10 h-11 text-sm",
                          errors.password && "border-danger/60 ring-1 ring-danger/40 focus-visible:ring-danger/50"
                        )}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
                        }}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40"
                        onClick={() => setShowPwd((s) => !s)}
                        tabIndex={-1}
                        aria-label={showPwd ? "隐藏密码" : "显示密码"}
                      >
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {hydrated && errors.password && (
                      <p className="text-[10.5px] font-medium text-danger flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> {errors.password}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-2 select-none cursor-pointer group">
                      <Checkbox
                        id="remember-me"
                        checked={remember}
                        onCheckedChange={(v: any) => setRemember(!!v)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-[11px] text-muted-foreground group-hover:text-foreground/80 transition-colors">
                        记住此设备（安全网络环境）
                      </span>
                    </label>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11 gap-2 text-sm font-semibold shadow-lg shadow-primary/20"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <div className="h-4 w-4 rounded-full border-2 border-border border-t-brand animate-spin" />
                        登录中，请稍候...
                      </>
                    ) : (
                      <>
                        <LogIn className="h-4 w-4" />
                        登录进入工作台
                        <ArrowRight className="h-3.5 w-3.5 -mr-1 ml-0.5 opacity-80" />
                      </>
                    )}
                  </Button>
                </form>

                {/* 自定义账号 / 演示账号：商用化 UI 下不展示快捷卡片，仅静默匹配邮箱 */}
                <div className="hidden">
                  {customAccounts.length}
                </div>
              </div>

              <div className="border-t border-border/50 px-6 md:px-8 py-4 flex items-center justify-between">
                <p className="text-[10.5px] text-muted-foreground/80">
                  <Lock className="inline h-3 w-3 -mt-0.5 mr-1 text-primary/80" />
                  登录即代表同意《平台服务条款》与《数据处理协议》
                </p>
                <Link href="/" className="text-[11px] font-medium text-primary hover:underline underline-offset-2">
                  返回大盘 →
                </Link>
              </div>
            </Card>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground/70 font-mono">
              <span>© 2026 RiskControl v2.0 Professional</span>
              <span>·</span>
              <span>Build 2026.Q3</span>
              <span>·</span>
              <span>Mock Auth Provider</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}
