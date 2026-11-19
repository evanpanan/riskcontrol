import { getNYSEInfo } from '@/lib/liveQuote';
/** Most recent completed regular trading session, including weekends and holidays. */
export function completedSessionDate(now = Date.now()): string {
  const info = getNYSEInfo(now);
  if (info.isTradingDay && info.hour24 >= 13 && !info.inRegularSession) return info.ymd;
  let day = Date.parse(`${info.ymd}T23:00:00Z`);
  for (let i = 0; i < 14; i++) {
    day -= 86400000;
    const candidate = getNYSEInfo(day);
    if (candidate.isTradingDay) return candidate.ymd;
  }
  throw new Error('无法确定最近交易日');
}
