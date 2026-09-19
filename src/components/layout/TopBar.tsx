"use client";

import { Bell, Search, RefreshCw, ChevronDown, Clock, RadioTower, Menu, X, Shield } from "lucide-react";
import { useState, useEffect } from "react";
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
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import type { AppSessionUser, AppRole } from "@/types/auth";
import { APP_ROLES } from "@/types/auth";
import { toast } from "sonner";

export function TopBar() {
  const [now, setNow] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [secondsAgo, setSecondsAgo] = useState(0);
  const { user, role, switchToMockRole, forceLogout } = useCurrentUser();

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
      case APP_ROLES.RISK_MANAGER:
        return "风控总监";
      case APP_ROLES.BD_MANAGER:
        return "BD经理";
      case APP_ROLES.OPERATIONS:
        return "运营";
      default:
        return r;
    }
  };

  return (
    <header className="sticky top-0 z-40 h-14 shrink-0 border-b border-border/50 bg-background/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/40">
      <div className="flex h-full items-center gap-3 px-5 lg:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>

        <div
          className={cn(
            "relative max-w-md flex-1 transition-all duration-300",
            searchFocused && "max-w-xl"
          )}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索批次号 / 客户姓名 / 股票代码 / BD经理..."
            className="pl-10 h-9 bg-secondary/40 border-transparent focus:border-primary/40 focus:bg-background/80"
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
                {formatAgo(secondsAgo)}更新
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
              <p>刷新行情（{secondsAgo}s 前更新）</p>
            </TooltipContent>
          </Tooltip>

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/40 border border-border/40">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-mono font-medium tabular-nums tracking-tight">
              {formatDateTime(now)}
            </span>
          </div>

          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                  <Bell className="h-4 w-4" />
                  <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-danger" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>通知中心 (3 条未读)</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 shrink-0 gap-2 px-2 pr-3 -mr-1 data-[state=open]:bg-accent/40 data-[state=open]:ring-1 data-[state=open]:ring-border/60 rounded-lg">
                <div className="h-8 w-8 shrink-0 rounded-xl gradient-primary flex items-center justify-center shadow-md shadow-primary/20">
                  <span className="text-[11px] font-bold text-primary-foreground">
                    {user?.avatarInitials ?? 'EP'}
                  </span>
                </div>
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
                  {role === APP_ROLES.RISK_MANAGER ? 'RISK' : role === APP_ROLES.BD_MANAGER ? 'BD' : 'OPS'}
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[340px]">
              <div className="px-2.5 py-2.5 flex items-center gap-3 border-b border-border/50 mb-1">
                <div className="h-11 w-11 rounded-xl gradient-primary flex items-center justify-center shadow-md shadow-primary/20 shrink-0">
                  <span className="text-xs font-bold text-primary-foreground">
                    {user?.avatarInitials ?? 'EP'}
                  </span>
                </div>
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

              <div className="px-2.5 py-2 rounded-lg bg-secondary/30 border border-border/40 mx-1 mb-1 mt-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Shield className="h-3 w-3" />
                  <span>生产模式扩展点（当前 mock）</span>
                </p>
                <p className="text-[10px] text-muted-foreground/80 mt-1 leading-relaxed">
                  设置 <code className="font-mono text-[9px] bg-background rounded px-1 py-0.5 border border-border/50">
                    NEXT_PUBLIC_AUTH_PROVIDER=supabase
                  </code> 即可接入真实 Supabase Auth。
                </p>
              </div>

              <DropdownMenuItem
                onClick={() => {
                  forceLogout();
                  toast.success('演示会话已清理，已恢复默认风控总监 Evan Pan');
                }}
                className="text-xs text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
                重置为风控总监（清 Mock Session）
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
