import { prisma } from '@/lib/prisma';
import { yahooFinanceHistory, nasdaqHistory, stooqHistory, finnhubHistory } from '@/lib/quote/providers';
import { candleDate, marketDate } from '@/lib/batchDaily';
import { replayBatchDay } from '@/lib/batchHistoryReplay';
import type { BatchLike } from '@/lib/riskEngine';
import type { Prisma } from '@prisma/client';

const ARCHIVE_INTERVAL = '1d-final';
const DAY = 86400000;

export async function fetchDailyCloses(symbol: string, date?: string) {
  const from = date ? Date.parse(date) : undefined;
  const bounds = from === undefined ? undefined : { from, to: from + DAY };
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
        (!date || candleDate(c.time) === date));
      if (candles.length) return { provider: provider.name, candles };
    } catch { /* Try the next source. */ }
  }
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
    provider: history.provider,
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

async function initializeHistory(symbol: string, today: string) {
  const where = { kind_key: { kind: 'quote_archive', key: symbol } };
  const marker = await prisma.workspaceRecord.findUnique({ where });
  if (marker) return;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'quote_archive:' + symbol}))`;
    if (await tx.workspaceRecord.findUnique({ where })) return;
    const history = await fetchDailyCloses(symbol);
    const completed = history.candles.filter(c => candleDate(c.time) < today);
    if (!completed.length) return;
    await archiveDailyCloses(tx, symbol, { ...history, candles: completed }, today);
    await tx.workspaceRecord.create({
      data: { kind: 'quote_archive', key: symbol, payload: { initialized: true } },
    });
  }, { timeout: 60000, maxWait: 5000 });
}

export async function backfillBatchHistory(batch: BatchLike, storedDates: Set<string>, now = new Date()) {
  if (!batch.stockSymbol) return [];
  const symbol = batch.stockSymbol.trim().toUpperCase();
  const today = marketDate(now);
  let initializationError: unknown;
  try { await initializeHistory(symbol, today); } catch (error) { initializationError = error; }
  const candles = await prisma.quoteHistoryCandle.findMany({
    where: { symbol, interval: ARCHIVE_INTERVAL, candleTime: { lt: new Date(today) } },
    orderBy: { candleTime: 'asc' },
  });
  if (!candles.length && initializationError) throw initializationError;
  return candles.flatMap(candle => {
    const date = candleDate(candle.candleTime.getTime());
    if (storedDates.has(date)) return [];
    const summary = replayBatchDay(batch, date, candle.close);
    return summary ? [{
      ...summary, capturedAt: candle.createdAt.toISOString(), source: candle.provider, reconstructed: true,
    }] : [];
  });
}
