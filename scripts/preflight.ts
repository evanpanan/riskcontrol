/**
 * 生产上线自检（preflight）
 * 在服务启动前运行，校验关键配置是否就绪；生产环境缺失关键项时直接退出（fail-closed）。
 *
 * 运行方式：
 *   npm run preflight
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 若进程环境未提供变量，则回退读取本地 .env（生产由编排系统注入，通常不需要）
function loadDotEnvFallback(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* 没有 .env 时忽略 */
  }
}

interface CheckResult {
  name: string;
  ok: boolean;
  fatal: boolean;
  detail: string;
}

function checkEnv(name: string, ok: boolean, detail: string, fatal: boolean): CheckResult {
  return { name, ok, fatal, detail };
}

/** 模板/占位值不算已配置，避免自检出现「假通过」。 */
function isPlaceholder(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  return /^your-/i.test(v) || /CHANGE_ME/i.test(v) || /example\.com/i.test(v) || /^x+$/i.test(v);
}

async function main(): Promise<void> {
  loadDotEnvFallback();

  const isProd = process.env.NODE_ENV === 'production';
  const results: CheckResult[] = [];

  const secret = process.env.NEXT_RC_AUTH_SECRET ?? '';
  results.push(
    checkEnv(
      'NEXT_RC_AUTH_SECRET',
      secret.trim().length >= 32,
      secret.trim().length === 0
        ? '未设置（生产环境会直接启动失败）'
        : `长度 ${secret.trim().length}，建议 >= 32（openssl rand -hex 32）`,
      true
    )
  );

  const dbUrl = process.env.DATABASE_URL ?? '';
  results.push(
    checkEnv('DATABASE_URL', dbUrl.trim().length > 0, dbUrl.trim() ? '已设置' : '未设置', true)
  );

  const devMock = process.env.RC_ENABLE_DEV_MOCK_ACCOUNTS;
  results.push(
    checkEnv(
      'RC_ENABLE_DEV_MOCK_ACCOUNTS',
      isProd ? devMock !== '1' : true,
      devMock === '1' ? '生产环境禁止开启内建演示账号' : '未开启（正确）',
      true
    )
  );

  // 账号初始化：生产必须一次性授权，且逐账号指定口令（禁止共享口令）。
  const allowSeed = (process.env.RC_ALLOW_SEED ?? '').trim() === '1';
  const perUserPasswords = (process.env.RC_SEED_PASSWORDS ?? '').trim();
  const sharedPassword = (process.env.RC_SEED_DEFAULT_PASSWORD ?? '').trim();
  results.push(
    checkEnv(
      'RC_ALLOW_SEED / RC_SEED_PASSWORDS',
      !allowSeed || Boolean(perUserPasswords),
      !allowSeed
        ? '未开启账号初始化（正确：容器重启不会重放 seed）'
        : perUserPasswords
          ? '已授权一次性初始化，且已逐账号指定口令'
          : '已授权初始化但未提供逐账号口令：生产不会创建任何账号',
      false
    )
  );
  if (isProd && sharedPassword) {
    results.push(
      checkEnv(
        'RC_SEED_DEFAULT_PASSWORD',
        false,
        '生产环境禁止共享口令，请改用逐账号 RC_SEED_PASSWORDS',
        true
      )
    );
  }

  const notifyOk = !isPlaceholder(process.env.EMAIL_WEBHOOK_URL ?? '') || !isPlaceholder(process.env.WHATSAPP_WEBHOOK_URL ?? '');
  results.push(
    checkEnv(
      '通知通道 (EMAIL/WHATSAPP Webhook)',
      notifyOk,
      notifyOk ? '已配置' : '未配置或仍为模板值：击穿/闪跌预警将无法送达',
      false
    )
  );

  // 数据库连通性
  try {
    const { prisma } = await import('../src/lib/prisma');
    await prisma.$queryRaw`SELECT 1`;
    results.push(checkEnv('数据库连通性', true, '连接正常', true));
    await prisma.$disconnect();
  } catch (err) {
    results.push(
      checkEnv('数据库连通性', false, `连接失败：${err instanceof Error ? err.message : String(err)}`, true)
    );
  }

  console.log('\n=== RiskControl 上线自检 ===');
  console.log(`环境：${process.env.NODE_ENV ?? 'unknown'}${isProd ? '' : '（非生产，仅提示）'}\n`);
  for (const r of results) {
    const tag = r.ok ? '通过' : r.fatal ? '失败' : '提醒';
    const mark = r.ok ? '[√]' : r.fatal ? '[×]' : '[!]';
    console.log(`${mark} ${tag}  ${r.name}  —— ${r.detail}`);
  }

  const fatalFailures = results.filter((r) => !r.ok && r.fatal);
  const warnings = results.filter((r) => !r.ok && !r.fatal);

  if (fatalFailures.length > 0 && isProd) {
    console.error(`\n自检未通过：${fatalFailures.length} 项关键配置缺失，已阻止启动。`);
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.warn(`\n注意：${warnings.length} 项建议项未满足，请评估后再上线。`);
  }
  console.log('\n自检完成。\n');
}

main().catch((err) => {
  console.error('[preflight] 执行异常：', err);
  process.exit(1);
});
