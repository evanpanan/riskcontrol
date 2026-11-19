import { getNYSEInfo } from '@/lib/liveQuote';
import { completedSessionDate } from '@/lib/marketSession';
import { prisma } from '@/lib/prisma';
import { yahooFinanceHistory, nasdaqHistory, stooqHistory, finnhubHistory, type HistoryCandle } from '@/lib/quote/providers';
import { candleDate, contractDate } from '@/lib/batchDaily';
import { replayBatchDay } from '@/lib/batchHistoryReplay';
import type { BatchLike } from '@/lib/riskEngine';
import type { Prisma } from '@prisma/client';

const ARCHIVE_INTERVAL = '1d-final';
const DAY = 86400000;

export function tradingDates(from: string, through: string) {
  const dates: string[] = [];
  for (let time = Date.parse(from); time <= Date.parse(through); time += DAY) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (getNYSEInfo(Date.parse(`${date}T23:00:00Z`)).isTradingDay) dates.push(date);
  }
  return dates;
}

export async function fetchDailyCloses(symbol: string, date?: string, through?: string): Promise<{ provider: string; candles: Array<HistoryCandle & { provider?: string }> }> {
  const from = date ? Date.parse(date) : undefined;
  const bounds = from === undefined ? undefined : { from, to: (through ? Date.parse(through) : from) + DAY };
  const expected = date && through ? tradingDates(date, through) : undefined;
  const collected = new Map<string, HistoryCandle & { provider?: string }>();
  const providers = [
    ...(process.env.FINNHUB_API_KEY ? [{ name: 'FINNHUB', load: finnhubHistory }] : []),
    { name: 'YAHOO_FINANCE', load: yahooFinanceHistory },
    { name: 'NASDAQ_UNOFFICIAL', load: nasdaqHistory },
    { name: 'STOOQ', load: stooqHistory },
  ];
  for (const provider of providers) {
    try {
      const candles = (await provider.load(symbol, '1Y', bounds)).filter(c =>
        Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0 &&
        (!date || (candleDate(c.time) >= date && candleDate(c.time) <= (through ?? date))));
      if (!expected && candles.length) return { provider: provider.name, candles };
      for (const candle of candles) {
        const day = candleDate(candle.time);
        if (!collected.has(day)) collected.set(day, { ...candle, provider: provider.name });
      }
      if (expected?.every(day => collected.has(day))) return { provider: provider.name, candles: [...collected.values()] };
    } catch { /* Try the next source. */ }
  }
  if (collected.size) return { provider: 'DAILY_ARCHIVE', candles: [...collected.values()] };
  throw new Error('行情源暂无可用的历史收盘价');
}

export async function archiveDailyCloses(
  db: Prisma.TransactionClient,
  symbol: string,
  history: Awaited<ReturnType<typeof fetchDailyCloses>>,
  through: string,
) {
  const rows = history.candles.filter(c => candleDate(c.time) <= through).map(c => ({
    symbol, interval: ARCHIVE_INTERVAL, candleTime: new Date(candleDate(c.time)),
    open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0,
    provider: c.provider ?? history.provider,
  }));
  if (rows.length) await db.quoteHistoryCandle.createMany({ data: rows, skipDuplicates: true });
}

export async function getOrArchiveDailyClose(
  symbol: string,
  date: string,
  loadHistory = fetchDailyCloses,
) {
  const where = {
    symbol_interval_candleTime: { symbol, interval: ARCHIVE_INTERVAL, candleTime: new Date(date) },
  };
  const archived = await prisma.quoteHistoryCandle.findUnique({ where });
  if (archived) return archived;
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'quote_archive:' + symbol}))`;
    const existing = await tx.quoteHistoryCandle.findUnique({ where });
    if (existing) return existing;
    const history = await loadHistory(symbol, date);
    await archiveDailyCloses(tx, symbol, {
      ...history, candles: history.candles.filter(c => candleDate(c.time) === date),
    }, date);
    return tx.quoteHistoryCandle.findUnique({ where });
  }, { timeout: 60000, maxWait: 5000 });
}

/** Check actual coverage, not an old initialized flag. Only fetch missing date ranges. */
export async function ensureDailyCloseHistory(symbol: string, from: string, now = new Date()) {
  const through = completedSessionDate(now.getTime());
  const expected = tradingDates(from, through);
  const where = { symbol, interval: ARCHIVE_INTERVAL, candleTime: { gte: new Date(from), lte: new Date(through) } };
  const read = (db: Pick<Prisma.TransactionClient, 'quoteHistoryCandle'>) => db.quoteHistoryCandle.findMany({ where, orderBy: { candleTime: 'asc' } });
  let candles = await read(prisma);
  const missing = (rows: typeof candles) => {
    const dates = new Set(rows.map(c => candleDate(c.candleTime.getTime())));
    return expected.filter(date => !dates.has(date));
  };
  if (missing(candles).length) {
    candles = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'quote_archive:' + symbol}))`;
      const existing = await read(tx);
      const gaps = missing(existing);
      if (!gaps.length) return existing;
      const markerWhere = { kind_key: { kind: 'quote_archive', key: symbol } };
      const marker = await tx.workspaceRecord.findUnique({ where: markerWhere });
      const attempt = marker?.payload as { from?: string; through?: string; attemptedAt?: number } | undefined;
      if (attempt?.from === from && attempt.through === through && now.getTime() - (attempt.attemptedAt ?? 0) < 60000) return existing;
      try {
        const history = await fetchDailyCloses(symbol, gaps[0], gaps.at(-1));
        await archiveDailyCloses(tx, symbol, history, through);
      } catch { /* Keep available genuine closes and report missing dates to the caller. */ }
      await tx.workspaceRecord.upsert({ where: markerWhere,
        create: { kind: 'quote_archive', key: symbol, payload: { from, through, attemptedAt: now.getTime() } },
        update: { payload: { from, through, attemptedAt: now.getTime() } },
      });
      return read(tx);
    }, { timeout: 60000, maxWait: 5000 });
  }
  return { candles, missingDates: missing(candles) };
}

export async function backfillBatchHistory(batch: BatchLike, storedDates: Set<string>, now = new Date()) {
  if (!batch.stockSymbol) return [];
  const symbol = batch.stockSymbol.trim().toUpperCase();
  const from = contractDate(batch.signDate);
  const { candles } = await ensureDailyCloseHistory(symbol, from, now);
  return candles.flatMap(candle => {
    const date = candleDate(candle.candleTime.getTime());
    if (storedDates.has(date)) return [];
    const summary = replayBatchDay(batch, date, candle.close);
    return summary ? [{
      ...summary, capturedAt: candle.createdAt.toISOString(), source: candle.provider, reconstructed: true,
    }] : [];
  });
}
