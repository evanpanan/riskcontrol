/**
 * 账本写入资金识别：判定两次账本快照之间「资金部分」是否发生实质变化。
 *
 * 服务端据此识别资金写入，并强制幂等标识与服务端权威审计。
 * 仅凭客户端上送的 finance.revision 判定会被绕过（改资金内容但保留原版本号即可躲过校验），
 * 因此以内容差异为准；版本号本身不计入内容比较（其推进不代表资金实质变更）。
 */

/** 规范化 JSON：对象键排序，保证同一内容的比较稳定（不受键序影响）。 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) out[key] = canonicalize(rec[key]);
    return out;
  }
  return value;
}

/** 取出账本的资金部分，并剔除 revision（版本号不计入内容比较）。 */
function financeContentOf(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return null;
  const fin = (payload as { batch?: { finance?: unknown } }).batch?.finance;
  if (!fin || typeof fin !== 'object') return fin ?? null;
  const { revision: _revision, ...rest } = fin as Record<string, unknown>;
  void _revision;
  return rest;
}

/** 两次账本快照的资金内容是否不同（不同即视为资金写入）。 */
export function financeContentChanged(prevPayload: unknown, nextPayload: unknown): boolean {
  return (
    JSON.stringify(canonicalize(financeContentOf(prevPayload))) !==
    JSON.stringify(canonicalize(financeContentOf(nextPayload)))
  );
}
