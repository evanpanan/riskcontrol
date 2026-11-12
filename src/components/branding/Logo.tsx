"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { readSharedSetting, writeSharedSetting } from "@/lib/settingsStore";
import { WORKSPACE_SYNCED_EVENT } from "@/lib/workspaceStore";

const LOGO_LS_KEY = "risk_control_logo_win100_v2";

export function getStoredLogo(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return readSharedSetting(LOGO_LS_KEY);
  } catch {
    return null;
  }
}

export function setStoredLogo(dataUrl: string | null): void {
  if (typeof window === "undefined") return;
  try {
    writeSharedSetting(LOGO_LS_KEY, dataUrl && dataUrl.length > 2 ? dataUrl : null);
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
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setDataUrl(getStoredLogo());
    const onChange = () => { setFailed(false); setDataUrl(getStoredLogo()); };
    window.addEventListener("risk-control:logo-changed", onChange);
    window.addEventListener(WORKSPACE_SYNCED_EVENT, onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOGO_LS_KEY) onChange();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("risk-control:logo-changed", onChange);
      window.removeEventListener(WORKSPACE_SYNCED_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  if (dataUrl && !failed) {
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
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-[#111d29] ring-1 ring-[#c9ad70]/35", className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" role="img" aria-label="Win100 机构标志" className={iconClassName} width={size} height={size}>
        <path d="M12 15l8 22 12-17 12 17 8-22" fill="none" stroke="#d8bf86" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <text x="32" y="53" textAnchor="middle" fill="#ead8ac" fontFamily="Arial,sans-serif" fontWeight="700" fontSize="13" letterSpacing="1">100</text>
      </svg>
    </div>
  );
}

export const LOGO_STORAGE_KEY = LOGO_LS_KEY;
