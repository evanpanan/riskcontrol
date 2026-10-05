import { DEFAULT_THRESHOLD_OPTS, type ThresholdOpts } from "./riskEngine";

const SETTINGS_LS_KEY = "risk_control_settings";

export interface StoredThresholds extends Required<ThresholdOpts> {}

export function getStoredThresholds(): StoredThresholds {
  const fallback: StoredThresholds = { ...DEFAULT_THRESHOLD_OPTS };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(SETTINGS_LS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw || "{}") as any;
    const warnRaw = Number(parsed?.warningThreshold);
    const marginRaw = Number(parsed?.marginThreshold);
    const warningDropPercent = Number.isFinite(warnRaw) && warnRaw > 0 && warnRaw < 100 ? warnRaw : fallback.warningDropPercent;
    let marginDropPercent = Number.isFinite(marginRaw) && marginRaw > 0 && marginRaw <= 100 ? marginRaw : fallback.marginDropPercent;
    if (marginDropPercent <= warningDropPercent) marginDropPercent = Math.min(100, warningDropPercent + 0.01);
    return { warningDropPercent, marginDropPercent };
  } catch {
    return fallback;
  }
}
