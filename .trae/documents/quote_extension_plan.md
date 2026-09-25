# 行情扩展（5m/15m/1h/4h + 日线完整性 + 单标的行情分析优化）实现计划

## Repository Research（现状与根因）

### R0 永久约束（不改动）
- 仅一个标的（XMAX/AAPL，`LIVE_QUOTE_SETTINGS_KEY` 配置，默认 XMAX）
- fallback 顺序永久为 `NASDAQ_UNOFFICIAL → STOOQ → YAHOO_FINANCE`（YAHOO 中国大陆 sad-panda 403 已验证）
- lightweight-charts@4.21.0 原生 Canvas K 线（不复用 Recharts Bar）、CandlestickSeries + HistogramSeries 双图、VisibleLogicalRange 同步、crosshair 联动、ResizeObserver、setTimeout(220)+retry 180ms×3 mount、`clientWidth+Math.min(,1200)` 尺寸上限、`ColorType.Solid as const` 枚举、`candlesRef.current = candles` state→ref 同步 + mount 主动 setData 竞态修复 — 以上全部保留。

### R1 K线新增 5分钟/15分钟/1小时/4小时（用户需求 1）
- 当前 HISTORY_PERIOD_CONFIG 只有 8 个周期，`HistoryPeriod = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "MAX"`；1D 内部用 interval=5m，但周期选择按钮上没有独立 short-term。
- **数据源能力实机调研（2026/09/23 curl）**：
  | Provider | 5m / 15m / 1h / 4h Intraday 能力 | 中国大陆可用？ |
  |---|---|---|
  | NASDAQ_UNOFFICIAL `historical` | **只有日线**（tradesTable/rows 每日一行，无 intraday）| ✅ curl AAPL 2026-09-22 返回日K ×1 行 |
  | STOOQ `q/d/l/?i=5&d1=...&d2=...` CSV | **理论支持 i=5/15/60/240**，但 2026/09/23 curl 被 **JS challenge（SHA-256 PoW 验证）** 拦截，返回 796B HTML challenge 脚本，非 CSV | ⚠️ 机器直连失败，无法保证稳定 |
  | YAHOO_FINANCE `v8/finance/chart?range=5d&interval=5m` | **原生支持 1m/2m/5m/15m/30m/60m/90m/1h/1d** 等全套 intraday，但中国大陆 **403 sad-panda HTML 3369B** | ❌ 中国大陆直连失败，境外 IP 可用 |
- **Intraday 数据源结论（必须告知用户）**：三个免费源 **中国大陆机器均无法稳定提供 intraday**；唯一稳定方案是在 `fetchHistoryWithFallback` 增加「Nasdaq intraday 403 或 返回日线 < limit 时，用 STOOQ 带 JS challenge 客户端浏览器抓取（暂不实现）→ 本地 **OFFLINE 合成 fallback**：以 1D 的 OHLC + 随机游走为基础，合成 5m/15m/1h/4h 蜡烛（时间正确，价格围绕开收盘震荡，不偏离真实 high/low/volume 区间），渲染依然用 TradingView Canvas。
- **新增 4 个 intraday 周期定义**（合成 fallback 实现，待用户确认是否接受 OFFLINE 合成 intraday；或保留按钮但 3 源都失败时给出 Alert）。
- **K线周期按钮排序（前短后长，默认选中 1M 保持现状）**：`5分 | 15分 | 1小时 | 4小时 | 1日 | 5日 | 1月 | 3月 | 6月 | 1年 | 5年 | 全部` — 共 12 周期。

### R2 日线/5日/1月/3月 K线不全（用户需求 2）
- **1M 不全根因已定位**：`nasdaqHistory` 中的 `limit = Math.max(30, Math.min(10000, days))` —— 1月 days=30 → limit=**30**；但 Nasdaq tradesTable 周末/节假日自动跳过，30 个自然日只有 ~20-22 个交易日，limit=30 会截断到最近 30 行（只覆盖 30 个交易日 = 1.5 个月，自然日 1.5M 刚好不够满 1M）。
- **3M 不全根因同上**：days=90 → limit=**90** → Nasdaq 返回最近 90 个交易日 ≈ 4.5 个月自然日，但用户需要的是 **自然日 3 个月 = ~66 个交易日**，实际不缺？用户反馈的「3月 K线不全」更大概率是 **Stooq i=d CSV `&d1=20260623&d2=20260923`** 在当前机器会命中 JS challenge，Stooq fallback 失败，Nasdaq limit 又偏小 → 两者叠加导致样本点数比预期少；5日/1日同理（Nasdaq 周末/美股节假日常缺）。
- **修复方案**：
  1. `nasdaqHistory` 的 `limit` 从 `days` 改为 `days * 1.4 + 10`（多取 40%+10 的交易日冗余，避免节假日截断），再在返回 candles 时 `filter(time >= fromdate_ms)` 裁掉超限；
  2. **3 源 merge 合并（新功能）**：`fetchHistoryWithFallback` 不返回 first-success，而是「先拿 Nasdaq 成功，再用 Stooq 补 Nasdaq 缺失的日期」——按时间 UNION，**每一根 candle 优先保留 OHLC 都非空、体积更大的 provider**（防止 0/null 填充污染）。
  3. `stooqHistory` 遇到 JS challenge（首字节 `<` 为 HTML challenge）时 **立刻 throw 不截断**（不再当空 CSV 返回 0 根，让下一源 YAHOO 尝试，境外才会命中）。

### R3 行情分析版块（/market page.tsx）当前只有一个标的的现状与优化计划
**用户明确说「根据只有一个标的这一点进行一些优化，给我你的计划」—— 以下为 R3 的优化方案（不立即执行，审批后再做）**：

#### 当前 /market 问题（单标的 XMAX/AAPL 下的信息冗余 & 缺单标的深度）
1. **顶部 6 张 KPI 卡虽 OK，但右侧「搜索股票」「导出行情」2 按钮在单标的下无意义**（搜索永远只有一个结果，导出也只是单个 code）
2. **组合历史走势 + 机构资金曲线（360px ComposedChart）OK，保留，但卡片应嵌入单标的深度信息**
3. **「个股实时行情表」是 13 批次 × 同一 symbol 重复展示（sparkline 还是 `generateSparklineData` 随机假数据）**——单标的下 13 行相同代码完全浪费空间，应替换为「单标的机构深度看板」
4. **Provider Badge 仍显示 "Yahoo Finance 实时/盘前"**，实际 fallback 已改为 NASDAQ first，应修正为当前命中的 provider
5. **缺少 TradingView K 线大面板（单标的才值得放全屏）**——/market 应放一个常驻 480px K线（1M 默认，可调周期），不需要点击 TopBar badge 才弹 Dialog
6. **缺少标的关联的批次穿透聚合**：单标的 XMAX/AAPL → 多少批次、多少客户、击穿/预警/正常/盈利 四象限、所有批次 PnL 热力图等，这些是单标的特有的

#### R3 单标的优化布局（新）
```
/market 新布局（从上到下，单标的深度看板）：
A. Breadcrumb + 标题：「行情中心 / XMAX 单一标的深度」
   Badge：当前命中 provider（NASDAQ_UNOFFICIAL/STOOQ/OFFLINE）+ 市场开/休市
   按钮：<刷新行情>（保留）+ <打开K线弹窗>（复用 KLineDialog）
B. Hero Card — 单标的实时大卡：
   左列：Symbol + FlashNumber(价格) + 涨跌幅% + 开/高/低/量 + 最近更新时间
   右列：12 周期切换 Button Group + 480px TradingView Canvas（K线+成交量，复用 KLineDialog 逻辑提取为 <InlineKLine symbol={symbol} defaultPeriod="1M"/>）
C. 组合走势 + 机构资金曲线（原 Card，保留，宽度不变）
D. 机构风险敞口月度分布 + 风险分布（原 3 列 grid，保留）
E. 新：单标的 × 批次关联热力条（12 批次，4 行 × 3 列）：
   每张卡：批次编号 / 初始AUM / 当前MV / drop% 进度条 / 机构PnL / 客户数 / 风险 Badge
   （替代原「个股实时行情表」13 行重复 symbol）
```

---

## Files and Modules（要改的文件）
| File | 改动内容 |
|---|---|
| [src/lib/quote/providers.ts](file:///Users/evan/Desktop/%E6%8A%80%E6%9C%AF/risk%20control/src/lib/quote/providers.ts#L1-L324) | ① HistoryPeriod 新增 `"5M"|"15M"|"1H"|"4H"`；② HISTORY_PERIOD_CONFIG 新增 4 条（range 对应 5d/5d/20d/60d，interval 5m/15m/60m/240m）；③ nasdaqHistory limit ×1.4+10 + 末尾 filter(time ≥ fromdate_ms)；④ stooqHistory 识别 `<DOCTYPE` 开头即 throw；⑤ fetchHistoryWithFallback 新增 3 源 candle UNION merge（非 first-success，缺失日期互相补齐）；⑥ intraday 3 源全部失败时：**合成 fallback 函数 `synthesizeIntradayCandles(period, dailyCandles)`** 用最近 1D/5D 的 OHLCV 加随机游走合成 5m/15m/1h/4h（volume 按比例分配） |
| [src/components/quote/KLineDialog.tsx](file:///Users/evan/Desktop/%E6%8A%80%E6%9C%AF/risk%20control/src/components/quote/KLineDialog.tsx#L1-L580) | ① 周期按钮从 8 个扩到 12 个；② `formatTimeLabel` 新增 intraday 格式（`MM/DD HH:mm` 不显示日期当同日、显示日期当跨日）；③ 若 candles 来自合成 fallback，summary 卡片右上角加 `模拟` Badge；④ **抽取共用逻辑 Hook `useKLineChartData(symbol, period)`** → 返回 candles/provider/isLoading/error，供 InlineKLine 复用（不重复写 setData/sync/fitContent 400 行） |
| [src/components/quote/InlineKLine.tsx](file:///Users/evan/Desktop/%E6%8A%80%E6%9C%AF/risk%20control/src/components/quote/InlineKLine.tsx)（**新建，仅当审批后创建**） | 复用 `useKLineChartData` Hook + lightweight-charts@4 480px/360px 双 Canvas；无 Radix Dialog 因此 **不需要 setTimeout(220)**，直接 `useLayoutEffect` + ResizeObserver mount；供 /market Hero Card 右侧调用 |
| [src/app/market/page.tsx](file:///Users/evan/Desktop/%E6%8A%80%E6%9C%AF/risk%20control/src/app/market/page.tsx#L150-L1039) | ① 读 `getLiveQuoteSettings().symbol` 作为唯一 symbol；② 删除 `Search`/`Download` 按钮；③ Provider Badge 用当前 `/api/quote/realtime` 返回的 provider；④ Hero Card 新增 InlineKLine（480px）；⑤ 删除「个股实时行情表」批量重复 13 行，改为 E 区 12 批次 × 单标的关联热力条卡；⑥ `stockHistory` 当前未使用 → 删除 useMemo；⑦ sparkline 不再 `generateSparklineData` 随机，改为 真实 30 根 history candles 渲染 |
| [src/lib/liveQuote.ts](file:///Users/evan/Desktop/%E6%8A%80%E6%9C%AF/risk%20control/src/lib/liveQuote.ts#L1-L141) | （可选）新增 `getSingleSymbol(): string` 辅助函数，统一 /market /TopBar /settings 取 symbol 口径，避免三处分叉写默认值 |

---

## Implementation Steps（依赖顺序执行步骤）
### Phase 1 — 历史数据基础（providers.ts，不碰 UI）
1. `HistoryPeriod` 类型加 `"5M"|"15M"|"1H"|"4H"`；`HISTORY_PERIOD_CONFIG` 对应 4 条（range=5d/5d/20d/60d，interval=5m/15m/60m/240m）；`yahooRangeInterval`、`stooqHistory` 中的 switch 补齐 4 个新周期。
2. `nasdaqHistory`: `limit = Math.max(30, Math.floor(days*1.4) + 10)`；fetch 后在 `rows.map` 后加 `.filter(c => c.time >= Date.now() - days*86400_000)` 剔除超限；
3. `stooqHistory`: `text.slice(0, 50).startsWith('<!DO')` → 立刻 throw（避免 796B challenge 当成空 CSV 返回 0 根）；
4. 新增 `mergeCandlesByTime(list: HistoryCandle[][])` 工具：按时间 key UNION；同一时间多源时选 OHLC 全非空且 volume 大者；
5. `fetchHistoryWithFallback`: 不 first-success return，改为 chain 全部尝试，收集非空 candles[] 数组 → `mergeCandlesByTime(成功列表)` → 返回；若全部失败再 throw lastError；
6. 新增 `synthesizeIntradayCandles(period, fallbackDaily: HistoryCandle[])`：
   - 5M/15M：用最近 1D（若成功）的 O/H/L/C/V，按 intraday 步长生成，价格在 O→H→C→L→C 路径上叠加 ±0.12%*volatility 的随机游走，volume 均匀分配；
   - 1H/4H：同理，用 5D/20D 的真实日K合成，保证日内不突破真实 high/low 边界；
7. intraday 周期 3 源 merge 后长度不足阈值（5M<30 根、1H<10 根）时，调用合成 fallback 补齐，并在返回加 `provider: "SYNTHETIC_INTRADAY"` 标记（UI 显示「模拟」Badge）。

### Phase 2 — KLineDialog 12 周期 + Hook 抽取
8. KLineDialog.tsx：按钮从 `Object.keys(HISTORY_PERIOD_CONFIG)` 自动渲染，顺序改为 intraday 在前；周期初始选中 `"1M"`（保持不变，让用户自己切短周期）。
9. `formatTimeLabel`：新增当 period ∈ 4 个 intraday → `MM/DD HH:mm`，同日只一次显日期；
10. 新增 `useKLineChartData(symbol, period)` Hook 到 KLineDialog.tsx（先内联，Phase 3 再导出）：负责 fetch → setCandles + candlesRef 同步 + loading/error，后续 InlineKLine 共用；
11. summary 卡右上角：如果 provider == "SYNTHETIC_INTRADAY" → 加 `<Badge variant="outline">模拟</Badge>`；

### Phase 3 — /market 单标的深度看板改造
12. 创建 [src/components/quote/InlineKLine.tsx](file:///Users/evan/Desktop/%E6%8A%80%E6%9C%AF/risk%20control/src/components/quote/InlineKLine.tsx)：高度 prop `chartHeight`，复用 useKLineChartData + lightweight-charts@4；**直接 useLayoutEffect mount（无 Dialog → 不用 setTimeout 220ms）**；ResizeObserver + 1200 宽度上限保留；
13. market/page.tsx：顶部删 `Search`/`Download` 按钮，Provider Badge 改为显示 liveQuote 返回的 provider；Hero Card 左 40% 放 Symbol 实时大卡，右 60% 放 InlineKLine(480px)；
14. 原「个股实时行情表」区块：替换为 12 批次 × 单标的关联热力条（grid-cols-1 md:grid-cols-2 xl:grid-cols-3，每个 BatchCardV2 简化版，显示批次编号 / AUM / MV / drop 进度条 / 机构PnL / 风险 Badge）。

### Phase 4 — 验证
15. `npx tsc --noEmit` strict exit=0；
16. curl 校验：`/api/quote/history?symbol=AAPL&period=5M` 返回 candles ≥30，provider 正确；`period=1M` 返回 candles ≥22（自然日 30 ≈ 22 交易日）；
17. 浏览器实机：/market 硬刷新 → InlineKLine canvas≥1（K线）/≥1（成交量）；切 5M/15M → 显示「模拟」Badge、周期切换 summary 样本点数字正确、K线数量增加；
18. 原 TopBar badge → KLineDialog 功能回归（避免改 /market 时破坏原弹框）。

---

## Dependencies and Considerations（关键依赖 & 取舍）
| 项 | 说明 |
|---|---|
| **intraday 数据源取舍** | 中国大陆机器 NASDAQ/Stooq/YAHOO 三者对 intraday **均不稳定**（分别为「只有日线」、「JS challenge」、「403」）。**必须用 OFFLINE 合成 + 「模拟」Badge 明示**，不欺瞒使用者；若用户坚持必须真实 intraday，需接入 Polygon/Alpha Vantage（需 API Key，不在本轮免费范围内）。 |
| **lightweight-charts@4 保持** | 不升级 v5（enum/API 不兼容，之前已踩坑回退） |
| **单标的 UI 不影响多标的未来扩展** | 所有 Hero/热力条组件都接受 `symbol` prop，未来 symbol 放开时最小改动 |
| **Provider Badge 一致性** | /market、/settings、TopBar、KLineDialog 4 处统一用 realtime/history 返回的真实 provider，不再硬写 "Yahoo Finance" |
| **`mergeCandlesByTime` 幂等** | 每根 candle 的 O/H/L/C 边界必须保证 `H = max(...sources.high)`, `L = min(...sources.low)`, `O = 最早源 open`, `C = 最新源 close`，避免多源 merge 产生 `low > high` 非法蜡烛 |

---

## Validation（验证项，每项都要实机断言）
1. **TS strict**: `npx tsc --noEmit` exit=0；
2. **curl API**:
   - `AAPL&period=1M` → candles ≥ 22，merge 后比之前多（修复「1月不全」）；
   - `AAPL&period=3M` → candles ≥ 63；
   - `AAPL&period=5M` → candles ≥ 30，provider 可能为 `SYNTHETIC_INTRADAY`；
3. **/market DOM**:
   - Hero Card InlineKLine: kline canvas≥1, volume canvas≥1；
   - 周期按钮数 = 12；
   - 切 5M → summary 右上角有「模拟」Badge，样本点≥30；
4. **回归**: 点击 TopBar Badge → KLineDialog 弹 → canvas 正常渲染、周期可切；
5. **无 React Error Overlay**: console 无 syntax/runtime error。

---

## Risks & Fallback（风险与兜底）
| 风险 | 处理 |
|---|---|
| `mergeCandlesByTime` 同一时间点多源 high 冲突导致 O>H 或 L<C | merge 时兜底修正：`O = clamp(O, min(L,L2), max(H,H2))`，`C = clamp(C, L, H)`，保证几何合法 |
| InlineKLine mount 仍黑屏（/market 非 portal，但可能 SSR hydration 延迟）| 保持与 KLineDialog 相同的 retry 策略（clientWidth≥32 每 180ms 检查 3 次） |
| 用户不接受「模拟」Intraday Badge | 提供 fallback 文案：「当前网络环境下无 intraday 免费源，切换周期为 1M+ 查看真实日线」+ settings 页面顶部提示 |
| synthetic 生成蜡烛过多导致 canvas 卡顿（5M 5 天约 390 根）| lightweight-charts@4 4k 根仍流畅，无风险，但超 5000 根时 `fitContent` 前按时间均匀降采样（预留裁剪逻辑） |

---

## 待用户审批的 YES/NO 3 个关键决策（**必须回答后才进入 Phase 1 代码修改**）
1. **Q1**: intraday 5M/15M/1H/4H 因中国大陆 3 免费源均不提供，是否接受「SYNTHETIC_INTRADAY 合成 + UI 显示模拟 Badge」方案？（Y/N，N 的话本轮只保留日线 8 周期 + 修复日线补齐 merge）
2. **Q2**: /market 「个股实时行情表」13 行同一 symbol 冗余，按 R3 方案替换为 12 批次 × 单标的关联热力条卡片？（Y/N）
3. **Q3**: 在 /market Hero 卡右侧新增 480px InlineKLine 常驻 TradingView Canvas 大面板？（Y/N，N 的话仅保留原 TopBar 弹 Dialog 的方式）
