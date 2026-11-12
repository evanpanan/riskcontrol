"use client";

import { Logo } from "@/components/branding/Logo";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { WORKSPACE_ERROR_EVENT } from "@/lib/workspaceStore";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const isAuthRoute = pathname.startsWith("/login");
  const { user, isLoading } = useCurrentUser();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  // 工作区落库失败必须让操作员看见：此前失败只写控制台，界面仍显示为已保存。
  useEffect(() => {
    let lastAt = 0;
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<{ message?: string }>).detail;
      const now = Date.now();
      if (now - lastAt < 5000) return;
      lastAt = now;
      toast.error(detail?.message || "数据未能保存到服务器，请刷新页面后重试");
    };
    window.addEventListener(WORKSPACE_ERROR_EVENT, handler);
    return () => window.removeEventListener(WORKSPACE_ERROR_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!hydrated || isLoading) return;
    if (isAuthRoute) {
      if (user) {
        const dest = (pathname.split("?next=")[1] as string | undefined) || "/";
        router.replace(decodeURIComponent(dest));
      }
      return;
    }
    if (!user) {
      const qs = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${qs}`);
    }
  }, [hydrated, isLoading, user, isAuthRoute, pathname, router]);

  if (isAuthRoute) {
    return (
      <div className="app-shell flex min-h-screen w-full bg-background">
        <main className="flex-1 min-w-0 overflow-y-auto">
          {children}
        </main>
      </div>
    );
  }

  if (!hydrated || isLoading || !user) {
    return (
      <div className="app-shell flex min-h-screen w-full bg-background items-center justify-center">
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-5 text-center">
          <div className="relative flex h-24 w-24 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-primary/15" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary border-r-primary/30 animate-spin motion-reduce:animate-none" />
            <div className="absolute inset-2 rounded-full bg-primary/5 animate-pulse motion-reduce:animate-none" />
            <Logo size={48} />
          </div>
          <div className="space-y-2"><p className="text-lg font-semibold tracking-tight">RiskControl</p><p className="text-xs text-muted-foreground">正在安全连接您的工作台</p></div>
          <div className="flex gap-1.5" aria-hidden="true">{[0, 150, 300].map(delay => <span key={delay} className="h-1 w-1 rounded-full bg-primary/70 animate-pulse motion-reduce:animate-none" style={{ animationDelay: `${delay}ms` }} />)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />
        <main className="app-content flex-1 overflow-y-auto scrollbar-thin p-4 sm:p-5 xl:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
