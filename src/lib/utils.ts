import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, differenceInMonths, addMonths, differenceInDays, differenceInHours, differenceInMinutes } from "date-fns";
import { zhCN } from "date-fns/locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number, digits: number = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true, locale: zhCN });
}

export interface TradingWindowInfo {
  monthsElapsed: number;
  isLocked: boolean;
  isTradingWindow: boolean;
  nextTradingDate: Date | null;
  nextTradingMonth: number;
  countdownText: string;
  tradingWindows: { month: number; date: Date; passed: boolean }[];
}

export function calculateTradingWindows(signDate: Date | string): TradingWindowInfo {
  const sign = typeof signDate === "string" ? new Date(signDate) : signDate;
  const now = new Date();
  const totalMonths = 24;
  const windowMonths = [6, 9, 12, 15, 18, 21, 24];

  const tradingWindows = windowMonths.map((m) => ({
    month: m,
    date: addMonths(sign, m),
    passed: addMonths(sign, m) <= now,
  }));

  const monthsElapsed = differenceInMonths(now, sign);
  const isLocked = monthsElapsed < 6;

  let isTradingWindow = false;
  let nextTradingMonth = -1;
  let nextTradingDate: Date | null = null;

  for (let i = 0; i < windowMonths.length; i++) {
    const m = windowMonths[i];
    const windowDate = addMonths(sign, m);
    if (windowDate > now) {
      nextTradingMonth = m;
      nextTradingDate = windowDate;
      break;
    }
  }

  if (!isLocked && nextTradingDate) {
    const daysToWindow = Math.abs(differenceInDays(nextTradingDate, now));
    isTradingWindow = daysToWindow <= 14;
  }

  let countdownText = "";
  if (isLocked) {
    const unlockDate = addMonths(sign, 6);
    const days = differenceInDays(unlockDate, now);
    const hours = differenceInHours(unlockDate, now) % 24;
    countdownText = `距离解锁还有 ${days}天 ${hours}小时`;
  } else if (nextTradingDate) {
    const days = differenceInDays(nextTradingDate, now);
    const hours = differenceInHours(nextTradingDate, now) % 24;
    const minutes = differenceInMinutes(nextTradingDate, now) % 60;
    countdownText =
      days > 0
        ? `下次交易窗口：${days}天 ${hours}小时后`
        : hours > 0
        ? `下次交易窗口：${hours}小时 ${minutes}分钟后`
        : `交易窗口已开放`;
  } else {
    countdownText = "产品已到期";
  }

  return {
    monthsElapsed: Math.max(0, monthsElapsed),
    isLocked,
    isTradingWindow,
    nextTradingDate,
    nextTradingMonth,
    countdownText,
    tradingWindows,
  };
}

export function formatSplitRatio(client: number, institution: number): string {
  return `客户${client}% / 机构${institution}%`;
}
