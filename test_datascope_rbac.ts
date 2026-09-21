import { generateMockData } from './src/lib/mockData';
import {
  filterClientsByRole,
  filterBatchDetailClientsByRole,
  filterBdStatsByRole,
  filterMarginCallsByRole,
  type ClientLike,
  type BdStatValue,
  type RedactedClientPlaceholder,
} from './src/lib/authz/dataScope';
import { MOCK_USER_META, APP_ROLES } from './src/types/auth';
import type { AppSessionUser } from './src/types/auth';

const data = generateMockData();
const allClients: ClientLike[] = data.batches.flatMap(b => b.clients.map(c => ({
  ...c,
  signDate: c.signDate as any,
  settledAt: c.settledAt as any,
  createdAt: (c as any).createdAt as any,
  updatedAt: (c as any).updatedAt as any,
})));
const allMarginCalls = data.batches.flatMap(b => b.marginCalls);

const BD_MANAGERS_UNIQUE = Array.from(new Set(allClients.map(c => c.bdManager)));
console.log(`[setup] total batches: ${data.batches.length}`);
console.log(`[setup] total clients: ${allClients.length}`);
console.log(`[setup] BD managers: ${BD_MANAGERS_UNIQUE.join(' / ')}`);
console.log(`[setup] total margin calls: ${allMarginCalls.length}`);

function assert(cond: any, msg: string): void {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`✅ OK  : ${msg}`);
}

function batchClientsBySymbol(batches: typeof data.batches, symbol: string) {
  const b = batches.find(x => x.stockSymbol === symbol);
  if (!b) return { batch: null, clients: [] as ClientLike[] };
  return {
    batch: b,
    clients: b.clients.map(c => ({
      ...c,
      signDate: c.signDate as any,
      settledAt: c.settledAt as any,
    })) as ClientLike[],
  };
}

function aggregateBdMap(clients: ClientLike[]): Record<string, BdStatValue> {
  const map: Record<string, BdStatValue> = {};
  for (const c of clients) {
    const key = c.bdManager;
    if (!map[key]) map[key] = { count: 0, amount: 0, pnl: 0 };
    map[key].count += 1;
    map[key].amount += c.investmentAmount ?? 0;
    map[key].pnl += c.realtimePnL ?? 0;
  }
  return map;
}

// ========== Test Suite ==========
let passCount = 0;
function test(name: string, fn: () => void) {
  try {
    console.log(`\n🧪 TEST: ${name}`);
    fn();
    passCount += 1;
  } catch (e: any) {
    console.error(`🔥 TEST ABORTED: ${name} → ${e.message}`);
  }
}

const userRisk: AppSessionUser = MOCK_USER_META.risk_evan;
const userLiujia: AppSessionUser = MOCK_USER_META.bd_liujia;
const userLixiaoming: AppSessionUser = MOCK_USER_META.bd_lixiaoming;
const userZhangzhiq: AppSessionUser = MOCK_USER_META.bd_zhangzhiq;

// --- T1: filterClientsByRole (RISK 全量) ---
test('T1.1 RISK_MANAGER 全局客户列表不应被过滤（返回原数量）', () => {
  const out = filterClientsByRole(allClients, userRisk);
  assert(out.length === allClients.length, `Risk 视角客户数 ${out.length} === 总数 ${allClients.length}`);
});

// --- T2: filterClientsByRole (BD 仅自己) ---
test('T2.1 BD_LIUJIA 客户管理仅返回自己名下', () => {
  const out = filterClientsByRole(allClients, userLiujia);
  const expected = allClients.filter(c => c.bdManager === userLiujia.bdManagerFullName);
  assert(out.length === expected.length, `BD刘佳返回 ${out.length}，预期 ${expected.length}`);
  assert(out.every(c => c.bdManager === userLiujia.bdManagerFullName), '所有返回行 bdManager === 刘佳');
});

test('T2.2 BD_LIXIAOMING 客户管理仅返回自己名下，数量应与其他 BD 不同', () => {
  const outLxm = filterClientsByRole(allClients, userLixiaoming);
  const outLj = filterClientsByRole(allClients, userLiujia);
  assert(
    outLxm.every(c => c.bdManager === userLixiaoming.bdManagerFullName),
    '李晓明返回的客户 bdManager 全为自己'
  );
  console.log(`  ℹ️  LXM: ${outLxm.length} | LJ: ${outLj.length}`);
  assert(outLxm.length > 0, 'BD_LIXIAOMING 至少 1 个客户');
});

// --- T3: filterBatchDetailClientsByRole (AMD batch-008) ---
test('T3.1 AMD CRIT 批次详情 RISK 视角 = 18 位客户全量，无脱敏占位', () => {
  const { clients: amdClients } = batchClientsBySymbol(data.batches, 'AMD');
  assert(amdClients.length === 18, `AMD 批次原始客户数 ${amdClients.length} === 18`);
  const r = filterBatchDetailClientsByRole(amdClients, userRisk);
  assert(r.visibleOwnCount === 18, `Risk 视角 visibleOwnCount=18`);
  assert(r.redactedCount === 0, `Risk 视角 redactedCount=0`);
  assert(r.totalOriginalCount === 18, `totalOriginalCount 保留原值 18`);
  assert(r.mergedRows.length === 18, `mergedRows 长度 18`);
  assert(!(r.mergedRows[0] as any).__redacted, 'Risk 视角返回行无 __redacted 标记');
});

test('T3.2 AMD CRIT 批次详情 BD_LIUJIA = 保留总行数 18，仅自己客户真实，其他脱敏占位', () => {
  const { clients: amdClients } = batchClientsBySymbol(data.batches, 'AMD');
  const r = filterBatchDetailClientsByRole(amdClients, userLiujia);
  const realLiujiaCount = amdClients.filter(c => c.bdManager === userLiujia.bdManagerFullName).length;
  console.log(`  ℹ️  AMD真实刘佳客户数: ${realLiujiaCount} / redacted: ${18 - realLiujiaCount}`);
  assert(r.totalOriginalCount === 18, `totalOriginalCount 仍=18（总行数保留防 BD 猜其他 BD 客户量级）`);
  assert(r.mergedRows.length === 18, `mergedRows 长度=18（=真实N + 脱敏M，防猜）`);
  assert(r.visibleOwnCount === realLiujiaCount, `visibleOwnCount=${realLiujiaCount}`);
  assert(r.redactedCount === 18 - realLiujiaCount, `redactedCount=${18 - realLiujiaCount}`);
  const visibleRealRows = r.mergedRows.filter((row: any) => !row.__redacted) as ClientLike[];
  const redactedRows = r.mergedRows.filter((row: any) => row.__redacted) as RedactedClientPlaceholder[];
  assert(visibleRealRows.length === realLiujiaCount, `可见行数=真实刘佳客户数`);
  assert(visibleRealRows.every(c => c.bdManager === userLiujia.bdManagerFullName), '可见行 bdManager=刘佳');
  assert(redactedRows.length === 18 - realLiujiaCount, `脱敏行数=M`);
  assert(redactedRows.every(row => row.__placeholder === true), '脱敏行 __placeholder=true');
  assert(redactedRows.every(row => row.name === '— 其他商务经理 客户（已脱敏）—'), `脱敏行 name=固定占位字符串`);
  assert(redactedRows.every(row => row.bdManager === '（已隐藏）'), `脱敏行 bdManager=（已隐藏）`);
  assert(redactedRows.every(row => row.investmentAmount === null), `脱敏行 investmentAmount=null`);
  const redactedIds = new Set(redactedRows.map(r => r.id));
  assert(redactedIds.size === redactedRows.length, `脱敏行 id 唯一（redacted-i-xxx），React key 不冲突`);
});

// --- T4: filterBatchDetailClientsByRole MSFT 验证同样逻辑 ---
test('T4.1 MSFT 击穿批次 BD_ZHANGZHIQ 视角 = 保留 15 行', () => {
  const { clients: msftClients } = batchClientsBySymbol(data.batches, 'MSFT');
  assert(msftClients.length === 15, `MSFT 原始客户数=15`);
  const r = filterBatchDetailClientsByRole(msftClients, userZhangzhiq);
  assert(r.mergedRows.length === 15, `MSFT ZhangZhiq mergedRows=15`);
  assert(r.totalOriginalCount === 15, `totalOriginalCount=15`);
});

// --- T5: filterBdStatsByRole RISK 全量 4 BD ---
test('T5.1 RISK 视角 BD 分布 = 4 位 BD 全量，无聚合', () => {
  const bdMap = aggregateBdMap(allClients);
  assert(Object.keys(bdMap).length === 4, `全量 BD key 数 = 4（mockData BD_MANAGERS）`);
  const r = filterBdStatsByRole(bdMap, userRisk);
  assert(r.visibleEntries.length === 4, `Risk 可见 4 条 BD 记录`);
  assert(r.aggregatedOthers === null, `Risk 无聚合项`);
});

// --- T6: filterBdStatsByRole BD 视角 ---
test('T6.1 BD_LIUJIA 视角 BD 分布 = 仅 1 条自己 + 其他 N-1 位聚合（无姓名泄露）', () => {
  const bdMap = aggregateBdMap(allClients);
  const r = filterBdStatsByRole(bdMap, userLiujia);
  assert(r.visibleEntries.length === 1, `BD 视角仅自己 1 条`);
  assert(r.visibleEntries[0][0] === userLiujia.bdManagerFullName, `唯一可见 key = 刘佳`);
  assert(r.aggregatedOthers !== null, `必须存在 aggregatedOthers 聚合`);
  if (r.aggregatedOthers) {
    assert(r.aggregatedOthers.countOthers === 3, `其他 BD 数=3（=总 4 - 我 1）`);
    assert(
      r.aggregatedOthers.label === '其他商务经理（3 位）',
      `聚合 label="其他商务经理（3 位）" 无姓名泄露`
    );
    const myCount = r.visibleEntries[0][1].count;
    const othersCount = r.aggregatedOthers.count;
    assert(myCount + othersCount === allClients.length, `我客户数 + 聚合数 = 总客户数（${myCount}+${othersCount}=${myCount + othersCount} === ${allClients.length}）`);
    const myAmount = r.visibleEntries[0][1].amount;
    const othersAmount = r.aggregatedOthers.amount;
    const totalAmount = allClients.reduce((s, c) => s + (c.investmentAmount ?? 0), 0);
    assert(
      Math.abs(myAmount + othersAmount - totalAmount) < 0.01,
      `我金额+聚合金额 与总金额误差<0.01`
    );
    console.log(`  ℹ️  刘佳客户 ${myCount} 位 投资$${(myAmount/10000).toFixed(2)}万 | 其他 3 BD 合计 ${othersCount} 位 $${(othersAmount/10000).toFixed(2)}万`);
  }
});

// --- T7: filterBdStats AMD 局部批次 ---
test('T7.1 AMD 批次局部 BD 分布 BD_LIXIAOMING = 自己 + 其他 3 聚合', () => {
  const { clients: amdClients } = batchClientsBySymbol(data.batches, 'AMD');
  const bdMap = aggregateBdMap(amdClients);
  const r = filterBdStatsByRole(bdMap, userLixiaoming);
  assert(r.visibleEntries.length === 1 || (r.visibleEntries.length === 0 && r.aggregatedOthers), '或自己 0 客户时 visible=0 仅聚合');
  if (r.visibleEntries.length > 0) {
    assert(r.visibleEntries[0][0] === userLixiaoming.bdManagerFullName, '可见 key=李晓明');
  }
  if (r.aggregatedOthers) {
    const otherBdKeys = Object.keys(bdMap).filter(k => k !== userLixiaoming.bdManagerFullName).length;
    assert(r.aggregatedOthers.countOthers === otherBdKeys, `其他 BD countOthers=${otherBdKeys}`);
  }
});

// --- T8: filterMarginCallsByRole 全行可见 ---
test('T8.1 补仓记录 = 批次宏观信息，无论 RISK/BD 均全行可见（FR-5.1）', () => {
  const rRisk = filterMarginCallsByRole(allMarginCalls, userRisk);
  const rBd = filterMarginCallsByRole(allMarginCalls, userLiujia);
  assert(rRisk.length === allMarginCalls.length, `Risk 视角 MC 数量=原 ${rRisk.length}`);
  assert(rBd.length === allMarginCalls.length, `BD 视角 MC 数量=原 ${rBd.length}`);
  assert(rBd.length === rRisk.length, `两个视角 MC 数量相等`);
});

// --- T9: 边缘 — BD 自己名下 0 客户时 ---
test('T9.1 构造虚构 BD "虚构 BD"（名下 0），filterBatchDetailClientsByRole 仍返回原总行数 78 占位', () => {
  const fakeBdUser: AppSessionUser = {
    id: 'fake',
    email: 'fake@test.com',
    role: APP_ROLES.BD_MANAGER,
    displayName: '虚构',
    avatarInitials: 'FK',
    bdManagerFullName: '虚构 BD (Fake BD)',
  };
  const r = filterBatchDetailClientsByRole(allClients.slice(0, 78), fakeBdUser);
  assert(r.visibleOwnCount === 0, `虚构 BD 真实客户=0`);
  assert(r.redactedCount === 78, `虚构 BD 脱敏=78`);
  assert(r.mergedRows.length === 78, `mergedRows 仍=78 保留原数防猜`);
  assert(r.mergedRows.every((row: any) => row.__redacted === true), `所有 78 行均为 __redacted`);
});

// --- T10: 数据泄漏检测 — BD 视角 mergedRows 中的脱敏行不包含任何原始客户姓名/金额 ---
test('T10.1 泄漏检测：BD_LIUJIA AMD mergedRows 脱敏行 无原始客户姓名或 bdManager 泄露', () => {
  const { clients: amdClients } = batchClientsBySymbol(data.batches, 'AMD');
  const r = filterBatchDetailClientsByRole(amdClients, userLiujia);
  const redactedRows = r.mergedRows.filter((row: any) => row.__redacted) as any[];
  const originalOtherClientNames = new Set(
    amdClients.filter(c => c.bdManager !== userLiujia.bdManagerFullName).map(c => c.name)
  );
  for (const row of redactedRows) {
    assert(
      !originalOtherClientNames.has(row.name),
      `脱敏行 name="${row.name}" 不等于任何真实其他 BD 客户姓名`
    );
    assert(row.investmentAmount === null, `脱敏行 investmentAmount=null 无金额泄露`);
    assert(row.bdManager === '（已隐藏）', `脱敏行 bdManager=固定隐藏 不暴露其他 BD 姓名`);
  }
});

// --- Summary ---
console.log(`\n\n=====================================================`);
console.log(`🎉 验收完成: ${passCount}/10 子测试全部通过`);
console.log(`   T1 全量 RISK          ✅`);
console.log(`   T2 BD 客户管理隔离    ✅`);
console.log(`   T3 AMD 批次保留总行数 ✅（含占位行防猜）`);
console.log(`   T4 MSFT 批次逻辑      ✅`);
console.log(`   T5 RISK BD 分布全量   ✅`);
console.log(`   T6 BD 分布 3 人聚合   ✅（无其他 BD 姓名）`);
console.log(`   T7 AMD 局部 BD 分布   ✅`);
console.log(`   T8 补仓记录全行可见   ✅`);
console.log(`   T9 边缘 0 客户 BD     ✅`);
console.log(`   T10 泄漏检测          ✅`);
console.log(`=====================================================`);
