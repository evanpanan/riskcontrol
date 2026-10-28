/**
 * 跨实例登录限流：以数据库为共享计数窗口。
 *
 * 进程内 Map 在多副本部署时各算各的，攻击者分散打不同实例即可绕过。
 * 这里用一条原子 UPSERT 同时完成「窗口过期重置」与「计数自增」，
 * 避免读改写竞态导致计数偏小。
 */
import { prisma } from '@/lib/prisma';

export interface ThrottleRule {
  /** 计数维度标识，例如 `ip:1.2.3.4`、`acct:<userId>`、`ipacct:<ip>::<key>`。 */
  key: string;
  /** 窗口内允许的最大尝试次数（超过即拒绝）。 */
  max: number;
  /** 窗口长度（毫秒）。 */
  windowMs: number;
}

/**
 * 依次命中多项限流规则：任一项超限即返回 true。
 * 全部规则都会计数（即使前面已超限），避免只打一个维度就绕过其他维度。
 */
export async function hitLoginThrottle(rules: ThrottleRule[]): Promise<boolean> {
  let blocked = false;
  for (const rule of rules) {
    const exceeded = await bumpThrottle(rule);
    if (exceeded) blocked = true;
  }
  return blocked;
}

async function bumpThrottle(rule: ThrottleRule): Promise<boolean> {
  const now = new Date();
  const windowFloor = new Date(now.getTime() - rule.windowMs);
  try {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "AuthThrottle" ("key", "count", "windowStart", "updatedAt")
      VALUES (${rule.key}, 1, ${now}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "AuthThrottle"."windowStart" < ${windowFloor}
                       THEN 1 ELSE "AuthThrottle"."count" + 1 END,
        "windowStart" = CASE WHEN "AuthThrottle"."windowStart" < ${windowFloor}
                             THEN ${now} ELSE "AuthThrottle"."windowStart" END,
        "updatedAt" = ${now}
      RETURNING "count"
    `;
    const count = rows[0]?.count ?? 1;
    return count > rule.max;
  } catch (err) {
    // 限流存储不可用时放行请求，但仍记录日志：宁可短暂失去限流，也不要让登录整体不可用。
    console.error('[loginThrottle] 限流计数失败：', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** 登录成功后清理该账户维度的计数，避免正常用户被自己的历史失败拖累。 */
export async function clearLoginThrottle(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await prisma.authThrottle.deleteMany({ where: { key: { in: keys } } });
  } catch {
    /* 清理失败不影响登录 */
  }
}
