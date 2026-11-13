const { spawn } = require('node:child_process');

function hydrateRuntimeEnv() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const directDatabaseUrl = process.env.DIRECT_DATABASE_URL?.trim();

  // 1. 如果没有配置 DATABASE_URL，优先使用 Vercel 的 POSTGRES_PRISMA_URL (带连接池)
  const vercelPooled =
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL?.trim();
    
  // 2. 如果没有配置 DIRECT_DATABASE_URL，优先使用 Vercel 的 POSTGRES_URL_NON_POOLING (直连)
  const vercelDirect =
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    process.env.POSTGRES_URL?.trim();

  if (!databaseUrl && vercelPooled) {
    process.env.DATABASE_URL = vercelPooled;
    console.log('[build] Auto-configured DATABASE_URL from Vercel env');
  }
  
  if (!directDatabaseUrl && vercelDirect) {
    process.env.DIRECT_DATABASE_URL = vercelDirect;
    console.log('[build] Auto-configured DIRECT_DATABASE_URL from Vercel env');
  }
  
  // 3. Prisma 强制要求如果使用了 directUrl 配置项，就必须提供该环境变量，否则抛出 P1012
  if (!process.env.DIRECT_DATABASE_URL?.trim()) {
    process.env.DIRECT_DATABASE_URL = process.env.DATABASE_URL?.trim();
    console.log('[build] Fallback DIRECT_DATABASE_URL to DATABASE_URL to prevent Prisma P1012 error');
  }
}

function resolveCli(modulePath) {
  return require.resolve(modulePath);
}

async function runNodeScript(scriptPath, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptPath} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function main() {
  hydrateRuntimeEnv();

  const prismaCli = resolveCli('prisma/build/index.js');
  const nextCli = resolveCli('next/dist/bin/next');

  await runNodeScript(prismaCli, ['generate']);
  await runNodeScript(prismaCli, ['migrate', 'deploy']);

  await runNodeScript(nextCli, ['build']);
}

main().catch((error) => {
  console.error('[build-production] failed:', error);
  process.exit(1);
});
