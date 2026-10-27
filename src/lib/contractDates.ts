/** UTC contract dates; clamp month ends instead of overflowing into the following month. */
export function validDate(value: Date | string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('合约日期无效');
  return date;
}
export function addContractMonths(value: Date | string, months: number): Date {
  const source = validDate(value); const date = new Date(source);
  const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last)); return date;
}
export function contractDates(signDate: Date | string, fields: Record<string, any> = {}) {
  const sign = validDate(signDate);
  const positive = (v: unknown, fallback: number, max: number) => {
    if (v === undefined || v === null) return fallback;
    if (!Number.isInteger(v) || Number(v) < 1 || Number(v) > max) throw new Error('合约期限配置无效');
    return Number(v);
  };
  const lockUpEndDate = fields.lockUpEndDate ? validDate(fields.lockUpEndDate) : addContractMonths(sign, 6);
  const finalMaturityDate = fields.finalMaturityDate ? validDate(fields.finalMaturityDate) : addContractMonths(sign, 24);
  if (lockUpEndDate < sign || finalMaturityDate <= lockUpEndDate) throw new Error('合约锁定日和到期日无效');
  return { lockUpEndDate, finalMaturityDate, exitWindowMonths: positive(fields.exitWindowMonths, 3, 24), noticePeriodDays: positive(fields.noticePeriodDays, 15, 365), exitWindowDays: positive(fields.exitWindowDays, 14, 90) };
}
/** First permitted settlement instant at/after notice, including maturity (no window restriction). */
export function nextContractExit(contract: ReturnType<typeof contractDates>, after: Date): Date {
  const earliest = new Date(Math.max(after.getTime(), contract.lockUpEndDate.getTime()));
  if (earliest >= contract.finalMaturityDate) return earliest;
  for (let i = 0; i <= 120; i++) {
    const start = addContractMonths(contract.lockUpEndDate, i * contract.exitWindowMonths);
    if (start >= contract.finalMaturityDate) return contract.finalMaturityDate;
    const end = new Date(start.getTime() + contract.exitWindowDays * 86400000);
    if (earliest < end) return new Date(Math.max(earliest.getTime(), start.getTime()));
  }
  throw new Error('无法计算退出窗口');
}
