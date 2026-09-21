"use client";

import { Bell, Search, RefreshCw, ChevronDown, Clock, RadioTower, Menu, X, LogOut, ImagePlus, AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
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
import { getNotificationLogs, type NotificationLogEntry, type NotificationPayload } from "@/lib/notifier";
import { toast } from "sonner";

export function TopBar() {
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifTick, setNotifTick] = useState(0);
  const { user, role, logoutToLogin } = useCurrentUser();

  useEffect(() => {
    setHydrated(true);
    const t = Date.now();
    setNow(new Date(t));
    setLastUpdated(t);
  }, []);

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
      setSecondsAgo(Math.floor((Date.now() - lastUpdated) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [lastUpdated]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      setLastUpdated(Date.now());
      setSecondsAgo(0);
    }, 1500);
  };

  const formatAgo = (s: number) => {
    if (s < 60) return `${s} 秒前`;
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    return `${Math.floor(s / 3600)} 小时前`;
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

  return (
    <header className="sticky top-0 z-40 h-14 shrink-0 border-b border-border/50 bg-background/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/40">
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
            placeholder="搜索批次号 / 客户姓名 / 股票代码 / 商务经理..."
            className="pl-10 h-9 bg-secondary/40 border-transparent focus:border-primary/40 focus:bg-background/80"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2.5 pl-3 pr-3.5 py-1.5 rounded-full bg-secondary/40 border border-border/40">
            <div className="relative flex items-center justify-center w-5 h-5">
              <span className="absolute inline-flex h-2.5 w-2.5 rounded-full bg-success animate-pulse-green" />
              <span className="sr-only">Online</span>
            </div>
            <RadioTower className="h-3.5 w-3.5 text-success" />
            <div className="flex items-center gap-1.5 text-xs leading-none">
              <span className="font-medium text-foreground">实时连接中</span>
              <span className="text-muted-foreground/80">|</span>
              <span className="font-mono text-muted-foreground tabular-nums">
                {hydrated ? `${formatAgo(secondsAgo)}更新` : '准备中'}
              </span>
            </div>
          </div>

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
              <p>刷新行情（{hydrated ? `${secondsAgo}s 前更新` : '准备中'}）</p>
            </TooltipContent>
          </Tooltip>

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/40 border border-border/40">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-mono font-medium tabular-nums tracking-tight">
              {hydrated && now ? formatDateTime(now) : '--'}
            </span>
          </div>

          <Dialog open={notifOpen} onOpenChange={setNotifOpen}>
            <div className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative"
                    onClick={() => {
                      setNotifTick((t) => t + 1);
                      setNotifOpen(true);
                    }}
                  >
                    <Bell className="h-4 w-4" />
                    <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-danger" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>通知中心</p>
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
                <div className="hidden md:flex flex-col text-left leading-tight">
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
      <DialogHeader className="p-4 border-b border-border/50 flex flex-row items-center justify-between space-y-0">
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
          <DialogClose asChild>
            <Button variant="ghost" size="icon">
              <XCircle className="h-4 w-4" />
            </Button>
          </DialogClose>
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
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="secondary" className="text-[9px] h-4">
                            Email {log.payload.recipients.emails.length === 0 ? "未请求" : log.result.channels?.email?.success ? "已受理" : "失败/部分失败"}
                          </Badge>
                          <Badge variant="secondary" className="text-[9px] h-4">
                            WhatsApp {log.payload.recipients.whatsapps.length === 0 ? "未请求" : log.result.channels?.whatsapp?.success ? "已受理" : "失败/部分失败"}
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
          点击「系统设置 → 通知测试」可发送真实邮件 / WhatsApp
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
