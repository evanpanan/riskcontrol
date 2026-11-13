"use client";

import { notificationChannelLabel } from "@/lib/notificationPolicy";
import { Bell, Search, RefreshCw, ChevronDown, Clock, RadioTower, Menu, X, LogOut, ImagePlus, AlertTriangle, CheckCircle2, Info, TrendingUp, TrendingDown, LineChart } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import type { AppSessionUser, AppRole } from "@/types/auth";
import { APP_ROLES } from "@/types/auth";
import { ClientAvatar } from "@/components/branding/ClientAvatar";
import { Logo } from "@/components/branding/Logo";
import Link from "next/link";
import { getNotificationLogs, LAST_NOTIFICATIONS_KEY, type NotificationLogEntry, type NotificationPayload } from "@/lib/notifier";
import { toast } from "sonner";
import { DEFAULT_LIVE_QUOTE, LIVE_QUOTE_SETTINGS_KEY, fetchQuoteBrowser, getLiveQuoteSettings, getNYSEInfo, quoteSourceLabel, getCachedQuote } from "@/lib/liveQuote";
import type { LiveQuoteSettings, BrowserQuote } from "@/lib/liveQuote";
import { KLineDialog } from "@/components/quote/KLineDialog";
import { quoteProviderLabel } from "@/lib/quote/providers";
import { refreshMockDataPrices } from "@/lib/mockData";

function getQuoteSettings(): LiveQuoteSettings {
  return getLiveQuoteSettings();
}

const LAST_READ_NOTIF_KEY = "risk_control_last_read_notif_at_v1";

export function TopBar() {
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [nextUpdateAt, setNextUpdateAt] = useState<number>(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifTick, setNotifTick] = useState(0);
  const [lastReadNotifAt, setLastReadNotifAt] = useState<number>(0);
  const { user, role, logoutToLogin } = useCurrentUser();
  const [quote, setQuote] = useState<LiveQuoteSettings>(() => ({ ...DEFAULT_LIVE_QUOTE }));
  const quoteSymbol = quote.symbol.trim().toUpperCase();
  const [quoteResult, setQuoteResult] = useState<{ symbol: string; value: BrowserQuote } | null>(null);
  const [quoteFetching, setQuoteFetching] = useState(false);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [klineOpen, setKlineOpen] = useState(false);
  const [quoteFlashDir, setQuoteFlashDir] = useState<"up" | "down" | null>(null);
  const previousQuote = useRef<{ symbol: string; price: number } | null>(null);
  const nyse = getNYSEInfo(now?.getTime());
  const liveQuote = quoteResult?.symbol === quoteSymbol
    ? quoteResult.value
    : hydrated ? getCachedQuote(quoteSymbol) : null;
  const quoteAsOf = liveQuote?.data?.updatedAt ?? 0;
  const quoteAge = (now?.getTime() ?? Date.now()) - quoteAsOf;
  const hasQuoteTime = Number.isFinite(quoteAsOf) && quoteAsOf > 0 && quoteAge >= -30_000;
  const quoteFresh = hasQuoteTime && quoteAge <= 120_000;
  const quoteStatus = quoteFetching ? "行情更新中"
    : !liveQuote || liveQuote.source === "OFFLINE" ? "行情暂不可用"
    : !hasQuoteTime ? null
    : quoteFresh ? "行情已更新"
    : nyse.shouldBreathe ? "行情已过期" : "休市 · 最近行情";

  useEffect(() => {
    setHydrated(true);
    const t = Date.now();
    setNow(new Date(t));
    setNextUpdateAt(t + 8000); // 默认大概8秒后更新
    try {
      const raw = localStorage.getItem(LAST_READ_NOTIF_KEY);
      if (raw) setLastReadNotifAt(Math.max(0, Number(raw) || 0));
    } catch {}
    try {
      setQuote(getQuoteSettings());
      const onQuoteChanged = (event: Event) => {
        const detail = (event as CustomEvent<Partial<LiveQuoteSettings>>).detail;
        if (detail?.symbol) setQuote(getQuoteSettings());
      };
      const onStorage = (e: StorageEvent) => {
        if (e.key === LIVE_QUOTE_SETTINGS_KEY) {
          setQuote(getQuoteSettings());
        }
      };
      window.addEventListener("risk-control:quote-changed", onQuoteChanged as any);
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener("risk-control:quote-changed", onQuoteChanged as any);
        window.removeEventListener("storage", onStorage);
      };
    } catch {}
  }, []);

  useEffect(() => {
    if (!hydrated || !quoteSymbol) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const runFetch = async () => {
      setQuoteFetching(true);
      try {
        const value = await fetchQuoteBrowser(quoteSymbol);
        if (!cancelled) setQuoteResult({ symbol: quoteSymbol, value });
      } catch {
        // Keep the last quote if the refresh fails.
      } finally {
        if (!cancelled) {
          setQuoteFetching(false);
          const interval = Math.min(60, Math.max(1, Number(quote.refreshSec) || 8));
          const seconds = getNYSEInfo().shouldRefreshReal ? interval : Math.max(30, interval);
          setNextUpdateAt(Date.now() + seconds * 1000);
          timer = setTimeout(() => void runFetch(), seconds * 1000);
          refreshMockDataPrices();
        }
      }
    };
    void runFetch();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hydrated, quote.refreshSec, quoteSymbol, quoteRefresh]);

  useEffect(() => {
    const value = quoteResult?.value;
    if (!value || quoteResult.symbol !== quoteSymbol || value.source === "OFFLINE") return;
    const previous = previousQuote.current;
    previousQuote.current = { symbol: quoteSymbol, price: value.price };
    if (previous?.symbol !== quoteSymbol || previous.price === value.price) {
      setQuoteFlashDir(null);
      return;
    }
    setQuoteFlashDir(value.price > previous.price ? "up" : "down");
    const timer = setTimeout(() => setQuoteFlashDir(null), 1500);
    return () => clearTimeout(timer);
  }, [quoteResult, quoteSymbol]);

  // 移除自动聚焦：页面刷新时如果 Chrome 自动聚焦到搜索框，强制 blur
  useEffect(() => {
    const t = setTimeout(() => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae.tagName === "INPUT" && ae.closest('[data-topbar-search]')) {
        ae.blur();
      }
      if (typeof window !== 'undefined' && 'scrollTo' in window) window.scrollTo({ top: 0 });
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
      setSecondsLeft(Math.max(0, Math.ceil((nextUpdateAt - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [nextUpdateAt]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setQuoteRefresh((refresh) => refresh + 1);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1500);
  };

  const roleBadgeVariant = (r: AppRole): "default" | "primary" | "warning" | "success" | "outline" | "danger" | "secondary" => {
    switch (r) {
      case APP_ROLES.ADMIN:
        return "danger";
      case APP_ROLES.RISK_MANAGER:
        return "primary";
      case APP_ROLES.BD_MANAGER:
        return "warning";
      case APP_ROLES.OPERATIONS:
        return "outline";
      default:
        return "secondary";
    }
  };

  const roleLabel = (r: AppRole): string => {
    switch (r) {
      case APP_ROLES.ADMIN:
        return "系统管理员";
      case APP_ROLES.RISK_MANAGER:
        return "风控总监";
      case APP_ROLES.BD_MANAGER:
        return "商务经理";
      case APP_ROLES.OPERATIONS:
        return "运营";
      default:
        return r;
    }
  };

  const unreadCount = useMemo(() => {
    try {
      const all = getNotificationLogs();
      const threshold = lastReadNotifAt || 0;
      return (Array.isArray(all) ? all : []).filter((entry) => {
        if (!entry || entry.id?.startsWith("n_demo")) return false;
        const t = Number(entry.payload?.timestamp ?? entry.id?.split("|").pop() ?? 0);
        return t > threshold;
      }).length;
    } catch {
      return 0;
    }
  }, [lastReadNotifAt, notifTick]);

  const markAllNotifsRead = () => {
    try {
      const t = Date.now();
      localStorage.setItem(LAST_READ_NOTIF_KEY, String(t));
      setLastReadNotifAt(t);
    } catch {}
  };

  return (
    <>
      <header className="app-topbar sticky top-0 z-40 h-14 shrink-0 border-b border-border/50 bg-background/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/40">
      <div className="flex h-full items-center gap-3 px-5 lg:px-6">
        <Link href="/" aria-label="RiskControl 首页" className="lg:hidden shrink-0"><Logo size={32} /></Link>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>

        <div
          data-topbar-search
          className={cn(
            "relative max-w-md flex-1 transition-all duration-300",
            searchFocused && "max-w-xl"
          )}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索批次号 / 客户姓名 / 商务经理 / 签约年份..."
            className="pl-10 h-9 bg-card border-border/70 focus:border-primary/40 focus:bg-background/80"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {quoteStatus && (
            <div className="hidden md:flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground" title={hasQuoteTime ? `行情时间：${new Date(quoteAsOf).toLocaleString('zh-CN')}；${nyse.shouldBreathe ? '交易时段' : '休市时段'}` : '尚未取得可核验的行情时间'}>
              <span className={cn('h-1.5 w-1.5 rounded-full', quoteFresh ? 'bg-success' : 'bg-warning')} />
              {quoteStatus}
            </div>
          )}

          {/* 实时股票行情徽章（TopBar「实时连接中」旁边展示）：真实数据直出，零任何模拟/抖动 */}
          {(() => {
            if (!quote.showOnTopBar) return null;
            const symbol = (quote.symbol || "").trim().toUpperCase();
            if (!symbol) return null;
            const price = liveQuote?.source !== "OFFLINE" ? liveQuote?.price ?? NaN : NaN;
            const chg = Number.isFinite(price) ? liveQuote?.changePct ?? NaN : NaN;
            const up = chg >= 0;
            const badge = (
              <button
                type="button"
                onClick={() => setKlineOpen(true)}
                className={cn(
                  "hidden xl:inline-flex items-center gap-2 pl-3 pr-3.5 py-1.5 rounded-lg bg-secondary/25 border border-border/50 hover:bg-secondary/60 hover:border-primary/30 transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                  quoteFlashDir === "up" && "animate-price-flash-up",
                  quoteFlashDir === "down" && "animate-price-flash-down",
                )}
                title={Number.isFinite(price) ? `${symbol} 最近行情 $${price.toFixed(2)} · 点击查看 K 线` : `${symbol} 行情暂不可用 · 点击查看 K 线`}
              >
                {quoteFetching ? (
                  <div className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    <span className="absolute inset-0 rounded-full border border-sky-300/35 animate-quote-fetch-ring" />
                    <span className="absolute inset-[2px] rounded-full border border-cyan-300/25 animate-quote-fetch-ring-delay" />
                    <span className="absolute inset-0 rounded-full border-t border-r border-sky-200/90 border-b-transparent border-l-transparent animate-quote-fetch-sweep" />
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.75)]" />
                  </div>
                ) : (
                  <LineChart className={cn("h-3.5 w-3.5 shrink-0", up ? "text-success" : "text-danger")} />
                )}
                <div className="flex flex-col leading-none">
                  <span className="text-[10.5px] font-mono font-bold uppercase tracking-wider text-foreground">{symbol}</span>
                </div>
                <span className="font-mono font-bold text-sm tabular-nums tracking-tight text-foreground">
                  {Number.isFinite(price) ? `$${price.toFixed(2)}` : '—'}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-mono font-semibold",
                    !Number.isFinite(chg) ? "hidden" : up ? quote.colorUp : quote.colorDown,
                    up ? "bg-success/10" : "bg-danger/10"
                  )}
                >
                  {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {up ? "+" : ""}{Number(chg || 0).toFixed(2)}%
                </span>
                {liveQuote?.stale && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                    <AlertTriangle className="h-3 w-3" />
                    行情失效
                  </span>
                )}
              </button>
            );
            return (
              <Tooltip>
                <TooltipTrigger asChild>{badge}</TooltipTrigger>
                <TooltipContent>
                  <div className="text-[11px] leading-relaxed">
                    <p className="font-semibold mb-0.5">{symbol}</p>
                    {Number.isFinite(price) ? <p>
                      最新价 <span className="font-mono font-bold">${Number(price).toFixed(2)}</span>
                      （日涨跌{" "}
                      <span className={cn(up ? "text-success" : "text-danger", "font-mono font-semibold")}>
                        {up ? "+" : ""}
                        {Number(chg).toFixed(2)}%
                      </span>
                      ）
                    </p> : <p>行情暂不可用</p>}
                    {liveQuote?.provider && (
                      <p className="text-muted-foreground mt-1">
                        数据源：{quoteProviderLabel(liveQuote.provider)}（{quoteSourceLabel(liveQuote)}）
                      </p>
                    )}
                    {liveQuote && (
                      <p className="text-muted-foreground mt-1">
                        行情时间：{new Date(liveQuote.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                        {liveQuote.stale && '（已失效，不参与风控计算）'}
                      </p>
                    )}
                    <p className="text-primary mt-1">点击打开 K 线图（多周期切换）</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })()}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                className={cn(isRefreshing && "text-primary")}
              >
                <RefreshCw
                  className={cn(
                    "h-4 w-4",
                    isRefreshing && "animate-spin"
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>刷新行情（{hydrated ? (nyse.shouldBreathe ? `${secondsLeft}s 后更新` : '已停止') : '准备中'}）</p>
            </TooltipContent>
          </Tooltip>

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/25 border border-border/50">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-mono font-medium tabular-nums tracking-tight">
              {hydrated && now ? formatDateTime(now) : '--'}
            </span>
          </div>

          <Dialog open={notifOpen} onOpenChange={(o) => {
            setNotifOpen(o);
            if (o) markAllNotifsRead();
          }}>
            <div className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative"
                    onClick={() => {
                      setNotifTick((t) => t + 1);
                      markAllNotifsRead();
                      setNotifOpen(true);
                    }}
                  >
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-danger animate-pulse" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{unreadCount > 0 ? `通知中心 · ${unreadCount} 条未读` : "通知中心"}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <NotificationDialogContent
              notifTick={notifTick}
              onRefresh={() => setNotifTick((t) => t + 1)}
            />
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-9 shrink-0 gap-2 px-2 pr-3 -mr-1 data-[state=open]:bg-accent/40 data-[state=open]:ring-1 data-[state=open]:ring-border/60 rounded-lg"
                onDoubleClick={(e) => {
                  e.preventDefault();
                  toast.success('已退出登录，跳转登录页...');
                  setTimeout(() => logoutToLogin(), 50);
                }}
                title="单击打开个人菜单，双击直接退出登录"
              >
                  <ClientAvatar
                    name={user?.bdManagerFullName || user?.displayName || "用户"}
                    role={role}
                    size="sm"
                    rounded="xl"
                  />
                <div className="hidden xl:flex flex-col text-left leading-tight">
                  <span className="text-xs font-semibold truncate max-w-[170px]">
                    {user?.displayName ?? 'Evan Pan'}
                  </span>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    {roleLabel(role)}
                    <ChevronDown className="h-3 w-3" />
                  </span>
                </div>
                <Badge variant={roleBadgeVariant(role)} className="hidden sm:inline-flex text-[9px] h-4 px-1.5 py-0 rounded-md">
                  {role === APP_ROLES.ADMIN ? 'ADMIN' : role === APP_ROLES.RISK_MANAGER ? 'RISK' : role === APP_ROLES.BD_MANAGER ? 'BD' : 'OPS'}
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[340px]">
              <div className="px-2.5 py-2.5 flex items-center gap-3 border-b border-border/50 mb-1">
                  <ClientAvatar
                    name={user?.bdManagerFullName || user?.displayName || "用户"}
                    role={role}
                    size="xl"
                    rounded="xl"
                  />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">
                    {user?.displayName ?? 'Evan Pan'}
                  </p>
                  <p className="text-[11px] font-mono text-muted-foreground truncate">
                    {user?.email ?? 'evan.pan@institution.com'}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Badge variant={roleBadgeVariant(role)} className="text-[10px] h-4">
                      {roleLabel(role)}
                    </Badge>
                    {user?.bdManagerFullName && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[170px]">
                        · {user.bdManagerFullName}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => {
                  toast.success('已退出登录，跳转登录页...');
                  setTimeout(() => logoutToLogin(), 50);
                }}
                className="text-xs font-semibold text-danger gap-2 focus:bg-danger/10 focus:text-danger"
              >
                <LogOut className="h-3.5 w-3.5" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="lg:hidden absolute top-14 left-0 right-0 border-b border-border/60 bg-background z-50 p-4 space-y-2 shadow-2xl">
          <Badge variant="danger" className="w-full justify-center py-2">
            🔒 锁仓期内禁止交易提示：3 个批次处于锁仓期
          </Badge>
        </div>
      )}
    </header>
    <KLineDialog
      open={klineOpen}
      symbol={(quote.symbol || "").trim().toUpperCase()}
      onOpenChange={setKlineOpen}
      anchorPrice={liveQuote?.price ?? null}
    />
    </>
  );
}

function NotificationDialogContent({
  notifTick,
  onRefresh,
}: {
  notifTick: number;
  onRefresh: () => void;
}) {
  const logs = useMemo<NotificationLogEntry[]>(() => {
    try {
      const all = getNotificationLogs();
      return Array.isArray(all) ? all.filter((entry) => !entry.id.startsWith("n_demo")).slice(0, 15) : [];
    } catch {}
    return [];
  }, [notifTick]);

  return (
    <DialogContent
      className="sm:max-w-[560px] p-0 overflow-hidden"
      onInteractOutside={(e) => { e.preventDefault(); }}
    >
      <DialogHeader className="p-4 pr-12 border-b border-border/50 flex flex-row items-center justify-between space-y-0">
        <div>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            通知中心
            <Badge variant="outline" className="ml-1 text-[10px] h-4 font-mono">{logs.length}</Badge>
          </DialogTitle>
          <DialogDescription className="text-[11px] mt-1 text-muted-foreground">
            通知 · 补仓预警 · 系统消息（最近 15 条）
          </DialogDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onRefresh} title="刷新">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </DialogHeader>
      <div className="max-h-[60vh] overflow-y-auto px-1 py-2">
        {logs.length === 0 ? (
          <div className="px-4 py-14 text-center text-muted-foreground text-xs">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-2 opacity-40" />
            暂无通知
          </div>
        ) : (
          <ul className="space-y-1 px-2 py-1">
            {logs.map((log) => {
              const type = String(log.payload?.type ?? "INFO");
              const priority = String(log.payload?.severity ?? "INFO");
              const isHigh = priority === "HIGH" || priority === "CRITICAL" || type === "MARGIN_CALL";
              const success = log.result?.success;
              const Icon = isHigh ? AlertTriangle : (success ? CheckCircle2 : Info);
              const accent = isHigh
                ? "text-danger"
                : success ? "text-success" : "text-primary";
              return (
                <li
                  key={log.id}
                  className="rounded-lg border border-border/40 bg-card/40 hover:bg-accent/30 transition-colors p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "h-8 w-8 shrink-0 rounded-lg flex items-center justify-center",
                      isHigh ? "bg-danger/10" : success ? "bg-success/10" : "bg-primary/10"
                    )}>
                      <Icon className={cn("h-4 w-4", accent)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-xs truncate">{log.payload?.title || "通知"}</p>
                        <Badge variant={isHigh ? "danger" : success ? "success" : "outline"} className="text-[9px] h-4 shrink-0">
                          {type === "MARGIN_CALL" ? "补仓预警" : priority || type}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                        {log.payload?.message || log.payload?.batchNumber
                          ? `${log.payload.batchNumber || ""} · ${log.payload.stockSymbol || ""} ${log.payload?.message || ""}`.trim()
                          : "系统消息"}
                      </p>
                      {log.result?.routing && <p className="text-[10px] text-muted-foreground mt-1">提交时：{log.result.routing.summary}；最新状态见发送记录。</p>}
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="secondary" className="text-[9px] h-4">
                            Email {notificationChannelLabel(log.result?.channels?.email)}
                          </Badge>
                          <Badge variant="secondary" className="text-[9px] h-4">
                            Telegram {notificationChannelLabel(log.result?.channels?.telegram)}
                          </Badge>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {formatDateTime(new Date(log.result?.sentAt || Date.now()))}
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <DialogFooter className="p-3 border-t border-border/50 flex flex-row justify-between items-center">
        <p className="text-[10px] text-muted-foreground">
          点击「系统设置 → 通知测试」可发送真实邮件 / Telegram
        </p>
        <DialogClose asChild>
          <Button variant="default" size="sm" className="text-xs px-3">
            关闭
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}
