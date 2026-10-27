import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveSessionUser, unauthorized, forbidden, jsonNoStore } from '@/lib/server/apiAuth';
import { APP_ROLES, type AppRole } from '@/types/auth';
import {
  collectOwnedScope,
  isBdManager,
  ledgersContainOwnedClient,
  mergeLedgerWriteForBd,
  redactLedgerForBd,
} from '@/lib/server/workspaceScope';

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
 * - 商务经理仅返回本人名下客户所属的批次账本与补丁，他人客户行脱敏。
 */

interface StoreRow {
  kind: string;
  key: string;
  payload: unknown;
  revision: number;
  updatedAt: Date;
}

/** 商务经理视角的数据范围收敛：他人批次/客户状态/补丁不下发，批次内他人客户行脱敏。 */
async function scopeRowsForBd(rows: StoreRow[], bdName: string | null): Promise<StoreRow[]> {
  const ledgers = await prisma.workspaceRecord.findMany({
    where: { kind: 'ledger' },
    select: { key: true, payload: true },
  });
  const scope = collectOwnedScope(ledgers, bdName);
  const out: StoreRow[] = [];
  for (const row of rows) {
    if (row.kind === 'ledger') {
      if (!scope.batchIds.has(row.key)) continue;
      out.push({ ...row, payload: bdName ? redactLedgerForBd(row.payload, bdName) : row.payload });
      continue;
    }
    if (row.kind === 'patches') {
      if (!scope.batchIds.has(row.key)) continue;
      out.push(row);
      continue;
    }
    if (row.kind === 'client_status') {
      if (!scope.clientIds.has(row.key)) continue;
      out.push(row);
      continue;
    }
    out.push(row); // config / meta：读取保留，写入另行按角色收敛
  }
  return out;
}

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
    const scopedRows = isBdManager(session)
      ? await scopeRowsForBd(rows, session.bdManagerFullName ?? null)
      : rows;
    return jsonNoStore({
      ok: true,
      version,
      records: scopedRows.map((r) => ({
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
  /** 资金操作幂等键：同一次资金操作的网络重试携带同一 opId，服务端不重复记账。 */
  opId?: unknown;
  /** 与本次写入同一事务提交的审计记录（由服务端注入权威操作人身份）。 */
  audit?: unknown;
}

interface AuditIntent {
  action: string;
  resource: string;
  detail: Record<string, unknown> | null;
}

const MAX_OP_ID_LENGTH = 128;
const MAX_AUDIT_ENTRIES = 20;

/** 读取账本中的资金版本号；用于判定本次写入是否属于「资金写入」。 */
function financeRevisionOf(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const fin = (payload as { batch?: { finance?: { revision?: unknown } } }).batch?.finance;
  return typeof fin?.revision === 'number' && Number.isFinite(fin.revision) ? fin.revision : null;
}

/** 规范化 JSON：对象键排序，保证同一请求内容的摘要稳定（不受键序影响）。 */
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

/**
 * 幂等键摘要：绑定「操作人 + 业务对象 + 操作类型 + 规范化请求内容」。
 * 只有完全相同的请求才可重放成功；同一 opId 携带不同内容一律拒绝。
 */
function requestDigest(actorId: string, kind: string, key: string, payload: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([actorId, kind, key, canonicalize(payload)]))
    .digest('hex');
}

/** 审计意图归一化：仅接受业务动作名，操作人身份一律由服务端会话决定。 */
function normalizeAuditIntents(raw: unknown): AuditIntent[] {
  if (!Array.isArray(raw)) return [];
  const out: AuditIntent[] = [];
  for (const item of raw.slice(0, MAX_AUDIT_ENTRIES)) {
    if (item === null || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.action !== 'string') continue;
    const action = rec.action.slice(0, 64);
    if (!action) continue;
    const resource = typeof rec.resource === 'string' ? rec.resource.slice(0, 200) : '';
    const detail =
      rec.detail !== null && typeof rec.detail === 'object' && !Array.isArray(rec.detail)
        ? (rec.detail as Record<string, unknown>)
        : null;
    out.push({ action, resource, detail });
  }
  return out;
}

/**
 * 写入单条工作区记录（乐观锁）。
 * - 记录不存在：直接创建，revision = 1。
 * - 记录存在且 baseRevision 与服务端一致：更新并 revision + 1。
 * - 否则返回 409 并回带服务端当前记录，由客户端回滚并以服务端为准。
 * - 携带 opId 时：幂等登记、账本写入与审计记录在同一事务内提交；重放同一 opId 不再重复记账。
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
  // 商务经理：补仓补丁与结算/补仓相关的批次级写入一律拒绝；客户状态仅限本人名下客户。
  const bdWrite = isBdManager(session);
  if (bdWrite && kind === 'patches') {
    return forbidden('商务经理不可修改补仓记录');
  }
  if (bdWrite && kind === 'client_status') {
    const ledgers = await prisma.workspaceRecord.findMany({
      where: { kind: 'ledger' },
      select: { payload: true },
    });
    if (!ledgersContainOwnedClient(ledgers, key, session.bdManagerFullName)) {
      return forbidden('仅可修改本人名下客户的状态');
    }
  }
  if (body.payload === undefined || body.payload === null) {
    return jsonNoStore({ ok: false, error: '缺少数据内容' }, 400);
  }
  const baseRevision =
    typeof body.baseRevision === 'number' && Number.isFinite(body.baseRevision)
      ? Math.trunc(body.baseRevision)
      : null;
  const opId =
    typeof body.opId === 'string' && body.opId.length > 0 && body.opId.length <= MAX_OP_ID_LENGTH
      ? body.opId
      : null;
  const auditIntents = normalizeAuditIntents(body.audit);

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
      // 商务经理无建批次权限：不得创建账本记录（杜绝注入他人批次账本）。
      if (!existing && bdWrite && kind === 'ledger') {
        return { ok: false as const, forbidden: '仅可修改已存在的本人名下批次账本' };
      }

      // 资金写入必须携带幂等标识。是否属于资金写入由服务端依据 finance.revision 是否推进判定，
      // 不依赖客户端声明，杜绝「账本被改但无幂等登记、无审计」的写入。
      const financialWrite =
        kind === 'ledger' &&
        (existing === null || financeRevisionOf(payload) !== financeRevisionOf(existing.payload));
      if (financialWrite && !opId) {
        return { ok: false as const, missingOpId: true as const };
      }

      // 幂等：以「操作人 + 业务对象 + 操作类型 + 请求内容摘要」绑定 opId。
      // 仅完全相同的请求可重放成功；同键不同内容视为冲突，避免把未执行的新金额当成已完成。
      const digest = opId ? requestDigest(session.id, kind, key, payload) : null;
      if (opId) {
        const done = await tx.financeCommit.findUnique({
          where: { opId },
          select: { actorId: true, kind: true, key: true, revision: true, digest: true },
        });
        if (done) {
          const sameRequest =
            done.actorId === session.id && done.kind === kind && done.key === key && done.digest === digest;
          if (sameRequest) return { ok: true as const, revision: done.revision, deduped: true };
          return { ok: false as const, idempotencyConflict: true as const };
        }
      }

      // 被白名单拦截的受保护字段（商务经理试图改动资金 / 结算 / 归属字段）。
      let blockedFields: Array<{ clientId: string; field: string }> = [];

      // 记账、审计与幂等登记必须在同一事务内提交：任一步失败则整体回滚。
      const commitAuditAndIdempotency = async (finalRevision: number) => {
        if (auditIntents.length > 0) {
          await tx.auditLog.createMany({
            data: auditIntents.map<Prisma.AuditLogCreateManyInput>((a) => ({
              actorId: session.id,
              actorEmail: session.email,
              role: session.role,
              action: a.action,
              resource: a.resource || `${kind}:${key}`,
              detail: a.detail === null ? undefined : (a.detail as Prisma.InputJsonValue),
            })),
          });
        }
        if (opId) {
          // 服务端自行生成资金写入审计：不依赖客户端上送，每次账本变更都有一条权威记录。
          await tx.auditLog.create({
            data: {
              actorId: session.id,
              actorEmail: session.email,
              role: session.role,
              action: 'finance_commit',
              resource: `${kind}:${key}`,
              detail: {
                opId,
                revision: finalRevision,
                record: `${kind}:${key}`,
              } as Prisma.InputJsonValue,
            },
          });
          await tx.financeCommit.create({
            data: { opId, actorId: session.id, kind, key, revision: finalRevision, digest: digest ?? undefined },
          });
        }
        if (blockedFields.length > 0) {
          // 受保护字段已被服务端按白名单拦截：逐客户留痕，供审计追溯。
          const byClient = new Map<string, string[]>();
          for (const item of blockedFields) {
            const list = byClient.get(item.clientId) ?? [];
            list.push(item.field);
            byClient.set(item.clientId, list);
          }
          await tx.auditLog.createMany({
            data: [...byClient.entries()].map<Prisma.AuditLogCreateManyInput>(([clientId, fields]) => ({
              actorId: session.id,
              actorEmail: session.email,
              role: session.role,
              action: 'client_edit',
              resource: `client:${clientId}:blocked`,
              detail: {
                clientId,
                batchId: key,
                blockedFields: fields,
                result: '受保护字段由服务端拦截，未生效',
              } as Prisma.InputJsonValue,
            })),
          });
        }
      };

      if (!existing) {
        try {
          const created = await tx.workspaceRecord.create({
            data: { kind, key, payload, revision: 1, updatedBy: session.id },
            select: { revision: true },
          });
          await commitAuditAndIdempotency(created.revision);
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
      // 商务经理写账本：只接受自有客户条目的变更，批次级字段与他人客户行以服务端为准。
      let nextPayload: Prisma.InputJsonValue = payload;
      if (bdWrite && kind === 'ledger') {
        const merged = mergeLedgerWriteForBd(existing.payload, payload, session.bdManagerFullName);
        if (!merged.ok) {
          return { ok: false as const, forbidden: merged.error ?? '当前角色不可修改该账本' };
        }
        nextPayload = JSON.parse(JSON.stringify(merged.payload)) as Prisma.InputJsonValue;
        blockedFields = merged.blocked ?? [];
      }
      // 版本比较必须落在 UPDATE 的 WHERE 条件里，仅靠事务内「先读后比」在并发下会丢失更新：
      // 两个事务读到同一 revision 时都能通过 check，最终只有一份 payload 生效。
      const updated = await tx.workspaceRecord.updateMany({
        where: { kind, key, revision: existing.revision },
        data: { payload: nextPayload, revision: existing.revision + 1, updatedBy: session.id },
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
      await commitAuditAndIdempotency(existing.revision + 1);
      return { ok: true as const, revision: existing.revision + 1 };
    });

    if (!result.ok) {
      if ('forbidden' in result) return forbidden(result.forbidden);
      if ('missingOpId' in result) {
        return jsonNoStore(
          { ok: false, error: 'financial_write_requires_op_id', message: '资金写入缺少幂等标识，已拒绝' },
          400
        );
      }
      if ('idempotencyConflict' in result) {
        return jsonNoStore(
          { ok: false, error: 'idempotency_key_conflict', message: '同一幂等标识携带了不同内容，已拒绝' },
          409
        );
      }
      return jsonNoStore(
        {
          ok: false,
          error: 'revision_conflict',
          current: { payload: result.conflict.payload, revision: result.conflict.revision },
        },
        409
      );
    }
    return jsonNoStore({
      ok: true,
      revision: result.revision,
      deduped: 'deduped' in result ? result.deduped === true : false,
      version: result.deduped === true ? undefined : await computeVersion(),
    });
  } catch (err) {
    console.error('[data:store] PUT failed:', err instanceof Error ? err.message : String(err));
    return jsonNoStore({ ok: false, error: '工作区数据写入失败' }, 500);
  }
}
