const { spawn } = require('node:child_process');

function hydrateRuntimeEnv() {
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

  if (!databaseUrl && vercelPooled) process.env.DATABASE_URL = vercelPooled;
  if (!directDatabaseUrl && vercelDirect) process.env.DIRECT_DATABASE_URL = vercelDirect;
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

  if ((process.env.RC_ALLOW_SEED ?? '').trim() === '1') {
    await runNodeScript(prismaCli, ['db', 'seed']);
  } else {
    console.log('[seed] skipped (RC_ALLOW_SEED != 1)');
  }

  await runNodeScript(nextCli, ['build']);
}

main().catch((error) => {
  console.error('[build-production] failed:', error);
  process.exit(1);
});
