import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveSessionUser, unauthorized, forbidden, jsonNoStore } from '@/lib/server/apiAuth';
import { APP_ROLES } from '@/types/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 默认清空的业务数据类别（meta 不参与清除，用于承载「空账本」标记）。 */
const DEFAULT_CLEAR_KINDS = ['ledger', 'patches', 'client_status'];
const ALLOWED_KINDS = new Set(['ledger', 'patches', 'client_status']);

interface ClearBody {
  kinds?: unknown;
  /** 是否为「清空业务数据」操作：true 写入空账本标记，false（开发重置）清除该标记。 */
  markEmpty?: unknown;
}

/**
 * 清空业务数据：删除指定类别下的全部记录，并写入 meta.empty 标记，
 * 使后续加载以空账本启动（不再重新载入演示批次）。仅管理员/风控总监可执行。
 */
export async function POST(req: Request) {
  const session = await resolveSessionUser();
  if (!session) return unauthorized();
  if (session.role !== APP_ROLES.ADMIN && session.role !== APP_ROLES.RISK_MANAGER) {
    return forbidden('仅管理员可清空业务数据');
  }

  let body: ClearBody = {};
  try {
    body = (await req.json()) as ClearBody;
  } catch {
    body = {};
  }
  const requested = Array.isArray(body.kinds)
    ? body.kinds.filter((k): k is string => typeof k === 'string' && ALLOWED_KINDS.has(k))
    : [];
  const kinds = requested.length > 0 ? requested : DEFAULT_CLEAR_KINDS;
  const markEmpty = body.markEmpty !== false;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const deleted = await tx.workspaceRecord.deleteMany({ where: { kind: { in: kinds } } });
      const existingMeta = await tx.workspaceRecord.findUnique({
        where: { kind_key: { kind: 'meta', key: 'empty' } },
        select: { revision: true },
      });
      const payload = { empty: markEmpty } as Prisma.InputJsonValue;
      if (existingMeta) {
        await tx.workspaceRecord.update({
          where: { kind_key: { kind: 'meta', key: 'empty' } },
          data: { payload, revision: existingMeta.revision + 1, updatedBy: session.id },
        });
      } else {
        await tx.workspaceRecord.create({
          data: { kind: 'meta', key: 'empty', payload, revision: 1, updatedBy: session.id },
        });
      }
      return deleted.count;
    });
    return jsonNoStore({ ok: true, deleted: result });
  } catch (err) {
    console.error('[data:store] clear failed:', err instanceof Error ? err.message : String(err));
    return jsonNoStore({ ok: false, error: '清空业务数据失败' }, 500);
  }
}
