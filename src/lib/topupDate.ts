export function defaultTopupDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export function topupDateTimestamp(date?: string): string {
  if (date === undefined) return new Date().toISOString();
  // Noon UTC keeps the selected calendar day in both Hong Kong and New York.
  const timestamp = new Date(`${date}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp.getTime()) ||
      timestamp.toISOString().slice(0, 10) !== date) {
    throw new Error("请选择有效的补仓日期");
  }
  return timestamp.toISOString();
}
