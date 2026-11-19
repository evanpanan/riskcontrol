import { contractDate, marketDate } from "@/lib/batchDaily";
import { replayBatchState } from "@/lib/batchHistoryReplay";
import {
  calculateClientSettlement,
  calculateClientRescueStats,
  getClientProfitSplit,
  type BatchLike,
  type ClientLike,
} from "@/lib/riskEngine";

export type StatementPosition = {
  batchNumber: string;
  symbol: string;
  clientNo: string;
  signDate: string;
  status: string;
  investment: number;
  shares: number;
  entryPrice: number;
  closePrice: number;
  stockValue: number;
  equity: number;
  pnl: number;
  clientSplit: number;
  institutionSplit: number;
  institutionTopupShares: number;
  institutionTopupCash: number;
  institutionCapital: number;
  institutionShares: number;
  accountShares: number;
  accountValue: number;
  valuationDate: string;
};
export type StatementEvent = {
  date: string;
  batchNumber: string;
  type: string;
  amount: number;
  shares: number;
  price: number | null;
  owner: string;
};
export type MonthlyStatementReport = {
  version: 1;
  month: string;
  customerName: string;
  bdManager: string;
  start: string;
  end: string;
  openingDate: string;
  closingDate: string;
  openingEquity: number;
  deposits: number;
  withdrawals: number;
  closingEquity: number;
  monthlyPnL: number;
  cumulativePnL: number;
  positions: StatementPosition[];
  events: StatementEvent[];
};
export function statementMonthBounds(month: string, now = new Date()) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    month < "2020-01" ||
    month >= marketDate(now).slice(0, 7)
  )
    throw new Error("请选择已经结束的月份");
  const [year, m] = month.split("-").map(Number);
  return {
    start: `${month}-01`,
    end: new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10),
    previousEnd: new Date(Date.UTC(year, m - 1, 0)).toISOString().slice(0, 10),
  };
}
export function previousStatementMonth(now = new Date()) {
  const [year, m] = marketDate(now).slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, m - 2, 1)).toISOString().slice(0, 7);
}
export function statementClientEnd(batch: BatchLike, c: ClientLike) {
  const snapshot = batch.finance?.settlements[c.id] ?? c.settlement;
  return snapshot ? marketDate(new Date(snapshot.settledAt)) : null;
}
export function statementClientInMonth(
  batch: BatchLike,
  c: ClientLike,
  start: string,
  end: string,
) {
  return (
    contractDate(c.signDate) <= end &&
    (!statementClientEnd(batch, c) || statementClientEnd(batch, c)! >= start)
  );
}
export function buildMonthlyStatement(input: {
  month: string;
  customerName: string;
  bdManager: string;
  batches: BatchLike[];
  clientIds: Set<string>;
  openingDate: string;
  closingDate: string;
  prices: Map<string, number>;
  now?: Date;
}): MonthlyStatementReport {
  const bounds = statementMonthBounds(input.month, input.now);
  const report: MonthlyStatementReport = {
    version: 1,
    month: input.month,
    customerName: input.customerName,
    bdManager: input.bdManager,
    start: bounds.start,
    end: bounds.end,
    openingDate: input.openingDate,
    closingDate: input.closingDate,
    openingEquity: 0,
    deposits: 0,
    withdrawals: 0,
    closingEquity: 0,
    monthlyPnL: 0,
    cumulativePnL: 0,
    positions: [],
    events: [],
  };
  for (const batch of input.batches)
    for (const client of batch.clients ?? []) {
      if (
        !input.clientIds.has(client.id) ||
        contractDate(client.signDate) > bounds.end
      )
        continue;
      const priorExit =
        batch.finance?.settlements[client.id] ?? client.settlement;
      if (
        priorExit &&
        marketDate(new Date(priorExit.settledAt)) < bounds.start
      ) {
        report.cumulativePnL +=
          priorExit.clientReceives - client.investmentAmount;
        continue;
      }
      const signDate = contractDate(client.signDate);
      const exit = batch.finance?.settlements[client.id] ?? client.settlement;
      const exitDate = statementClientEnd(batch, client);
      const ended = !!exitDate && exitDate <= bounds.end;
      const endPrice = ended
        ? exit!.stockPrice
        : input.prices.get(
            `${batch.stockSymbol!.toUpperCase()}|${input.closingDate}`,
          );
      if (!endPrice || !Number.isFinite(endPrice))
        throw new Error(
          `${batch.batchNumber ?? batch.id} 缺少 ${input.closingDate} 的真实收盘价`,
        );
      const endState = replayBatchState(batch, bounds.end, endPrice);
      const endClient = endState?.clients?.find((c) => c.id === client.id);
      if (!endState || !endClient)
        throw new Error("客户历史仓位无法还原，请核对签约日期");
      const settlement = calculateClientSettlement(
        endClient,
        endState,
        0,
        endPrice,
      );
      const equity = ended ? 0 : settlement.clientReceives;
      let openingEquity = 0;
      if (
        signDate <= bounds.previousEnd &&
        (!exitDate || exitDate > bounds.previousEnd)
      ) {
        const openPrice = input.prices.get(
          `${batch.stockSymbol!.toUpperCase()}|${input.openingDate}`,
        );
        if (!(openPrice && openPrice > 0))
          throw new Error(
            `${batch.batchNumber ?? batch.id} 缺少 ${input.openingDate} 的真实收盘价`,
          );
        const state = replayBatchState(batch, bounds.previousEnd, openPrice);
        const c = state?.clients?.find((c) => c.id === client.id);
        if (!state || !c) throw new Error("月初仓位无法还原");
        openingEquity = calculateClientSettlement(
          c,
          state,
          0,
          openPrice,
        ).clientReceives;
      }
      const entryPrice = client.entryStockPrice || batch.stockPriceAtStart;
      if (!(entryPrice > 0) || !Number.isFinite(client.investmentAmount))
        throw new Error("客户本金或入场价无效");
      const shares = client.investmentAmount / entryPrice;
      const rescue = calculateClientRescueStats(
        endState,
        endPrice,
        client.id,
        endState.priorityAmount > 0
          ? client.investmentAmount / endState.priorityAmount
          : 0,
      );
      if ((rescue.unpricedAmount ?? 0) > 0.005)
        throw new Error(
          "历史机构补仓的价格或股数尚未核对，请核对后再生成月结单",
        );
      const split = getClientProfitSplit(client);
      const weight =
        endState.priorityAmount > 0
          ? client.investmentAmount / endState.priorityAmount
          : 0;
      const institutionShares = endState.finance?.institutionPosition
        ? endState.finance.institutionPosition.shares * weight
        : (shares * 0.3) / 0.7;
      report.openingEquity += openingEquity;
      report.closingEquity += equity;
      report.cumulativePnL +=
        (ended ? exit!.clientReceives : equity) - client.investmentAmount;
      if (signDate >= bounds.start) {
        report.deposits += client.investmentAmount;
        report.events.push({
          date: signDate,
          batchNumber: batch.batchNumber ?? batch.id,
          type: "客户入金",
          amount: client.investmentAmount,
          shares,
          price: entryPrice,
          owner: "客户",
        });
      }
      if (ended) {
        report.withdrawals += exit!.clientReceives;
        report.events.push({
          date: exitDate!,
          batchNumber: batch.batchNumber ?? batch.id,
          type: "退出结算（已扣费用）",
          amount: exit!.clientReceives,
          shares,
          price: exit!.stockPrice,
          owner: "客户",
        });
      }
      for (const trade of batch.finance?.trades ?? []) {
        const date = marketDate(new Date(trade.createdAt));
        if (
          trade.clientId !== client.id ||
          date < bounds.start ||
          date > bounds.end
        )
          continue;
        report.events.push({
          date,
          batchNumber: batch.batchNumber ?? batch.id,
          type:
            trade.collateralType === "cash" ? "机构现金补仓" : "机构股票补仓",
          amount: trade.amount,
          shares: trade.shares,
          price: trade.entryPrice,
          owner: "WIN100",
        });
      }
      report.positions.push({
        batchNumber: batch.batchNumber ?? batch.id,
        symbol: batch.stockSymbol ?? "",
        clientNo: client.clientNo ?? "",
        signDate,
        status: ended
          ? "已退出"
          : endClient.status === "EXIT_REQUESTED"
            ? "申请退出中"
            : "持仓中",
        investment: client.investmentAmount,
        shares: ended ? 0 : shares,
        entryPrice,
        closePrice: endPrice,
        stockValue: ended ? 0 : shares * endPrice,
        equity,
        pnl: (ended ? exit!.clientReceives : equity) - client.investmentAmount,
        clientSplit: split.client * 100,
        institutionSplit: split.institution * 100,
        institutionCapital: ended ? 0 : endState.subordinateAmount * weight,
        institutionShares: ended ? 0 : institutionShares,
        accountShares: ended
          ? 0
          : shares + institutionShares + rescue.totalRescueShares,
        accountValue: ended
          ? 0
          : settlement.clientReceives + settlement.institutionReceives,
        valuationDate: ended ? exitDate! : input.closingDate,
        institutionTopupShares: ended ? 0 : rescue.totalRescueShares,
        institutionTopupCash: ended
          ? 0
          : (endState.finance?.trades ?? [])
              .filter(
                (t) =>
                  (t.clientId === client.id || !t.clientId) &&
                  t.collateralType === "cash",
              )
              .reduce(
                (sum, t) =>
                  sum +
                  t.amount * t.remainingFraction * (t.clientId ? 1 : weight),
                0,
              ),
      });
    }
  if (!report.positions.length)
    throw new Error("该客户在所选月份没有仓位或交易");
  report.monthlyPnL =
    report.closingEquity +
    report.withdrawals -
    report.openingEquity -
    report.deposits;
  report.events.sort((a, b) => a.date.localeCompare(b.date));
  return report;
}
