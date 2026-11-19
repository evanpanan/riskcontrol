/** Shared UTF-16 bold ranges: safe for Telegram entities and escaped email HTML. */
export function notificationHighlights(message: string): { offset: number; length: number }[] {
  const pattern = /【(?:手动发送|系统自动提醒)】|^发起人：[^\n]+|^(?:📋|📉|💰) [^\n]+|^(?:批次|标的|批次客户|触发时人数|触发时价格|本次预警价格|当前跌幅|触发时跌幅|需补仓金额|对应股数|按触发价折合)[:：][^\n]+|批次 [^\s（，。]+(?:（[^）\n]+）)?|(?:需补仓金额|待补仓金额)[:：][^。\n]+|(?:实际跌幅|当前跌幅) [\d.]+%/gm;
  return [...message.matchAll(pattern)].map(match => ({ offset: match.index!, length: match[0].length }));
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function notificationEmailHtml(title: string, message: string) {
  let cursor = 0;
  let body = '';
  for (const range of notificationHighlights(message)) {
    body += escapeHtml(message.slice(cursor, range.offset));
    body += `<strong>${escapeHtml(message.slice(range.offset, range.offset + range.length))}</strong>`;
    cursor = range.offset + range.length;
  }
  body += escapeHtml(message.slice(cursor));
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:20px 12px;background:#f4f6f8;color:#17212f;font-family:Arial,'Microsoft YaHei',sans-serif"><div style="max-width:600px;margin:auto;background:#fff;border:1px solid #e2e6ed;border-radius:12px;padding:24px;overflow-wrap:anywhere;word-break:break-word"><div style="font-size:12px;color:#64748b;margin-bottom:12px">RiskControl · Win100</div><h2 style="font-size:20px;line-height:1.5;margin:0 0 20px">${escapeHtml(title)}</h2><div style="font-size:15px;line-height:1.9">${body.replace(/\n/g, '<br>')}</div></div></body></html>`;
}
