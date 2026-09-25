export interface WebAlertSettings {
  webAlertEnabled: boolean;
  webAlertSound: boolean;
  webAlertCriticalOnly: boolean;
  realtimeTickEnabled: boolean;
  realtimeTickIntervalSec: number;
}

const LS_KEY = "risk_control_settings";

const DEFAULT: WebAlertSettings = {
  webAlertEnabled: true,
  webAlertSound: true,
  webAlertCriticalOnly: false,
  realtimeTickEnabled: true,
  realtimeTickIntervalSec: 8,
};

export function getWebAlertSettings(): WebAlertSettings {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw);
    return {
      webAlertEnabled:
        typeof parsed.webAlertEnabled === "boolean" ? parsed.webAlertEnabled : DEFAULT.webAlertEnabled,
      webAlertSound:
        typeof parsed.webAlertSound === "boolean" ? parsed.webAlertSound : DEFAULT.webAlertSound,
      webAlertCriticalOnly:
        typeof parsed.webAlertCriticalOnly === "boolean"
          ? parsed.webAlertCriticalOnly
          : DEFAULT.webAlertCriticalOnly,
      realtimeTickEnabled:
        typeof parsed.realtimeTickEnabled === "boolean"
          ? parsed.realtimeTickEnabled
          : DEFAULT.realtimeTickEnabled,
      realtimeTickIntervalSec:
        typeof parsed.realtimeTickIntervalSec === "number"
          ? Math.max(2, Math.min(120, parsed.realtimeTickIntervalSec))
          : DEFAULT.realtimeTickIntervalSec,
    };
  } catch {
    return DEFAULT;
  }
}

const ACK_KEY_LEGACY = "risk_control_xmax_alert_ack_v1";
const ACK_KEY = "risk_control_alert_ack_v1";

export type AckShape = Record<string, number>;

function migrateAlertAcks(): void {
  if (typeof window === "undefined") return;
  try {
    const legacy = window.localStorage.getItem(ACK_KEY_LEGACY);
    if (!legacy) return;
    if (!window.localStorage.getItem(ACK_KEY)) {
      window.localStorage.setItem(ACK_KEY, legacy);
    }
    window.localStorage.removeItem(ACK_KEY_LEGACY);
  } catch {}
}

export function getAlertAcks(): AckShape {
  if (typeof window === "undefined") return {};
  migrateAlertAcks();
  try {
    const raw = window.localStorage.getItem(ACK_KEY);
    return raw ? (JSON.parse(raw) as AckShape) : {};
  } catch {
    return {};
  }
}

export function setAlertAcks(acks: AckShape) {
  if (typeof window === "undefined") return;
  migrateAlertAcks();
  try {
    window.localStorage.setItem(ACK_KEY, JSON.stringify(acks));
  } catch {}
}

export function acknowledgeAlert(batchId: string) {
  const acks = getAlertAcks();
  acks[batchId] = Date.now();
  setAlertAcks(acks);
}

export function clearAllAlerts() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACK_KEY);
    window.localStorage.removeItem(ACK_KEY_LEGACY);
  } catch {}
}
