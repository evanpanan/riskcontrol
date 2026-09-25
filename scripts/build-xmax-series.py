#!/usr/bin/env python3
import json, sys
from collections import defaultdict
with open(sys.argv[1]) as f:
    d = json.load(f)
candles = d['candles']
lines = []
lines.append("// XMAX 过去半年真实日线收盘价 (Nasdaq Unofficial source, captured 2026-09-24)")
lines.append("// 用于构造过去半年批次的真实 signDate -> stockPriceAtStart 映射，保证收益率符合真实行情")
lines.append("// 数组每项: [日期ISO字符串, 当日Close]")
lines.append("export const XMAX_HALF_YEAR_PRICE_SERIES: Array<[string, number]> = [")
for x in candles:
    lines.append(f"  [\"{x['date']}\", {x['close']:.3f}],")
lines.append("];")
lines.append("")

per_month = defaultdict(list)
for x in candles:
    per_month[x['date'][:7]].append(x)

lines.append("// 每月4个批次签约日: 每月均匀取4个交易日，分布于月初/月中/月尾")
lines.append("// 保证过去半年(2026-03 ~ 2026-08)共24个批次")
lines.append("export const RECOMMENDED_BATCH_SIGN_DATES: string[] = [")
months_sorted = sorted([m for m in per_month if '2026-03' <= m <= '2026-08'])
for m in months_sorted:
    cs = per_month[m]
    # 取 0, 1/4, 1/2, 3/4 位置
    picks = []
    for frac in [0.0, 0.28, 0.56, 0.82]:
        idx = min(len(cs)-1, int(frac * len(cs) + 0.5))
        if idx not in picks:
            picks.append(idx)
    while len(picks) < 4:
        for i in range(len(cs)):
            if i not in picks:
                picks.append(i); break
        picks.sort()
    for i in picks[:4]:
        lines.append(f"  \"{cs[i]['date']}\",  // {m} Close=${cs[i]['close']:.2f}")
lines.append("];")
lines.append("")
lines.append("// 当前 XMAX 最新收盘价 (9月22日快照，用于所有批次的 currentStockPrice)")
latest_close = candles[-1]['close']
lines.append(f"export const XMAX_CURRENT_LIVE_PRICE: number = {latest_close:.3f}; // as of {candles[-1]['date']}")
lines.append("")
with open(sys.argv[2], 'w') as f:
    f.write("\n".join(lines) + "\n")
print(f"Wrote {len(candles)} candles, {len(months_sorted)} months x 4 = {len(months_sorted)*4} batches, latest close={latest_close:.3f}")
