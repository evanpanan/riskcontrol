import { spawn } from 'node:child_process';
import { hydrateRuntimeEnv } from '../src/lib/server/runtimeEnv';

hydrateRuntimeEnv();

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function main(): Promise<void> {
  await run('npx', ['prisma', 'generate']);
  await run('npx', ['prisma', 'migrate', 'deploy']);

  if ((process.env.RC_ALLOW_SEED ?? '').trim() === '1') {
    await run('npx', ['prisma', 'db', 'seed']);
  } else {
    console.log('[seed] skipped (RC_ALLOW_SEED != 1)');
  }

  await run('npx', ['next', 'build']);
}

main().catch((error) => {
  console.error('[build-production] failed:', error);
  process.exit(1);
});
