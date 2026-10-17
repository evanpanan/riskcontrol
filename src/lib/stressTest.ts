/**
 * Phase 6.3: 压力测试模块
 *
 * 后台模拟器：输入情景（XMAX 跌 X%、T+N 延期、多批同时击穿），
 * 实时计算补仓总金额、各方分摊、保本线突破情况、WIN100 最大亏损。
 *
 * 不修改 riskEngine.ts 核心计算，仅在此模块通过"克隆批次 + 覆盖 currentStockPrice"
 * 的方式复用 getBatchMetrics / calculateBatchPnLSplit / getCollateralRatio 等已有函数。
 */

import {
  type BatchLike,
  getBatchMetrics,
  calculateBatchPnLSplit,
  getCollateralRatio,
  getAccountMarketValue,
  calculateRescueStats,
  CRITICAL_DROP_THRESHOLD,
  SUBORDINATE_RATIO,
  PRIORITY_RATIO,
} from "./riskEngine";

/** 压力测试情景输入 */
export interface StressScenario {
  /** XMAX 目标跌幅百分比（正数，如 30 表示跌 30%） */
  dropPercent: number;
  /** 补仓到账延期天数（T+N），如 5 表示 T+5 */
  settlementDelayDays: number;
  /** 是否全仓同时击穿（true=所有批次同时应用跌幅；false=仅选中批次） */
  allBatches: boolean;
  /** 指定批次 ID 列表（allBatches=false 时生效） */
  batchIds?: string[];
  /** 额外单次补仓金额（模拟追加保证金） */
  extraTopup?: number;
}

/** 单批次压力测试结果 */
export interface BatchStressResult {
  batchId: string;
  batchNumber: string;
  stockSymbol: string;
  /** 情景前价格 */
  originalPrice: number;
  /** 情景后价格 */
  stressedPrice: number;
  /** 实际跌幅% */
  actualDropPercent: number;
  /** 情景前总市值 */
  originalMarketValue: number;
  /** 情景后总市值 */
  stressedMarketValue: number;
  /** 需补仓金额 */
  requiredMarginCall: number;
  /** 风险等级 */
  riskLevel: string;
  /** 跌幅% */
  dropPercentMetrics: number;
  /** 安全缓冲% */
  safetyBufferPercent: number;
  /** 是否击穿保本线（客户本金亏损） */
  principalBreached: boolean;
  /** 客户总 PnL */
  clientTotalPnL: number;
  /** WIN100 总 PnL（含担保品 + 分成） */
  win100TotalPnL: number;
  /** WIN100 担保品市值 */
  collateralValue: number;
  /** 担保比例 */
  collateralRatio: number;
  /** 担保比例是否低于警戒线 */
  collateralBreached: boolean;
}

/** 压力测试汇总结果 */
export interface StressTestResult {
  scenario: StressScenario;
  /** 测试时间戳 */
  timestamp: number;
  /** 参与测试的批次数 */
  batchCount: number;
  /** 补仓总金额 */
  totalRequiredMarginCall: number;
  /** 击穿补仓线的批次数 */
  criticalBatchCount: number;
  /** 击穿保本线的批次数 */
  principalBreachedCount: number;
  /** 担保比例低于警戒线的批次数 */
  collateralBreachedCount: number;
  /** WIN100 最大潜在亏损（所有批次 win100TotalPnL 之和的负数部分） */
  win100MaxLoss: number;
  /** 客户最大潜在亏损 */
  clientMaxLoss: number;
  /** 各批次明细 */
  batches: BatchStressResult[];
  /** 各方分摊估算 */
  splitEstimate: {
    /** 客户优先本金损失（保本线以上由 WIN100 承担） */
    clientLoss: number;
    /** WIN100 承担的亏损（担保品 + 劣后） */
    win100Loss: number;
    /** 需外部补仓金额 */
    externalTopup: number;
  };
}

/** 默认压力测试情景 */
export const DEFAULT_STRESS_SCENARIO: StressScenario = {
  dropPercent: 30,
  settlementDelayDays: 2,
  allBatches: true,
  extraTopup: 0,
};

/**
 * 深度克隆批次（仅保留计算所需字段，避免引用污染）
 */
function cloneBatch(batch: BatchLike): BatchLike {
  return JSON.parse(JSON.stringify(batch)) as BatchLike;
}

/**
 * 对单个批次应用压力情景并计算结果
 */
export function runBatchStressTest(
  batch: BatchLike,
  scenario: StressScenario
): BatchStressResult {
  const originalPrice = Number(batch.currentStockPrice ?? batch.stockPriceAtStart ?? 0);
  const dropRatio = Math.max(0, Math.min(1, scenario.dropPercent / 100));
  const stressedPrice = originalPrice * (1 - dropRatio);

  // 克隆批次并覆盖价格
  const stressed = cloneBatch(batch);
  stressed.currentStockPrice = stressedPrice;
  if (stressed.finance) {
    // finance 不依赖价格快照，无需修改
  }

  const metrics = getBatchMetrics(stressed);
  const pnlSplit = calculateBatchPnLSplit(stressed, metrics.currentMarketValue);
  const collateral = getCollateralRatio(stressed);
  const rescue = calculateRescueStats(stressed, stressedPrice);

  // 保本线突破：客户总 PnL < 0 表示客户本金亏损（击穿保本线）
  const principalBreached = pnlSplit.clientTotalPnL < -0.01;

  return {
    batchId: batch.id,
    batchNumber: batch.batchNumber ?? batch.id,
    stockSymbol: batch.stockSymbol ?? "",
    originalPrice,
    stressedPrice,
    actualDropPercent: dropRatio * 100,
    originalMarketValue: getAccountMarketValue(batch, originalPrice),
    stressedMarketValue: metrics.currentMarketValue,
    requiredMarginCall: metrics.requiredMarginCall,
    riskLevel: String(metrics.riskLevel),
    dropPercentMetrics: metrics.dropPercent,
    safetyBufferPercent: metrics.safetyBufferPercent,
    principalBreached,
    clientTotalPnL: pnlSplit.clientTotalPnL,
    win100TotalPnL: pnlSplit.institutionTotalPnL + rescue.rescuePnL,
    collateralValue: collateral.collateralValue,
    collateralRatio: collateral.ratio,
    collateralBreached: collateral.breached,
  };
}

/**
 * 执行完整压力测试
 * @param batches 所有批次
 * @param scenario 情景参数
 */
export function runStressTest(
  batches: BatchLike[],
  scenario: StressScenario
): StressTestResult {
  const targetBatches = scenario.allBatches
    ? batches
    : batches.filter((b) => scenario.batchIds?.includes(b.id));

  const results = targetBatches.map((b) => runBatchStressTest(b, scenario));

  const totalRequiredMarginCall = results.reduce((s, r) => s + r.requiredMarginCall, 0);
  const criticalBatchCount = results.filter(
    (r) => r.riskLevel === "CRITICAL" || r.dropPercentMetrics >= CRITICAL_DROP_THRESHOLD * 100
  ).length;
  const principalBreachedCount = results.filter((r) => r.principalBreached).length;
  const collateralBreachedCount = results.filter((r) => r.collateralBreached).length;

  // WIN100 最大潜在亏损 = 所有批次 win100TotalPnL 中负数之和（取绝对值）
  const win100MaxLoss = Math.abs(
    results.reduce((s, r) => s + Math.min(0, r.win100TotalPnL), 0)
  );
  const clientMaxLoss = Math.abs(
    results.reduce((s, r) => s + Math.min(0, r.clientTotalPnL), 0)
  );

  // 各方分摊估算
  const win100Loss = win100MaxLoss;
  const clientLoss = clientMaxLoss;
  // 外部补仓 = 总需补仓 - WIN100 已承担（担保品+劣后）的部分
  const externalTopup = Math.max(0, totalRequiredMarginCall - win100Loss);

  return {
    scenario,
    timestamp: Date.now(),
    batchCount: results.length,
    totalRequiredMarginCall,
    criticalBatchCount,
    principalBreachedCount,
    collateralBreachedCount,
    win100MaxLoss,
    clientMaxLoss,
    batches: results,
    splitEstimate: {
      clientLoss,
      win100Loss,
      externalTopup,
    },
  };
}

/**
 * 生成压力测试报告文本（用于 PDF 导出 / 复制）
 */
export function generateStressTestReport(result: StressTestResult): string {
  const lines: string[] = [];
  lines.push("========================================");
  lines.push("       风控压力测试报告");
  lines.push("========================================");
  lines.push(`生成时间: ${new Date(result.timestamp).toLocaleString("zh-CN")}`);
  lines.push("");
  lines.push("【测试情景】");
  lines.push(`  XMAX 跌幅: ${result.scenario.dropPercent}%`);
  lines.push(`  补仓到账延期: T+${result.scenario.settlementDelayDays}`);
  lines.push(`  全仓测试: ${result.scenario.allBatches ? "是" : "否"}`);
  lines.push(`  参与批次数: ${result.batchCount}`);
  lines.push("");
  lines.push("【汇总结果】");
  lines.push(`  补仓总金额: $${result.totalRequiredMarginCall.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push(`  击穿补仓线批次: ${result.criticalBatchCount}`);
  lines.push(`  击穿保本线批次: ${result.principalBreachedCount}`);
  lines.push(`  担保比例不足批次: ${result.collateralBreachedCount}`);
  lines.push(`  WIN100 最大潜在亏损: $${result.win100MaxLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push(`  客户最大潜在亏损: $${result.clientMaxLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push("");
  lines.push("【各方分摊估算】");
  lines.push(`  客户承担损失: $${result.splitEstimate.clientLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push(`  WIN100 承担损失: $${result.splitEstimate.win100Loss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push(`  需外部补仓: $${result.splitEstimate.externalTopup.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push("");
  lines.push("【批次明细】");
  for (const b of result.batches) {
    lines.push(`  ${b.batchNumber} (${b.stockSymbol})`);
    lines.push(`    价格: $${b.originalPrice.toFixed(2)} → $${b.stressedPrice.toFixed(2)} (-${b.actualDropPercent.toFixed(1)}%)`);
    lines.push(`    市值: $${b.originalMarketValue.toLocaleString()} → $${b.stressedMarketValue.toLocaleString()}`);
    lines.push(`    需补仓: $${b.requiredMarginCall.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    lines.push(`    风险等级: ${b.riskLevel} | 跌幅: ${b.dropPercentMetrics.toFixed(2)}% | 缓冲: ${b.safetyBufferPercent.toFixed(2)}%`);
    lines.push(`    保本线: ${b.principalBreached ? "⚠ 已击穿" : "安全"}`);
    lines.push(`    客户 PnL: $${b.clientTotalPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    lines.push(`    WIN100 PnL: $${b.win100TotalPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    lines.push(`    担保比例: ${(b.collateralRatio * 100).toFixed(1)}% ${b.collateralBreached ? "⚠ 低于警戒线" : "安全"}`);
    lines.push("");
  }
  lines.push("========================================");
  lines.push(`优先/劣后比例: ${(PRIORITY_RATIO * 100).toFixed(0)}% / ${(SUBORDINATE_RATIO * 100).toFixed(0)}%`);
  lines.push(`补仓击穿线: ${(CRITICAL_DROP_THRESHOLD * 100).toFixed(0)}%`);
  lines.push("========================================");
  return lines.join("\n");
}
