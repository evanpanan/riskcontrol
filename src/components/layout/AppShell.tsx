"use client";

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
      <div className="flex min-h-screen w-full bg-background">
        <main className="flex-1 min-w-0 overflow-y-auto">
          {children}
        </main>
      </div>
    );
  }

  if (!hydrated || isLoading || !user) {
    return (
      <div className="flex min-h-screen w-full bg-background items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <div className="h-8 w-8 rounded-full border-2 border-border border-t-brand animate-spin" />
          <p className="text-xs font-mono">加载会话中…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-y-auto scrollbar-thin p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
