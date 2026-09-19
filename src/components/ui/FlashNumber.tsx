"use client";

import { useEffect, useRef, useState } from "react";
import { cn, formatCurrency, formatPercent, formatCompactNumber } from "@/lib/utils";

type Formatter = "currency" | "percent" | "number" | "dollarCompact";

interface FlashNumberProps {
  value: number;
  formatter?: Formatter;
  className?: string;
  prefix?: string;
  suffix?: string;
  digits?: number;
  compare?: "self" | number;
  animateOnMount?: boolean;
}

const format = (v: number, f: Formatter, digits: number) => {
  switch (f) {
    case "currency":
      return formatCurrency(v);
    case "percent":
      return formatPercent(v, digits);
    case "number":
      return v.toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
    case "dollarCompact": {
      const sign = v >= 0 ? "+" : "-";
      return `${sign}$${formatCompactNumber(Math.abs(v))}`;
    }
  }
};

const easeOutExpo = (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));

export function isMarketOpenNow(now = new Date()): boolean {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const byKey: Record<string, string> = {};
    for (const p of parts) byKey[p.type] = p.value;
    const hour = Number(byKey.hour ?? "0");
    const minute = Number(byKey.minute ?? "0");
    const t = hour + minute / 60;
    const weekday = byKey.weekday?.toLowerCase() ?? "";
    if (weekday === "sat" || weekday === "sun") return false;
    return t >= 9.5 && t < 16;
  } catch {
    const h = now.getHours();
    return (h >= 9 && h < 12) || (h >= 13 && h < 16) || (h >= 21 && h <= 23);
  }
}

export function FlashNumber({
  value,
  formatter = "number",
  className,
  prefix = "",
  suffix = "",
  digits = 2,
  animateOnMount = true,
}: FlashNumberProps) {
  const valueRef = useRef<number>(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef<"idle" | "mounting" | "updating">("idle");
  const finalValueOnMount = useRef<number>(animateOnMount ? 0 : value);
  const [displayValue, setDisplayValue] = useState<number>(
    animateOnMount ? 0 : value
  );

  const cancelRaf = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const runTween = (from: number, to: number, onDone?: () => void) => {
    cancelRaf();
    const start = performance.now();
    const mag = Math.abs(to - from);
    const duration = Math.max(
      400,
      Math.min(1400, 520 + Math.min(800, mag / 45000))
    );
    const diff = to - from;

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = easeOutExpo(p);
      const cur = from + diff * eased;
      setDisplayValue(cur);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplayValue(to);
        rafRef.current = null;
        phaseRef.current = "idle";
        onDone?.();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // 唯一标记「本次挂载是否已完成 mount 动画」的实例级 key
  const mountAnimatedKey = useRef<number>(0);
  useEffect(() => {
    const myKey = ++mountAnimatedKey.current;
    valueRef.current = value;

    if (!animateOnMount || value === 0) {
      setDisplayValue(value);
      phaseRef.current = "idle";
      return () => {
        if (myKey === mountAnimatedKey.current) {
          cancelRaf();
        }
      };
    }

    phaseRef.current = "mounting";
    finalValueOnMount.current = value;
    setFlash(value >= 0 ? "up" : "down");
    runTween(0, value);
    const tFlash = setTimeout(() => setFlash(null), 1400);

    return () => {
      // Strict 模式下：第一次 unmount 时，停止 tween + 重置关键标记，
      // 让第二次 (真实挂载) mount effect 再重新启动动画。
      if (myKey === mountAnimatedKey.current) {
        cancelRaf();
        clearTimeout(tFlash);
        phaseRef.current = "idle";
        mountAnimatedKey.current = 0;
        setFlash(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // mount 刚过（或 Strict 双调用后真的挂载）时，
    // 如果 displayValue 仍为 0 但目标 value != 0 → 强制追一次
    if (phaseRef.current === "idle" && displayValue === 0 && value !== 0) {
      phaseRef.current = "mounting";
      setFlash(value >= 0 ? "up" : "down");
      runTween(0, value);
      const t = setTimeout(() => setFlash(null), 1400);
      return () => clearTimeout(t);
    }
    if (value === valueRef.current) return;
    const prev = valueRef.current;
    valueRef.current = value;
    setFlash(value > prev ? "up" : "down");
    phaseRef.current = "updating";
    runTween(displayValue, value);
    const t = setTimeout(() => setFlash(null), 950);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => cancelRaf, []);

  return (
    <span
      className={cn(
        "inline-flex items-baseline tabular-nums px-1.5 -mx-1.5 rounded-md transition-colors",
        flash === "up" && "animate-flash-up",
        flash === "down" && "animate-flash-down",
        className
      )}
    >
      {prefix}
      {format(displayValue, formatter, digits)}
      {suffix}
    </span>
  );
}
