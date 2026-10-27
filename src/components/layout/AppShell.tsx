"use client";
import { loadServerLedger, clearServerLedger, isServerLedgerMode } from "@/lib/mockData";

import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/auth/useCurrentUser";
import { useEffect, useState } from "react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const isAuthRoute = pathname.startsWith("/login");
  const { user, isLoading } = useCurrentUser();
  const userId = user?.id;
  const [quoteError,setQuoteError] = useState('');
  useEffect(()=>{const listener=(e:Event)=>setQuoteError((e as CustomEvent).detail);window.addEventListener('risk-control:quote-error',listener);return()=>window.removeEventListener('risk-control:quote-error',listener);},[]);
  const [ledgerReady, setLedgerReady] = useState(false);
  const [ledgerError,setLedgerError] = useState('');
  useEffect(()=>{
    if(!userId || isAuthRoute) {clearServerLedger();setLedgerReady(false);return;}
    let active=true;
    setLedgerReady(false);setLedgerError('');clearServerLedger();
    const load=async()=>{try{await loadServerLedger();if(active){setLedgerReady(true);setLedgerError('');}}catch(e){if(active)setLedgerError((e as Error).message);}};
    void load();const timer=setInterval(()=>void load(),30000);
    return ()=>{active=false;clearInterval(timer);};
  },[userId,user?.role,isAuthRoute]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || isLoading) return;
    if (isAuthRoute) return;
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

  if(isServerLedgerMode() && (!ledgerReady || ledgerError)) return <div className="p-8 text-sm">{ledgerError || '加载服务端账本中…'}{ledgerError && <button className="ml-4 underline" onClick={()=>window.location.reload()}>重试</button>}</div>;
  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />
        {quoteError && <div role="alert" className="px-6 py-2 text-sm text-warning">行情尚未更新：{quoteError}。补仓和结算会检查参考价时效。</div>}
        <main className="flex-1 overflow-y-auto scrollbar-thin p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
