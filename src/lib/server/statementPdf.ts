import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { createFont } from "fonteditor-core";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MonthlyStatementReport } from "@/lib/monthlyStatement";
let fontBytes: Promise<Buffer> | undefined;
const money = (n: number) =>
  "$" +
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const qty = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 6 });
export async function renderStatementPdf(report: MonthlyStatementReport) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  fontBytes ??= readFile(
    path.join(process.cwd(), "assets/fonts/NotoSansSC-Regular.ttf"),
  );
  const originalFont = await fontBytes;
  const measurement = (fontkit as any).create(originalFont);
  const width = (value: string, size: number) =>
    (measurement
      .layout(value)
      .glyphs.reduce(
        (sum: number, g: { advanceWidth: number }) => sum + g.advanceWidth,
        0,
      ) *
      size) /
    measurement.unitsPerEm;
  const runs: Array<{
    page: PDFPage;
    value: string;
    x: number;
    y: number;
    size: number;
    color: ReturnType<typeof rgb>;
  }> = [];
  const logo = await doc.embedPng(
    await readFile(path.join(process.cwd(), "public/win100.png")),
  );
  const ink = rgb(0.11, 0.15, 0.22),
    muted = rgb(0.4, 0.45, 0.52),
    line = rgb(0.86, 0.88, 0.91),
    gold = rgb(0.62, 0.49, 0.24);
  let page!: PDFPage;
  let y = 0;
  const text = (
    value: string,
    x: number,
    top: number,
    size = 10,
    color = ink,
  ) => runs.push({ page, value, x, y: top, size, color });
  const wrap = (value: string, maxWidth: number, size = 9) => {
    const lines: string[] = [];
    let current = "";
    for (const ch of value) {
      if (current && width(current + ch, size) > maxWidth) {
        lines.push(current);
        current = ch;
      } else current += ch;
    }
    if (current) lines.push(current);
    return lines;
  };
  const newPage = () => {
    page = doc.addPage([595.28, 841.89]);
    y = 785;
    page.drawImage(logo, { x: 40, y: 777, width: 32, height: 32 });
    text("RiskControl", 83, 795, 18, gold);
    text("Win100 客户月结单", 83, 779, 10, muted);
    text(report.month, 466, 791, 14);
    page.drawLine({
      start: { x: 40, y: 760 },
      end: { x: 555, y: 760 },
      color: line,
      thickness: 1,
    });
    y = 735;
  };
  const ensure = (height: number) => {
    if (y - height < 65) newPage();
  };
  const heading = (title: string) => {
    ensure(35);
    text(title, 40, y, 12);
    y -= 22;
  };
  newPage();
  const nameLines = wrap(report.customerName, 360, 15);
  for (const row of nameLines) {
    ensure(25);
    text(row, 40, y, 15);
    y -= 22;
  }
  text(`账期 ${report.start} 至 ${report.end}`, 40, y, 9, muted);
  y -= 18;
  for (const row of wrap(
    `商务经理：${report.bdManager || "未分配"}  |  月末估值日：${report.closingDate}`,
    510,
  )) {
    text(row, 40, y, 9, muted);
    y -= 15;
  }
  y -= 12;
  const metrics: Array<[string, number]> = [
    ["月初权益", report.openingEquity],
    ["月末权益", report.closingEquity],
    ["本月入金", report.deposits],
    ["本月退出回款", report.withdrawals],
    ["本月净损益", report.monthlyPnL],
    ["累计净损益", report.cumulativePnL],
  ];
  for (let i = 0; i < metrics.length; i += 2) {
    ensure(60);
    for (let j = 0; j < 2; j++) {
      const x = 40 + j * 263;
      page.drawRectangle({
        x,
        y: y - 49,
        width: 252,
        height: 55,
        color: rgb(0.96, 0.97, 0.98),
        borderColor: line,
        borderWidth: 0.5,
      });
      text(metrics[i + j][0], x + 12, y - 13, 9, muted);
      text(money(metrics[i + j][1]), x + 12, y - 36, 15);
    }
    y -= 65;
  }
  y -= 8;
  heading("仓位与收益明细");
  for (const p of report.positions) {
    const titleLines = wrap(
      `${p.batchNumber}  /  ${p.symbol}  /  ${p.status}`,
      490,
      10,
    );
    const fields = [
      ["客户编号", p.clientNo || "-"],
      ["签约日期", p.signDate],
      ["客户本金", money(p.investment)],
      ["客户股数", qty(p.shares)],
      ["入场价格", `$${p.entryPrice.toFixed(4)}`],
      ["估值价格", `$${p.closePrice.toFixed(4)}`],
      ["股票市值", money(p.stockValue)],
      ["预计结算权益", money(p.equity)],
      ["客户净损益", money(p.pnl)],
      ["客户分成比例", `${p.clientSplit}%`],
      ["机构分成比例", `${p.institutionSplit}%`],
      ["机构担保本金", money(p.institutionCapital)],
      ["机构初始股数", qty(p.institutionShares)],
      ["机构股票补仓", qty(p.institutionTopupShares) + " 股"],
      ["机构现金补仓", money(p.institutionTopupCash)],
      ["账户总股数", qty(p.accountShares)],
      ["账户总市值", money(p.accountValue)],
      ["估值日期", p.valuationDate],
    ];
    const height =
      titleLines.length * 16 + Math.ceil(fields.length / 3) * 28 + 18;
    ensure(height + 12);
    page.drawRectangle({
      x: 40,
      y: y - height,
      width: 515,
      height,
      borderColor: line,
      borderWidth: 0.6,
    });
    let rowY = y - 17;
    for (const title of titleLines) {
      text(title, 51, rowY, 10);
      rowY -= 16;
    }
    fields.forEach(([label, value], index) => {
      const x = 51 + (index % 3) * 170;
      const top = rowY - Math.floor(index / 3) * 28;
      text(label, x, top - 7, 8, muted);
      wrap(value, 155, 9).forEach((v, k) => text(v, x, top - 21 - k * 12, 9));
    });
    y -= height + 14;
  }
  if (report.events.length) {
    heading("本月资金与补仓记录");
    for (const e of report.events) {
      const lines = wrap(
        `${e.date}  ${e.batchNumber}  ${e.type}  ${money(e.amount)}${e.shares ? ` / ${qty(e.shares)} 股` : ""}${e.price ? ` / 单价 $${e.price.toFixed(4)}` : ""}  归属：${e.owner}`,
        495,
        9,
      );
      ensure(lines.length * 15 + 13);
      for (const row of lines) {
        text(row, 48, y, 9);
        y -= 15;
      }
      y -= 10;
    }
  }
  const notes = [
    "说明：金额以 USD 计。月初／月末按对应交易日真实收盘价及当时有效仓位计算。",
    "客户预计结算权益按签约分成及保本规则计算，与股票市值不同，最终以实际结算为准。",
    "WIN100 补仓为机构劣后资金，本金与收益归机构，不计入客户入金或个人股数。",
    "本月净损益 = 月末权益 + 本月退出回款 - 月初权益 - 本月入金；退出回款已扣实际费用。",
  ];
  ensure(90);
  y -= 6;
  for (const note of notes)
    for (const row of wrap(note, 515, 8)) {
      text(row, 40, y, 8, muted);
      y -= 13;
    }
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: 40, y: 44 },
      end: { x: 555, y: 44 },
      color: line,
      thickness: 0.5,
    });
    runs.push({
      page: p,
      value: `RiskControl / Win100                                      ${report.month}                         ${i + 1} / ${pages.length}`,
      x: 40,
      y: 29,
      size: 8,
      color: muted,
    });
  });
  // Subset a complete Unicode cmap before embedding. This preserves CJK/composite
  // glyphs that the PDF library's incremental subsetter can otherwise omit.
  const codepoints = [
    ...new Set(
      runs.flatMap((run) =>
        Array.from(run.value).map((c) => c.codePointAt(0)!),
      ),
    ),
  ];
  const subset = createFont(originalFont, {
    type: "ttf",
    subset: codepoints,
    hinting: false,
    compound2simple: true,
  }).write({ type: "ttf", toBuffer: true });
  const font = await doc.embedFont(subset, { subset: false });
  for (const run of runs)
    run.page.drawText(run.value, {
      x: run.x,
      y: run.y,
      size: run.size,
      color: run.color,
      font,
    });
  doc.setTitle(`${report.customerName} ${report.month} 月结单`);
  doc.setAuthor("Win100 / RiskControl");
  return Buffer.from(await doc.save());
}
