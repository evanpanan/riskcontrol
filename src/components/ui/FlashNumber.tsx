"use client";

import { memo, useEffect, useRef, useState } from "react";
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

export const FlashNumber = memo(function FlashNumber({
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
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelRaf = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };
  const clearFallback = () => {
    if (fallbackTimerRef.current !== null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  };
  const ensureFinalValueSoon = (target: number) => {
    clearFallback();
    fallbackTimerRef.current = setTimeout(() => {
      setDisplayValue(target);
      phaseRef.current = "idle";
      fallbackTimerRef.current = null;
    }, 1500);
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
        clearFallback();
        onDone?.();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    ensureFinalValueSoon(to);
  };

  const mountAnimatedKey = useRef<number>(0);
  useEffect(() => {
    const myKey = ++mountAnimatedKey.current;
    valueRef.current = value;

    if (!animateOnMount || value === 0) {
      setDisplayValue(value);
      phaseRef.current = "idle";
      clearFallback();
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
      if (myKey === mountAnimatedKey.current) {
        cancelRaf();
        clearTimeout(tFlash);
        clearFallback();
        phaseRef.current = "idle";
        mountAnimatedKey.current = 0;
        setFlash(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phaseRef.current === "idle" && displayValue === 0 && value !== 0) {
      phaseRef.current = "mounting";
      setFlash(value >= 0 ? "up" : "down");
      runTween(0, value);
      const t = setTimeout(() => setFlash(null), 1400);
      return () => clearTimeout(t);
    }
    if (value === valueRef.current) {
      if (
        phaseRef.current === "idle" &&
        Math.abs(displayValue - value) > Math.max(1e-6, Math.abs(value) * 1e-4)
      ) {
        setDisplayValue(value);
      }
      return;
    }
    const prev = valueRef.current;
    valueRef.current = value;
    setFlash(value > prev ? "up" : "down");
    phaseRef.current = "updating";
    runTween(displayValue, value);
    const t = setTimeout(() => setFlash(null), 950);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    return () => {
      cancelRaf();
      clearFallback();
    };
  }, []);

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
});
