"use client";

import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const LOGO_LS_KEY = "risk_control_logo_v1";

export function getStoredLogo(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LOGO_LS_KEY);
  } catch {
    return null;
  }
}

export function setStoredLogo(dataUrl: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (dataUrl && dataUrl.length > 2) window.localStorage.setItem(LOGO_LS_KEY, dataUrl);
    else window.localStorage.removeItem(LOGO_LS_KEY);
    window.dispatchEvent(new CustomEvent("risk-control:logo-changed"));
  } catch {
    /* ignore */
  }
}

interface LogoProps {
  className?: string;
  iconClassName?: string;
  size?: number;
}

export function Logo({ className, iconClassName, size = 40 }: LogoProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    setDataUrl(getStoredLogo());
    const onChange = () => setDataUrl(getStoredLogo());
    window.addEventListener("risk-control:logo-changed", onChange);
    window.addEventListener("storage", (e) => {
      if (e.key === LOGO_LS_KEY) onChange();
    });
    return () => {
      window.removeEventListener("risk-control:logo-changed", onChange);
      window.removeEventListener("storage", onChange as any);
    };
  }, []);

  if (dataUrl) {
    return (
      <div
        className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-lg shadow-primary/30", className)}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dataUrl}
          alt="Logo"
          className="h-full w-full object-contain"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-xl shadow-lg shadow-primary/30 gradient-primary",
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className={cn("text-primary-foreground", iconClassName)}
        width={Math.round(size * 0.55)}
        height={Math.round(size * 0.55)}
      >
        <path
          d="M12 2L3 6v6c0 5.25 3.75 10.13 9 11 5.25-.88 9-5.75 9-11V6l-9-4z"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinejoin="round"
          fill="currentColor"
          fillOpacity={0.12}
        />
        <path
          d="M9 12l2 2 4-4"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <Shield className="sr-only" />
    </div>
  );
}

export const LOGO_STORAGE_KEY = LOGO_LS_KEY;
