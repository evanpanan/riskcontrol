import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveSessionUser, unauthorized, forbidden, jsonNoStore } from '@/lib/server/apiAuth';
import { APP_ROLES, type AppRole } from '@/types/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 允许落库的工作区数据类别。 */
const ALLOWED_KINDS = new Set(['ledger', 'patches', 'client_status', 'config', 'meta']);

/** 机构级配置与全局标记（空账本标记）仅限机构管理层改写。 */
const CONFIG_WRITE_ROLES: readonly AppRole[] = [APP_ROLES.ADMIN, APP_ROLES.RISK_MANAGER];
const MAX_KEY_LENGTH = 200;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024; // 单条记录上限 4MB，防止异常数据拖垮库

/** 工作区版本号：记录条数 + 最近更新时间，用于「无变化则跳过」的轻量轮询。 */
async function computeVersion(): Promise<string> {
  const agg = await prisma.workspaceRecord.aggregate({
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  const count = agg._count._all ?? 0;
  const maxTs = agg._max.updatedAt ? agg._max.updatedAt.getTime() : 0;
  return `${count}:${maxTs}`;
}

/**
 * 读取工作区数据。
 * - 带 ?version= 时先比对版本，未变化直接返回 unchanged，避免多端轮询时反复传输整包数据。
 * - 默认返回全部记录（含乐观锁 revision）。
 */
export async function GET(req: Request) {
  const session = await resolveSessionUser();
  if (!session) return unauthorized();

  const url = new URL(req.url);
  const knownVersion = url.searchParams.get('version');
  try {
    const version = await computeVersion();
    if (knownVersion && knownVersion === version) {
      return jsonNoStore({ ok: true, unchanged: true, version });
    }
    const kindFilter = url.searchParams.get('kind');
    const where = kindFilter && ALLOWED_KINDS.has(kindFilter) ? { kind: kindFilter } : {};
    const rows = await prisma.workspaceRecord.findMany({
      where,
      select: { kind: true, key: true, payload: true, revision: true, updatedAt: true },
    });
    return jsonNoStore({
      ok: true,
      version,
      records: rows.map((r) => ({
        kind: r.kind,
        key: r.key,
        payload: r.payload,
        revision: r.revision,
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[data:store] GET failed:', err instanceof Error ? err.message : String(err));
    return jsonNoStore({ ok: false, error: '工作区数据读取失败' }, 500);
  }
}

interface PutBody {
  kind?: unknown;
  key?: unknown;
  payload?: unknown;
  baseRevision?: unknown;
}

/**
 * 写入单条工作区记录（乐观锁）。
 * - 记录不存在：直接创建，revision = 1。
 * - 记录存在且 baseRevision 与服务端一致：更新并 revision + 1。
 * - 否则返回 409 并回带服务端当前记录，由客户端回滚并以服务端为准。
 */
export async function PUT(req: Request) {
  const session = await resolveSessionUser();
  if (!session) return unauthorized();

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return jsonNoStore({ ok: false, error: '请求格式错误' }, 400);
  }

  const kind = typeof body.kind === 'string' ? body.kind : '';
  const key = typeof body.key === 'string' ? body.key : '';
  if (!ALLOWED_KINDS.has(kind)) return jsonNoStore({ ok: false, error: '未知的数据类别' }, 400);
  // 机构级配置与全局标记不得由商务经理改写（防止绕过界面直接篡改风控阈值 / 预警收件人）。
  if ((kind === 'config' || kind === 'meta') && !CONFIG_WRITE_ROLES.includes(session.role)) {
    return forbidden('仅管理员或风控总监可修改机构级配置');
  }
  if (!key || key.length > MAX_KEY_LENGTH) return jsonNoStore({ ok: false, error: '数据键无效' }, 400);
  if (body.payload === undefined || body.payload === null) {
    return jsonNoStore({ ok: false, error: '缺少数据内容' }, 400);
  }
  const baseRevision =
    typeof body.baseRevision === 'number' && Number.isFinite(body.baseRevision)
      ? Math.trunc(body.baseRevision)
      : null;

  let payload: Prisma.InputJsonValue;
  try {
    const serialized = JSON.stringify(body.payload);
    if (serialized.length > MAX_PAYLOAD_BYTES) {
      return jsonNoStore({ ok: false, error: '单条数据超出大小上限' }, 413);
    }
    payload = JSON.parse(serialized) as Prisma.InputJsonValue;
  } catch {
    return jsonNoStore({ ok: false, error: '数据内容无法序列化' }, 400);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.workspaceRecord.findUnique({
        where: { kind_key: { kind, key } },
        select: { revision: true, payload: true },
      });
      if (!existing) {
        try {
          const created = await tx.workspaceRecord.create({
            data: { kind, key, payload, revision: 1, updatedBy: session.id },
            select: { revision: true },
          });
          return { ok: true as const, revision: created.revision };
        } catch (createErr) {
          // 并发首建：另一请求已抢先创建，改为冲突回带，由客户端以服务端为准重试。
          if (createErr instanceof Prisma.PrismaClientKnownRequestError && createErr.code === 'P2002') {
            const current = await tx.workspaceRecord.findUnique({
              where: { kind_key: { kind, key } },
              select: { payload: true, revision: true },
            });
            return {
              ok: false as const,
              conflict: { payload: current?.payload ?? null, revision: current?.revision ?? 0 },
            };
          }
          throw createErr;
        }
      }
      if (baseRevision === null || baseRevision !== existing.revision) {
        return {
          ok: false as const,
          conflict: { payload: existing.payload, revision: existing.revision },
        };
      }
      // 版本比较必须落在 UPDATE 的 WHERE 条件里，仅靠事务内「先读后比」在并发下会丢失更新：
      // 两个事务读到同一 revision 时都能通过 check，最终只有一份 payload 生效。
      const updated = await tx.workspaceRecord.updateMany({
        where: { kind, key, revision: existing.revision },
        data: { payload, revision: existing.revision + 1, updatedBy: session.id },
      });
      if (updated.count !== 1) {
        const current = await tx.workspaceRecord.findUnique({
          where: { kind_key: { kind, key } },
          select: { payload: true, revision: true },
        });
        return {
          ok: false as const,
          conflict: { payload: current?.payload ?? null, revision: current?.revision ?? 0 },
        };
      }
      return { ok: true as const, revision: existing.revision + 1 };
    });

    if (!result.ok) {
      return jsonNoStore(
        {
          ok: false,
          error: 'revision_conflict',
          current: { payload: result.conflict.payload, revision: result.conflict.revision },
        },
        409
      );
    }
    return jsonNoStore({ ok: true, revision: result.revision, version: await computeVersion() });
  } catch (err) {
    console.error('[data:store] PUT failed:', err instanceof Error ? err.message : String(err));
    return jsonNoStore({ ok: false, error: '工作区数据写入失败' }, 500);
  }
}
