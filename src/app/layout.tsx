import type { Metadata } from "next";
import { Inter as FontSans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth/authProvider";
import { Toaster } from "sonner";

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "优先劣后股票产品全景风控预警系统 | Risk Control",
  description: "Priority-Subordinate Stock Product Full-Spectrum Risk Control & Early Warning System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (!document.documentElement.classList.contains('dark')) {
                  document.documentElement.classList.add('dark');
                }
              } catch (_) {}
            `,
          }}
        />
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
