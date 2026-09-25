"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState, ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  offsetY?: number;
  durationMs?: number;
  once?: boolean;
}

export function Reveal({
  children,
  className,
  delayMs = 0,
  offsetY = 18,
  durationMs = 650,
  once = true,
}: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }

    let cancelled = false;
    const alreadyPast = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      if (!vh) return false;
      if (r.top < vh - 4) return true;
      if (r.bottom < 4) return true;
      return false;
    };

    const showNow = () => {
      if (!cancelled) setVisible(true);
    };

    const check = () => {
      if (cancelled) return false;
      if (alreadyPast()) {
        showNow();
        return true;
      }
      return false;
    };

    if (check()) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const show = () => {
              if (!cancelled) setVisible(true);
            };
            if (delayMs > 0) window.setTimeout(show, delayMs);
            else show();
            if (once) io.unobserve(entry.target);
          } else if (!once) {
            if (!cancelled) setVisible(false);
          }
        }
      },
      {
        root: null,
        rootMargin: "0px 0px -6% 0px",
        threshold: [0, 0.04, 0.08],
      }
    );
    io.observe(el);

    const fallbackInterval = window.setInterval(() => {
      if (cancelled) return;
      if (alreadyPast()) {
        if (delayMs > 0) window.setTimeout(showNow, delayMs);
        else showNow();
        window.clearInterval(fallbackInterval);
      }
    }, 280);

    return () => {
      cancelled = true;
      io.disconnect();
      if (fallbackInterval) window.clearInterval(fallbackInterval);
    };
  }, [delayMs, once]);

  return (
    <div
      ref={ref}
      className={cn("will-change-transform", className)}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0px)" : `translateY(${offsetY}px)`,
        transition: visible
          ? `opacity ${durationMs}ms ease-out ${delayMs}ms, transform ${durationMs}ms cubic-bezier(0.2, 0.7, 0.2, 1) ${delayMs}ms`
          : "none",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}

export default Reveal;
