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
        // ============================================================
        // CHUNK-LOAD FALLBACK (dev HMR recovery, executes BEFORE React mounts)
        // Fixes the exact symptom: user clicks login → React chunks
        // /_next/static/chunks/{main-app,app-pages-internals,app/login/page,app/layout}.js
        // all return 404 because Next 14.2.8 dev HMR invalidation → login
        // page renders as SSR nodes=3 empty shell and button click has no
        // handler → "登录失败闪烁一下". 下面这一段 inline script 永远会：
        //   1) 监听 4 个核心 script 的 onerror；
        //   2) 2000ms 内 #__next 里还是空的 → 自动 reload 1 次；
        //   3) __RC_RELOADED_BY_CHUNK_GUARD__ 防止 reload 循环。
        // ============================================================
        try {
          var GUARD_KEY = "__RC_RELOADED_BY_CHUNK_GUARD__";
          var isDev = (${JSON.stringify(process.env.NODE_ENV)} === "development") || /localhost|127\\.0\\.0\\.1|:300[0-9]$/.test(window.location.host);
          if (isDev && !window.sessionStorage.getItem(GUARD_KEY)) {
            var badChunk = false;
            var markBad = function() { badChunk = true; };
            // 404-recovery: capture any script that fails whose src.startsWith('/_next/static/chunks/')
            window.addEventListener('error', function(ev) {
              try {
                var t = ev && ev.target;
                if (t && t.tagName && t.tagName.toLowerCase() === 'script' && t.src && t.src.indexOf('/_next/static/chunks/') >= 0) {
                  badChunk = true;
                }
              } catch(e) {}
            }, true);
            // 2000ms 之内如果 #__next 还是空壳，**同时必须 badChunk 已经命中**（说明
            // 真的有 /_next/static/chunks/* script 加载失败才是 chunk 404 的场景），
            // 才 reload 1 次。否则正常 React hydrate 本身就需要 2-3s，不要误 reload。
            window.setTimeout(function() {
              try {
                var next = document.getElementById('__next');
                var hasMain = next && next.querySelector && !!next.querySelector('main');
                // empty = 没有 #__next 或 #__next 下一个 main 都没有（连 SSR HTML 都没渲出来）
                var empty = !next || !hasMain;
                if (badChunk && empty) {
                  window.sessionStorage.setItem(GUARD_KEY, '1');
                  window.location.reload();
                }
              } catch(e) {}
            }, 2500);
          }
        } catch (_chunkGuardErr) {}

        // 1) 先判定环境，非开发环境直接退出，不注册任何重置能力
        var devMode = (${JSON.stringify(process.env.NODE_ENV)} === "development")
          || /localhost|127\\.0\\.0\\.1|:300[0-9]$/.test(window.location.host);
        if (!devMode) return;

        // 2) 仅在 devMode 成立时才挂载重置函数
        window.__RISK_RESET_TEST_DATA__ = function(silent, noBackup) {
          try {
            if (!noBackup) {
              var ts = Date.now();
              var backup = {};
              RAW_KEYS.forEach(function(k) {
                var v = window.localStorage.getItem(k);
                if (v != null) backup[k] = v;
              });
              window.localStorage.setItem("risk_control_test_backup_" + ts, JSON.stringify({ createdAt: new Date().toISOString(), records: backup }));
            } else {
              try {
                for (var i = window.localStorage.length - 1; i >= 0; i--) {
                  var k2 = window.localStorage.key(i);
                  if (k2 && k2.indexOf("risk_control_test_backup_") === 0) window.localStorage.removeItem(k2);
                }
              } catch (_bkCleanup) {}
            }
            RAW_KEYS.forEach(function(k) { window.localStorage.removeItem(k); });
            if (!silent) setTimeout(function(){ window.location.reload(); }, 30);
            return true;
          } catch (e) {
            if (!silent) alert("清空失败：" + (e && e.message ? e.message : e));
            return false;
          }
        };

        // 3) 新增：从指定时间戳的备份恢复（AC-1.4）
        window.__RISK_RESTORE_TEST_BACKUP__ = function(ts) {
          try {
            var raw = window.localStorage.getItem("risk_control_test_backup_" + ts);
            if (!raw) return false;
            var payload = JSON.parse(raw);
            var records = payload && payload.records ? payload.records : {};
            Object.keys(records).forEach(function(k) {
              if (records[k] == null) {
                window.localStorage.removeItem(k);
              } else {
                window.localStorage.setItem(k, records[k]);
              }
            });
            setTimeout(function(){ window.location.reload(); }, 30);
            return true;
          } catch (e) {
            alert("恢复失败：" + (e && e.message ? e.message : e));
            return false;
          }
        };

        // 4) 新增：列出所有可用备份的时间戳（倒序返回，最新在前）
        window.__RISK_LIST_TEST_BACKUPS__ = function() {
          var out = [];
          try {
            for (var i = 0; i < window.localStorage.length; i++) {
              var k = window.localStorage.key(i);
              if (k && k.indexOf("risk_control_test_backup_") === 0) {
                out.push(k.replace("risk_control_test_backup_", ""));
              }
            }
          } catch (_e) {}
          out.sort(function(a, b) { return Number(b) - Number(a); });
          return out;
        };
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
