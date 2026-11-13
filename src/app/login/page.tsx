"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Shield,
  Users,
  BadgeCheck,
  Mail,
  Lock,
  Eye,
  EyeOff,
  User,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/branding/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { useAuthContext } from "@/lib/auth/authProvider";
import { type AppSessionUser } from "@/types/auth";
import { cn } from "@/lib/utils";
import { logAudit } from "@/lib/auth/audit";
import styles from "./login.module.css";

const PASSWORD_MIN_LENGTH = 6;

const loginFeatures = [
  { title: "角色权限分离", description: "按角色分配查看和操作权限。", icon: Shield },
  { title: "客户归属锁定", description: "商务经理只查看自己负责的客户。", icon: Users },
  { title: "补仓自动预警", description: "触发风控阈值时自动发送提醒。", icon: AlertTriangle },
  { title: "结算与审计", description: "每笔补仓和退出操作均可追溯。", icon: BadgeCheck },
];

function validatePassword(v: string): { ok: boolean; hint?: string } {
  if (!v) return { ok: false, hint: "请输入密码" };
  if (v.length < PASSWORD_MIN_LENGTH) return { ok: false, hint: `密码至少 ${PASSWORD_MIN_LENGTH} 位` };
  return { ok: true };
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useCurrentUser();
  const { serverLoginCredentials } = useAuthContext();

  const [hydrated, setHydrated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [welcomeState, setWelcomeState] = useState<{
    visible: boolean;
    displayName: string;
    role: AppSessionUser["role"];
    email: string;
  } | null>(null);

  const nextPath = searchParams.get("next");

  useEffect(() => {
    setHydrated(true);
    try {
      const storedEmail = window.localStorage.getItem("risk_control_remember_email");
      if (storedEmail?.trim()) setEmail(storedEmail);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 已登录直接回来源页
  useEffect(() => {
    if (!isSubmitting && !welcomeState && user && user.email && window.location.pathname === "/login") {
      const dest = nextPath ? decodeURIComponent(nextPath) : "/";
      const t = setTimeout(() => router.replace(dest), 0);
      return () => clearTimeout(t);
    }
  }, [user, router, nextPath, isSubmitting, welcomeState]);

  const handleLoginForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || welcomeState) return;
    const nextErrors: { email?: string; password?: string; form?: string } = {};
    const identifier = email.trim();
    if (!identifier) nextErrors.email = "请输入企业邮箱或账号";
    const pwd = validatePassword(password);
    if (!pwd.ok) nextErrors.password = pwd.hint;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    // NOTE: run synchronously.  The former `setTimeout(..., 320)` wrapper
    // caused navigation timers to be lost whenever React / Fast Refresh
    // remounted the component between submission and the timer firing.  All
    // setTimeouts for navigation are scheduled in the first synchronous tick
    // of finishLogin so they cannot be lost.
    (async () => {
      const finishLogin = async () => {
        // Only announce success after the server has issued and verified a session.
        const session = await serverLoginCredentials(identifier, password);
        if (!session) {
          setErrors({ form: "账号或密码校验失败，请重试。" });
          return false;
        }
        const check = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
        if (!check.ok) {
          setErrors({ form: "登录会话未生效，请刷新后重试。" });
          return false;
        }
        logAudit({ action: "login_success", actorId: session.id, actorEmail: session.email, role: session.role, resource: "auth:login", detail: { kind: "server", role: session.role, displayName: session.displayName } });
        if (remember) window.localStorage.setItem('risk_control_remember_email', session.email);
        else window.localStorage.removeItem('risk_control_remember_email');
        let dest = '/';
        try { dest = nextPath ? decodeURIComponent(nextPath) : '/'; } catch { /* use home */ }
        if (!dest.startsWith('/') || dest.startsWith('//')) dest = '/';
        let navigated = false;
        const navigate = () => {
          if (navigated) return;
          navigated = true;
          window.location.replace(dest);
        };
        setWelcomeState({
          visible: true, displayName: session.displayName, role: session.role,
          email: session.email, __onAnimationComplete: navigate,
        } as any);
        window.setTimeout(navigate, 1750);
        return true;
      };

      void finishLogin().catch(() => {
        setWelcomeState(null);
        setErrors({ form: "登录连接失败，请稍后重试。" });
      }).finally(() => setIsSubmitting(false));
    })();
  };

  return (
    <div
      className={cn(styles.shell, "relative min-h-screen w-full overflow-hidden")}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse") return;
        const element = event.currentTarget;
        const bounds = element.getBoundingClientRect();
        element.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
        element.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
      }}
    >
      <div aria-hidden className={cn(styles.grid, "pointer-events-none absolute inset-0")} />
      <div aria-hidden className={cn(styles.ambient, "pointer-events-none absolute inset-0")} />

      {/* 欢迎登录过渡遮罩 */}
      {welcomeState?.visible && (
        <WelcomeTransitionOverlay
          displayName={welcomeState.displayName}
          role={welcomeState.role}
          email={welcomeState.email}
          onAnimationComplete={(welcomeState as any).__onAnimationComplete}
        />
      )}

      <div data-login-content className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 sm:px-10">
        <Link href="/" className="mt-6 flex w-fit items-center gap-3 rounded-lg sm:mt-9">
          <Logo size={42} />
          <span className={cn(styles.brand, "text-lg font-semibold tracking-tight")}>RiskControl</span>
        </Link>

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.15fr_1fr]">
          <ul className={styles.features} aria-label="平台功能">
            {loginFeatures.map(({ title, description, icon: Icon }) => (
              <li key={title}>
                <div
                  className={styles.feature}
                  onPointerMove={(event) => {
                    if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
                    const bounds = (event.currentTarget.parentElement ?? event.currentTarget).getBoundingClientRect();
                    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
                    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
                    event.currentTarget.style.setProperty("--tilt-x", `${(0.5 - y) * 20}deg`);
                    event.currentTarget.style.setProperty("--tilt-y", `${(x - 0.5) * 20}deg`);
                    event.currentTarget.style.setProperty("--glow-x", `${x * 100}%`);
                    event.currentTarget.style.setProperty("--glow-y", `${y * 100}%`);
                  }}
                  onPointerLeave={(event) => {
                    event.currentTarget.style.removeProperty("--tilt-x");
                    event.currentTarget.style.removeProperty("--tilt-y");
                    event.currentTarget.style.removeProperty("--glow-x");
                    event.currentTarget.style.removeProperty("--glow-y");
                  }}
                >
                  <span className={styles.featureIcon}><Icon aria-hidden className="h-6 w-6" strokeWidth={1.6} /></span>
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold tracking-wide">{title}</p>
                    <p className="text-xs leading-relaxed text-slate-300">{description}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mx-auto w-full max-w-[440px]">
            <Card className={cn(styles.panel, "overflow-hidden rounded-3xl")}>
              <div className="space-y-2 px-6 pb-2 pt-8 sm:px-9">
                <h1 className="text-3xl font-semibold tracking-tight">登录工作台</h1>
              </div>

              <div className="px-6 pb-8 pt-6 sm:px-9">
                <form onSubmit={handleLoginForm} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="login-email" className="text-xs flex items-center gap-1">
                      <Mail className="h-3 w-3" /> 企业邮箱
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="login-email"
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
                    <div className="flex items-center justify-between text-xs">
                      <Label htmlFor="login-password" className="flex items-center gap-1">
                        <Lock className="h-3 w-3" /> 登录密码
                      </Label>
                      <button
                        type="button"
                        onClick={() => toast.info("请联系系统管理员重置密码")}
                        className="text-[10.5px] font-medium text-primary hover:underline underline-offset-2"
                      >
                        忘记密码？
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="login-password"
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
                        记住邮箱
                      </span>
                    </label>
                  </div>

                  {errors.form && <p role="alert" className="rounded-lg border border-red-300/25 bg-red-400/10 px-3 py-2 text-sm text-red-200">{errors.form}</p>}

                  <Button
                    type="submit"
                    className={cn(styles.submit, "h-11 w-full gap-2 bg-blue-500 text-sm font-semibold text-white hover:bg-blue-600")}
                    disabled={isSubmitting || !!welcomeState}
                    aria-busy={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <div className="h-4 w-4 rounded-full border-2 border-border border-t-brand animate-spin" />
                        登录中，请稍候...
                      </>
                    ) : (
                      <>
                        登录
                        <ArrowRight className="h-3.5 w-3.5 -mr-1 ml-0.5 opacity-80" />
                      </>
                    )}
                  </Button>
                </form>

              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

const ROLE_LABELS: Record<AppSessionUser["role"], string> = {
  ADMIN: "系统管理员",
  RISK_MANAGER: "风控总监",
  BD_MANAGER: "商务经理",
  OPERATIONS: "运营专员",
};

const ROLE_BADGE_CLASS: Record<AppSessionUser["role"], string> = {
  ADMIN: "bg-danger/15 text-danger border-danger/30",
  RISK_MANAGER: "bg-primary/15 text-primary border-primary/30",
  BD_MANAGER: "bg-success/15 text-success border-success/30",
  OPERATIONS: "bg-warning/15 text-warning border-warning/30",
};

function WelcomeTransitionOverlay(props: {
  displayName: string;
  role: AppSessionUser["role"];
  email: string;
  /** 整个动画播放完毕后才触发，保证登录动画完整展示 */
  onAnimationComplete?: () => void;
}) {
  const { displayName, role, email } = props;
  const initials = (displayName || "??").slice(0, 2).toUpperCase();
  const onCompleteRef = useRef<() => void | undefined>();
  onCompleteRef.current = props.onAnimationComplete;
  const calledRef = useRef(false);
  // 完整动画时长：rc-spin-slow 1.2s + rc-progress-fill 720ms + 各 stagger (~360+460ms) → 安全取 1650ms
  // 用 requestAnimationFrame 挂原生 setTimeout 保证即使 React unmount 也不会被 effect 清掉
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (calledRef.current) return;
      calledRef.current = true;
      try { onCompleteRef.current?.(); } catch { /* ignore */ }
    }, 1650);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ animation: "rc-fade-in 180ms ease-out both" }}
    >
      {/* 背景模糊 + 遮罩 */}
      <div
        className="absolute inset-0 backdrop-blur-xl bg-background/80"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 30% 20%, rgba(59,130,246,0.25), transparent 55%), radial-gradient(ellipse at 80% 80%, rgba(129,140,248,0.22), transparent 55%)",
        }}
      />
      {/* 光晕脉冲 */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/25 blur-[120px]"
        style={{ animation: "rc-pulse-soft 1.4s ease-in-out infinite" }}
      />

      {/* 主内容卡 */}
      <div
        className="relative z-10 w-[min(92vw,420px)]"
        style={{ animation: "rc-pop-in 420ms cubic-bezier(.22,1.3,.36,1) both" }}
      >
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/85 backdrop-blur-2xl shadow-[0_30px_80px_-20px_rgba(30,64,175,0.45)]">
          {/* 顶条高光 */}
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent" />

          <div className="flex flex-col items-center px-8 pt-10 pb-9">
            {/* Logo 旋转光晕 */}
            <div className="relative mb-6">
              <div
                aria-hidden
                className="absolute inset-[-10px] rounded-full bg-primary/20 blur-xl"
                style={{ animation: "rc-pulse-soft 1.6s ease-in-out infinite" }}
              />
              <div
                className="relative h-20 w-20 rounded-2xl bg-gradient-to-br from-primary to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-primary/30"
                style={{ animation: "rc-spin-slow 1.2s linear infinite" }}
              >
                <div className="flex h-16 w-16 rounded-xl bg-background/15 backdrop-blur-sm items-center justify-center">
                  <Logo size={40} className="!shadow-none !bg-white/10 !ring-white/25" />
                </div>
              </div>
            </div>

            {/* 欢迎文案 */}
            <div
              className="text-xs uppercase tracking-[0.2em] font-semibold text-primary mb-2"
              style={{ animation: "rc-slide-up 360ms ease 120ms both" }}
            >
              Authentication · Verified
            </div>
            <h1
              className="text-3xl font-extrabold tracking-tight mb-1 text-center"
              style={{ animation: "rc-slide-up 420ms ease 200ms both" }}
            >
              欢迎登录
              <span className="ml-2 text-gradient-primary">RiskControl</span>
            </h1>
            <p
              className="text-sm text-muted-foreground/85 mb-6 text-center"
              style={{ animation: "rc-slide-up 420ms ease 280ms both" }}
            >
              正在为您初始化工作台与全局风控视图
            </p>

            {/* 用户身份卡 */}
            <div
              className="w-full rounded-2xl border border-border/60 bg-background/60 p-4 flex items-center gap-4"
              style={{ animation: "rc-slide-up 500ms ease 360ms both" }}
            >
              <div className="relative shrink-0">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/90 to-indigo-500/90 text-white flex items-center justify-center text-sm font-bold shadow-md shadow-primary/25">
                  {initials}
                </div>
                <div
                  aria-hidden
                  className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-success border-2 border-background"
                  style={{ animation: "rc-pulse-soft 1.8s ease-in-out infinite" }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <p className="text-[15px] font-bold truncate">{displayName}</p>
                  <span
                    className={cn(
                      "inline-flex items-center h-5 px-2 rounded-full border text-[10px] font-semibold tracking-wide",
                      ROLE_BADGE_CLASS[role]
                    )}
                  >
                    {ROLE_LABELS[role]}
                  </span>
                </div>
                <p className="text-[11.5px] font-mono text-muted-foreground/80 truncate">
                  {email}
                </p>
              </div>
            </div>

            {/* 进度条 */}
            <div
              className="w-full mt-6"
              style={{ animation: "rc-slide-up 520ms ease 460ms both" }}
            >
              <div className="h-1.5 w-full rounded-full bg-muted/70 overflow-hidden">
                <div
                  className="h-full w-1/2 rounded-full bg-gradient-to-r from-primary via-indigo-500 to-primary bg-[length:200%_100%]"
                  style={{
                    animation:
                      "rc-progress-fill 720ms ease forwards, rc-progress-shimmer 1.1s linear 260ms infinite",
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[10.5px] text-muted-foreground/85 font-mono">
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-success"
                    style={{ animation: "rc-blink 1s ease-in-out infinite" }}
                  />
                  身份已验证
                </span>
                <span>正在跳转工作台…</span>
              </div>
            </div>
          </div>

          {/* 底部品牌条 */}
          <div className="border-t border-border/50 px-8 py-3 flex items-center justify-between bg-gradient-to-r from-primary/[0.04] via-transparent to-indigo-500/[0.04]">
            <span className="text-[10px] font-mono text-muted-foreground/80">
              RiskControl 风控平台
            </span>
            <span className="text-[10px] font-mono text-muted-foreground/80">
              安全连接 · 正在进入工作台
            </span>
          </div>
        </div>
      </div>

      {/* 内联 keyframes（避免 tailwind 动画类名未注册） */}
      <style jsx global>{`
        @keyframes rc-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes rc-pop-in {
          0% { opacity: 0; transform: translateY(14px) scale(.96) }
          60% { opacity: 1 }
          100% { opacity: 1; transform: translateY(0) scale(1) }
        }
        @keyframes rc-slide-up {
          from { opacity: 0; transform: translateY(8px) }
          to { opacity: 1; transform: translateY(0) }
        }
        @keyframes rc-pulse-soft {
          0%, 100% { opacity: .65; transform: scale(1) }
          50% { opacity: 1; transform: scale(1.08) }
        }
        @keyframes rc-spin-slow {
          0% { transform: rotate(0deg) }
          100% { transform: rotate(360deg) }
        }
        @keyframes rc-progress-fill {
          from { width: 14% }
          to { width: 92% }
        }
        @keyframes rc-progress-shimmer {
          0% { background-position: 0% 50% }
          100% { background-position: 200% 50% }
        }
        @keyframes rc-blink {
          0%, 100% { opacity: .4 }
          50% { opacity: 1 }
        }
      `}</style>
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
