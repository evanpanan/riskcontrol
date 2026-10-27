/**
 * 共享配置存储：机构级设置（风控阈值、预警收件人、风控档位、闪跌阈值、行情源、品牌 Logo）
 * 统一落到服务端工作区 `config` 类别，多端共享同一套配置。
 *
 * 设计要点：
 * - 服务端为唯一事实来源，读取走 workspace 内存缓存（同步），写入「本地镜像 + 异步落库」；
 * - 未同步环境（登录前 / 本地校验脚本）回退浏览器 localStorage，保持既有行为与既有测试语义；
 * - 服务端尚无该键时以本地镜像兜底，登录后由 bootstrapSharedSettings 把本地配置带上服务端，
 *   实现「老配置无缝迁移」。
 */
import {
  bootstrapWorkspace,
  isWorkspaceHydrated,
  readWorkspaceRecord,
  upsertWorkspaceRecord,
} from './workspaceStore';

/** 需要在多端共享的配置键，取值均为 JSON 字符串（与旧 localStorage 中保存的格式一致）。 */
export const SHARED_SETTING_KEYS = [
  'risk_control_settings',
  'risk_control_recipients',
  'risk_control_risk_tiers',
  'risk_control_flash_crash_thresholds',
  'risk_control_live_quote_v2',
  'risk_control_logo_v1',
] as const;

export type SharedSettingKey = (typeof SHARED_SETTING_KEYS)[number];

interface ConfigRecord {
  value: string | null;
}

const isBrowser = () => typeof window !== 'undefined';

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / SSR */
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 读取共享配置项（服务端为准；未同步或服务端尚无该键时回退本地镜像）。 */
export function readSharedSetting(key: SharedSettingKey): string | null {
  if (!isBrowser()) return null;
  if (isWorkspaceHydrated()) {
    const rec = readWorkspaceRecord<ConfigRecord>('config', key);
    if (rec) return typeof rec.payload?.value === 'string' ? rec.payload.value : null;
    return safeGet(key);
  }
  return safeGet(key);
}

/** 写入共享配置项：本地镜像 + 服务端异步落库；value 为 null 表示清除该配置。 */
export function writeSharedSetting(key: SharedSettingKey, value: string | null): void {
  if (!isBrowser()) return;
  if (value === null) safeRemove(key);
  else safeSet(key, value);
  if (isWorkspaceHydrated()) upsertWorkspaceRecord('config', key, { value });
}

/**
 * 首次上云：把浏览器中已成型的本地配置带到服务端，实现老配置无缝迁移。
 * 服务端已存在该键时不覆盖（多端同时首启以「先落库者」为准）。
 */
export async function bootstrapSharedSettings(): Promise<void> {
  if (!isBrowser() || !isWorkspaceHydrated()) return;
  const missing: Array<{ kind: 'config'; key: string; payload: ConfigRecord }> = [];
  for (const key of SHARED_SETTING_KEYS) {
    if (readWorkspaceRecord('config', key)) continue;
    const local = safeGet(key);
    if (local == null) continue;
    missing.push({ kind: 'config', key, payload: { value: local } });
  }
  if (missing.length > 0) await bootstrapWorkspace(missing);
}
