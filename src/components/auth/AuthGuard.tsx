'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import Link from 'next/link';
import { ShieldAlert, Home, ArrowLeft } from 'lucide-react';
import { useCurrentUser } from '@/lib/auth/useCurrentUser';
import { logAuthDeny } from '@/lib/auth/audit';
import type { AppRole, AppSessionUser } from '@/types/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface AuthGuardProps {
  route: string;
  allowed: readonly AppRole[];
  children: ReactNode;
  redirectUnauthorizedTo?: string;
  showToast?: boolean;
  renderFallback?: (p: { user: AppSessionUser | null; role: AppRole; allowed: readonly AppRole[]; goHome: string }) => ReactNode;
}

export function AuthGuard({
  route,
  allowed,
  children,
  redirectUnauthorizedTo = '/',
  showToast = true,
  renderFallback,
}: AuthGuardProps) {
  const { user, role, isLoading } = useCurrentUser();

  useEffect(() => {
    if (isLoading) return;
    if (!allowed.includes(role)) {
      logAuthDeny({
        action: 'route_blocked',
        resource: route,
        reason: `role_not_in_allowed_list:${role}`,
        userId: user?.id,
        role,
      });
      if (showToast) {
        toast.error(`当前账号无权限访问该页面，已限制显示（${route}）`);
      }
    }
  }, [allowed, isLoading, role, route, showToast, user?.id]);

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-12 text-center text-muted-foreground text-sm">
          正在校验权限…
        </CardContent>
      </Card>
    );
  }

  if (allowed.includes(role)) {
    return <>{children}</>;
  }

  if (renderFallback) {
    return <>{renderFallback({ user, role, allowed, goHome: redirectUnauthorizedTo })}</>;
  }

  return (
    <Card className="border-danger/30 bg-danger/5">
      <CardContent className="py-12 px-8 text-center space-y-5">
        <div className="mx-auto h-16 w-16 rounded-full bg-danger/10 border border-danger/30 flex items-center justify-center">
          <ShieldAlert className="h-8 w-8 text-danger" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold">权限受限 · 禁止访问</h2>
          <p className="text-sm text-muted-foreground">
            您当前的登录账号角色为
            <Badge variant="outline" className="mx-1.5 align-middle">
              {role}
            </Badge>
            ，不在页面 <code className="font-mono text-xs">{route}</code> 的允许列表中。
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            允许访问角色：
            {allowed.map((r, i) => (
              <span key={r} className="mx-1 font-semibold">{r}{i < allowed.length - 1 ? '、' : ''}</span>
            ))}
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Button asChild variant="default" className="gap-1.5">
            <Link href={redirectUnauthorizedTo}>
              <Home className="h-4 w-4" />
              返回风控大盘
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-1.5">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              回到首页
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
