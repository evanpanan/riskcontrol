"use client";

import { cn, pickGradientForName, getInitialsCn, getFirstCharCn } from "@/lib/utils";

export interface ClientAvatarProps {
  name: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  mode?: "initials" | "single-char";
  rounded?: "lg" | "xl" | "full";
  role?: string;
}

const SIZE_MAP: Record<NonNullable<ClientAvatarProps["size"]>, string> = {
  xs: "h-6 w-6 text-[9px]",
  sm: "h-8 w-8 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-10 w-10 text-sm",
  xl: "h-11 w-11 text-sm",
};

const ROUNDED_MAP: Record<NonNullable<ClientAvatarProps["rounded"]>, string> = {
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-full",
};

export function ClientAvatar({
  name,
  size = "md",
  className,
  mode = "single-char",
  rounded = "xl",
  role,
}: ClientAvatarProps) {
  const gradient = role === "ADMIN"
    ? "from-red-600 via-rose-600 to-orange-500"
    : pickGradientForName(name || "用户");
  const label =
    mode === "initials" ? getInitialsCn(name ?? "Unknown") : getFirstCharCn(name ?? "Unknown");

  return (
    <div
      aria-hidden
      className={cn(
        "bg-gradient-to-br flex shrink-0 items-center justify-center font-bold text-white shadow-sm",
        gradient,
        SIZE_MAP[size],
        ROUNDED_MAP[rounded],
        className
      )}
    >
      <span className="leading-none tracking-tight">{label}</span>
    </div>
  );
}

export default ClientAvatar;
