export interface ProfitSettings {
  vipThreshold: number;
  vipClient: number;
  normalClient: number;
}

export const DEFAULT_PROFIT_SETTINGS: ProfitSettings = {
  vipThreshold: 100000,
  vipClient: 40,
  normalClient: 30,
};

export function validProfitSettings(value: ProfitSettings): boolean {
  return Number.isFinite(value.vipThreshold) && value.vipThreshold > 0 &&
    [value.vipClient, value.normalClient].every((v) => Number.isFinite(v) && v >= 0 && v <= 100);
}

export function getProfitSettings(): ProfitSettings {
  if (typeof window === "undefined") return DEFAULT_PROFIT_SETTINGS;
  try {
    const stored = JSON.parse(window.localStorage.getItem("risk_control_settings") || "{}");
    const value = {
      vipThreshold: stored.vipThreshold ?? DEFAULT_PROFIT_SETTINGS.vipThreshold,
      vipClient: stored.vipClient ?? DEFAULT_PROFIT_SETTINGS.vipClient,
      normalClient: stored.normalClient ?? DEFAULT_PROFIT_SETTINGS.normalClient,
    };
    return validProfitSettings(value) ? value : DEFAULT_PROFIT_SETTINGS;
  } catch {
    return DEFAULT_PROFIT_SETTINGS;
  }
}
