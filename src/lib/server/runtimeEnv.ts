/**
 * 统一兼容本项目显式变量与 Vercel Postgres 集成自动注入变量。
 *
 * 目标：
 * - 本地 / Docker 继续优先使用 DATABASE_URL / DIRECT_DATABASE_URL
 * - Vercel 上若用户只连接了 Postgres Integration，不再要求手工二次映射
 */
export function hydrateRuntimeEnv(): void {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const directDatabaseUrl = process.env.DIRECT_DATABASE_URL?.trim();

  const vercelPooled =
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim();
  const vercelDirect =
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.POSTGRES_PRISMA_URL?.trim();

  if (!databaseUrl && vercelPooled) {
    process.env.DATABASE_URL = vercelPooled;
  }
  if (!directDatabaseUrl && vercelDirect) {
    process.env.DIRECT_DATABASE_URL = vercelDirect;
  }
}
