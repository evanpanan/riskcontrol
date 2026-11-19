import { getOrArchiveDailyClose } from '@/lib/server/batchHistoryBackfill';
import { jsonNoStore, resolveSessionUser, unauthorized } from '@/lib/server/apiAuth';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!await resolveSessionUser()) return unauthorized();
  const params = new URL(req.url).searchParams;
  const symbol = (params.get('symbol') ?? '').trim().toUpperCase();
  const date = params.get('date') ?? '';
  if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) {
    return jsonNoStore({ error: '股票代码或日期无效' }, 400);
  }
  try {
    const candle = await getOrArchiveDailyClose(symbol, date);
    if (!candle) throw new Error('无收盘价');
    return jsonNoStore({ price: candle.close, date, source: candle.provider });
  } catch { return jsonNoStore({ error: '该日期暂无收盘价，请手动填写实际成交价' }, 404); }
}
