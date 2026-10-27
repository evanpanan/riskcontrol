import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveSessionUser, unauthorized, forbidden, jsonNoStore } from '@/lib/server/apiAuth';
import { APP_ROLES, type AppRole } from '@/types/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_KINDS = new Set(['ledger', 'patches', 'client_status', 'config', 'meta']);
/** 初始化落库会写入机构级配置与全部账本，仅限机构管理层。 */
const BOOTSTRAP_ROLES: readonly AppRole[] = [APP_ROLES.ADMIN, APP_ROLES.RISK_MANAGER];
const MAX_KEY_LENGTH = 200;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 2000;

interface BootstrapBody {
  records?: Array<{ kind?: unknown; key?: unknown; payload?: unknown }>;
}

/**
 * 首次初始化：把客户端生成的演示夹具批量落库。
 * 已存在的 (kind, key) 一律跳过，保证多端同时首启时以「先落库者」为准，不产生冲突。
 */
export async function POST(req: Request) {
  const session = await resolveSessionUser();
  if (!session) return unauthorized();
  if (!BOOTSTRAP_ROLES.includes(session.role)) {
    return forbidden('仅管理员或风控总监可执行工作区初始化');
  }

  let body: BootstrapBody;
  try {
    body = (await req.json()) as BootstrapBody;
  } catch {
    return jsonNoStore({ ok: false, error: '请求格式错误' }, 400);
  }
  const incoming = Array.isArray(body.records) ? body.records : [];
  if (incoming.length === 0) return jsonNoStore({ ok: true, inserted: 0 });
  if (incoming.length > MAX_RECORDS) {
    return jsonNoStore({ ok: false, error: '单次初始化数据量过大' }, 413);
  }

  const rows: Prisma.WorkspaceRecordCreateManyInput[] = [];
  for (const item of incoming) {
    const kind = typeof item?.kind === 'string' ? item.kind : '';
    const key = typeof item?.key === 'string' ? item.key : '';
    if (!ALLOWED_KINDS.has(kind) || !key || key.length > MAX_KEY_LENGTH) continue;
    if (item.payload === undefined || item.payload === null) continue;
    let payload: Prisma.InputJsonValue;
    try {
      const serialized = JSON.stringify(item.payload);
      if (serialized.length > MAX_PAYLOAD_BYTES) continue;
      payload = JSON.parse(serialized) as Prisma.InputJsonValue;
    } catch {
      continue;
    }
    rows.push({ kind, key, payload, revision: 1, updatedBy: session.id });
  }
  if (rows.length === 0) return jsonNoStore({ ok: true, inserted: 0 });

  try {
    const result = await prisma.workspaceRecord.createMany({ data: rows, skipDuplicates: true });
    return jsonNoStore({ ok: true, inserted: result.count });
  } catch (err) {
    console.error('[data:store] bootstrap failed:', err instanceof Error ? err.message : String(err));
    return jsonNoStore({ ok: false, error: '工作区初始化失败' }, 500);
  }
}
