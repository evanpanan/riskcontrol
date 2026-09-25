import type { Metadata } from "next";
import { Inter as FontSans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth/authProvider";
import { Toaster } from "sonner";
import { FINANCE_STORE_KEY, FINANCE_STORE_KEY_LEGACY } from "@/lib/mockData";

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "优先劣后股票产品全景风控预警系统 | Risk Control",
  description: "Priority-Subordinate Stock Product Full-Spectrum Risk Control & Early Warning System",
};

const RAW_KEYS = [
  FINANCE_STORE_KEY,
  FINANCE_STORE_KEY_LEGACY,
  "risk_control_mock_margin_patches_v1",
  "risk_control_client_status_v1",
  "risk_control_notifications_v1",
  "risk_control_xmax_notifications_v1",
  "risk_control_alert_ack_v1",
  "risk_control_xmax_alert_ack_v1",
];

/** 开发环境 + 旧账本里没有任何真实结算/已执行补仓 → 判定为纯测试数据，可放心重建 */
function isPristineStore(store: any): boolean {
  if (!store || typeof store !== "object" || Array.isArray(store)) return false;
  const entries = Object.values(store);
  if (!entries.length) return false;
  return entries.every((entry: any) => {
    const f = entry && entry.batch && entry.batch.finance;
    if (!f) return true;
    if (f.settlements && Object.keys(f.settlements).length) return false;
    if ((f.rounds || []).some((r: any) => Number(r.fulfilledAmount || 0) > 0.005)) return false;
    if ((f.trades || []).some((t: any) => (t.source || "legacy") !== "legacy")) return false;
    return true;
  });
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const inlineBootstrap = `
    try {
      if (!document.documentElement.classList.contains('dark')) {
        document.documentElement.classList.add('dark');
      }
      (function() {
        var LS_KEY = ${JSON.stringify(FINANCE_STORE_KEY)};
        var RAW_KEYS = ${JSON.stringify(RAW_KEYS)};
        window.__RISK_RESET_TEST_DATA__ = function(silent) {
          try {
            var ts = Date.now();
            var backup = {};
            RAW_KEYS.forEach(function(k) {
              var v = window.localStorage.getItem(k);
              if (v != null) backup[k] = v;
            });
            window.localStorage.setItem("risk_control_test_backup_" + ts, JSON.stringify({ createdAt: new Date().toISOString(), records: backup }));
            RAW_KEYS.forEach(function(k) { window.localStorage.removeItem(k); });
            if (!silent) setTimeout(function(){ window.location.reload(); }, 30);
            return true;
          } catch (e) {
            if (!silent) alert("清空失败：" + (e && e.message ? e.message : e));
            return false;
          }
        };
        var devMode = (${JSON.stringify(process.env.NODE_ENV)} === "development")
          || /localhost|127\\.0\\.0\\.1|:300[0-9]$/.test(window.location.host);
        if (!devMode) return;
      })();
    } catch (_) {}
  `;

  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: inlineBootstrap }} />
      </head>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          fontSans.variable
        )}
      >
        <AuthProvider>
          <TooltipProvider delayDuration={150}>
            <AppShell>{children}</AppShell>
            <Toaster richColors position="top-right" closeButton toastOptions={{ className: 'rounded-xl border border-border/60' }} />
          </TooltipProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
