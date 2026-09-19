<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=minimalist%20modern%20abstract%20logo%20shield%20icon%20with%20trendline%20up%20in%20the%20middle%20financial%20risk%20control%20dashboard%20dark%20deep%20navy%20blue%20background%20with%20gold%20accent%20clean%20vector%20tech&image_size=square">
    <img alt="RiskControl Logo" src="https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=minimalist%20modern%20abstract%20logo%20shield%20icon%20with%20trendline%20up%20in%20the%20middle%20financial%20risk%20control%20dashboard%20deep%20navy%20blue%20accent%20teal%20clean%20vector&image_size=square" width="128" height="128" />
  </picture>

  <h1 align="center">RiskControl v2.1 · 优先劣后股票产品全景风控预警系统</h1>
  <p align="center">
    <strong>机构老板视角的股票结构化产品风控大盘</strong>
    <br />
    风险阶梯可视化 · 劣后资金池监控 · 实时股价联动 · 网页端击穿弹窗预警 · 金额跃动动效
  </p>
  <p align="center">
    <a href="#features">功能特性</a> ·
    <a href="#architecture">技术栈</a> ·
    <a href="#quick-start">5 分钟快速启动</a> ·
    <a href="#rbac">账号权限体系</a> ·
    <a href="#mock-data">数据与行情</a>
  </p>

  <p align="center">
    <img alt="Next.js 14 App Router" src="https://img.shields.io/badge/Next.js-14.2.8-black?logo=next.js&logoColor=white" />
    <img alt="TypeScript Strict" src="https://img.shields.io/badge/TypeScript-5.5_strict-blue?logo=typescript&logoColor=white" />
    <img alt="Tailwind 3.4" src="https://img.shields.io/badge/Tailwind_CSS-3.4-38B2AC?logo=tailwindcss&logoColor=white" />
    <img alt="Prisma 5" src="https://img.shields.io/badge/Prisma-5.22-2D3748?logo=prisma&logoColor=white" />
    <img alt="Status: Production Ready" src="https://img.shields.io/badge/Status-Production_Ready-22C55E" />
    <img alt="License: Private" src="https://img.shields.io/badge/License-Internal-8B5CF6" />
  </p>
</div>

---

## ✨ Features <a id="features"></a>

### 🧭 风控大盘（首页）
- **4 色风险阶梯条**：击穿红 / 预警黄 / 正常蓝 / 盈利绿，点击分段直接跳转到对应风险批次
- **批次卡等高自适应**：8 批次统一高度，呼吸边框（CRITCAL 红呼吸 / WARNING 黄呼吸）
- **风险批次实时弹窗**：新出现预警/击穿批次会以 `Dialog` 形式弹出，支持「已知晓」(ACK 30 分钟冷却)、「查看批次」、「全部知晓」、「处理击穿批次」
- **补仓分摊按投资额**：每个客户级补仓金额按其初始投入等比分配，自动计算回收率
- **客户独立退出**：批次内单个客户可独立退出，其他客户不受影响；批次内客户全部退出后批次灰卡归档
- **双筛选 Tab**：月份 Tab（全部月份 + 每月 1 批）+ 股票 Tab（全部股票 + 8 支股票）

### 📈 机构老板版行情中心（/market）
**6 张核心 KPI**（机构视角，老板 3 秒看全）：
| KPI | 说明 |
|-----|------|
| AUM 总规模 | 优（客户优先）/ 劣（机构劣后）双拆分 |
| 机构累计注入 | 劣后本金 + 累计补仓 |
| 待回收补仓 | 击穿补仓未回收部分，风险敞口核心指标 |
| 机构收益率 | 机构绝对 PnL + 收益率百分比（带色） |
| 客户收益率 | 78 位客户整体收益率（8 批次） |
| 最大敞口 / 批次 | 单批次最大补仓金额 + 击穿 2 / 预警 2 |

**组合 + 机构资金双曲线（ComposedChart 4 层叠）**：
- 组合总市值（蓝面积）+ 机构劣后资金池（紫面积）+ 机构累计补仓（橙虚线）+ 机构单期 PnL（绿/红 Bar 右轴），带初始 AUM 线 & 补仓预警线

**3 个辅助分析模块**：
- 机构风险敞口 & 补仓执行月度 Stacked Bar（12 个月）
- 按风险分布 4 段市值权重 progress（击穿/预警/正常/盈利）
- 个股实时行情表（8 支标的）：30 日 sparkline + 机构 PnL + 补仓金额 + 风险 Badge + 批次详情跳转

### ⚠️ 风险预警 & 通知
- **4 档开关（设置页）**：网页弹窗总开关 / 击穿提示音（AudioContext 520→420Hz）/ 仅击穿不弹预警 / 实时股价联动
- **ACK 30 分钟冷却**：用户「已知晓」后写 `localStorage risk_control_alert_ack_v1`，30 分钟内不重复打扰
- **通知渠道**：Email Webhook + WhatsApp Business Webhook + 风控收件人管理（8 位，可增删改）
- **审计日志**：登录、修改阈值、新增账号、编辑客户、补仓、退出 6 动作持久化

### 🎞 金额跃动 + 实时联动
- **FlashNumber 首次挂载**：0 → 目标值 requestAnimationFrame 60fps 补间，`easeOutExpo` 曲线，400–1400ms 自适应金额规模
- **值变更闪烁**：上涨时 `animate-flash-up`（绿背景高亮），下跌时 `animate-flash-down`（红）
- **NYSE 开盘判定**：`isMarketOpenNow()` 使用 `Intl.DateTimeFormat('America/New_York')` 精确判定工作日 9:30–16:00
- **实时 tick 热更新**：从设置读 `realtimeTickIntervalSec`（夹紧 [2, 120] 秒），`refreshMockDataPrices()` 突变 mock 单例触发重渲染
- **StrictMode 兼容**：修复 React 18 Strict 开发模式 mount/unmount 双调用下 FlashNumber 动画卡在 0 的 bug

---

## 🏗 Architecture <a id="architecture"></a>

```
risk-control/
├── src/
│   ├── app/                       # Next.js 14 App Router
│   │   ├── layout.tsx             # AuthProvider + Sidebar Layout (hsl(224 55% 6%) 深蓝暗主题)
│   │   ├── page.tsx               # / 风控大盘：6 KPI + 阶梯条 + 8 批次卡 + RiskAlertDialog
│   │   ├── market/page.tsx        # /market 机构版行情：6 KPI + 双曲线 + 月度敞口 + 个股表
│   │   ├── alerts/page.tsx        # /alerts 风险警报中心 + 通知日志
│   │   ├── clients/page.tsx       # /clients 客户名录 + BD 分配 + 退出管理
│   │   ├── margin/page.tsx        # /margin 补仓历史 & 执行跟踪
│   │   ├── settings/page.tsx      # /settings 阈值、预警开关、通知渠道、收件人、数据源
│   │   └── batch/[id]/page.tsx    # 批次详情：客户级补仓分摊 + 单客户退出流转
│   │
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── RiskLadderBar.tsx  # 4 色阶梯条（盈利段占位算法 2.0 严格 100%）
│   │   │   ├── BatchCardV2.tsx    # 批次卡（呼吸边框 + FlashNumber KPI x 8）
│   │   │   ├── BatchControlPanel.tsx # 月份 Tab + 股票 Tab
│   │   │   └── RiskAlertDialog.tsx # ⭐ 风险批次弹窗（击穿红呼吸 + 预警黄）
│   │   ├── batch/
│   │   │   └── BatchDetailContent.tsx # 客户 Tab 级补仓分摊 / 退出
│   │   ├── clients/ClientTable.tsx
│   │   └── ui/
│   │       ├── FlashNumber.tsx    # ⭐ animateOnMount + easeOutExpo 金额跃动
│   │       ├── Card / Button / Badge / Tabs / Tooltip / Dialog / Table / Input / Label / Select / DropdownMenu (Shadcn 风格)
│   │       └── auth/              # AuthProvider / AuthGuard / RoleGuard
│   │
│   ├── lib/
│   │   ├── riskEngine.ts          # 核心风控：drop%、补仓额、PnL 客户/机构拆分、组合 Summary
│   │   ├── mockData.ts            # 8 批 78 客户 4 股票 4 BD 经理（refreshMockDataPrices tick）
│   │   ├── riskRecipients.ts      # 风控收件人运行时存储（+LS）
│   │   ├── clientStatusStore.ts   # 客户退出状态（LS + storage 事件）
│   │   ├── webAlertSettings.ts    # ⭐ 5 字段开关 + ACK 持久化
│   │   ├── stockFetcher.ts        # Yahoo Finance / Finnhub 适配器（环境变量 Key）
│   │   ├── auth/                  # mockProvider / supabaseProvider / authContext / useAuth + RBAC dataScope
│   │   ├── prisma.ts
│   │   ├── notifier.ts
│   │   └── utils.ts (cn / formatCurrency / formatPercent / formatCompactNumber)
│   │
│   └── types/auth.ts
│
├── prisma/
│   ├── schema.prisma              # enum AppRole(Admin/Risk/BD) + AppUser + Session + Client + Batch + MarginCallHistory + AuditLog
│   └── seed.ts                    # 5 个种子账号（管理员 / 风控 / 4 BD经理）
│
├── test_datascope_rbac.ts         # RBAC dataScope 验收脚本（55 assertions, 10/10 子测试）
├── .env.example                   # DATABASE_URL + Supabase + Stock API + Webhooks
├── tailwind.config.ts             # --background 224 55% 6% 深蓝暗主题 + 15+ 自定义 keyframes
├── next.config.js · tsconfig.json (strict true) · postcss.config.js
└── package.json
```

### 技术栈一览

| 层级 | 选型 | 版本 |
|------|------|------|
| 框架 | Next.js App Router | 14.2.8 |
| 语言 | TypeScript Strict Mode | 5.5.4 |
| 样式 | Tailwind CSS + Tailwind Animate + CVA | 3.4.10 |
| UI 组件 | Radix UI（Dialog / Tabs / Tooltip / Select / Dropdown）+ Shadcn 手写组件 | 最新 |
| 图表 | Recharts (AreaChart / LineChart / BarChart / ComposedChart) | 2.12.7 |
| ORM & 数据库 | Prisma + PostgreSQL / Supabase | 5.18 |
| 鉴权 & RBAC | 自研 AppRole 三档 + Mock/Supabase 双 Provider | — |
| Toast | Sonner 2 | — |
| 图标 | Lucide React 439 | — |
| 日期 | date-fns 3 | — |

### 🎨 主题色（金融深蓝暗模式）
```
--background:   hsl(224 55% 6%)     /* 深空蓝 */
--card:         hsl(224 45% 9%)     /* 卡片底 */
--primary:      hsl(217 91% 60%)    /* 主色调：机构蓝 */
--success:      hsl(142 76% 36%)    /* 盈利：深绿 */
--warning:      hsl(38 92% 50%)     /* 预警：琥珀金 */
--danger:       hsl(0 63% 45%)      /* 击穿：警示红 */
```
关键帧动画库已内置：`animate-breath-danger` / `animate-breath-warning` / `animate-flash-up` / `animate-flash-down` / `animate-pulse-green` / `animate-card-crit` / `animate-card-warn`

---

## 🚀 5 分钟快速启动 <a id="quick-start"></a>

> 系统 **开箱即用**：默认走 Mock 数据 + Mock 鉴权 Provider，不需要任何真实数据库或 API Key 就能看到完整界面。

### 1. 克隆 & 安装

```bash
git clone https://github.com/evanpanan/riskcontrol.git
cd riskcontrol
npm install          # 约 495 个依赖，2–4 分钟
```

### 2. （可选）配置环境变量

如果你要连接 **真实数据库 / Supabase / 股票 API / Webhook**，复制 [`.env.example`](.env.example)：

```bash
cp .env.example .env.local
# 然后编辑：
#   DATABASE_URL               PostgreSQL 连接串
#   NEXT_PUBLIC_SUPABASE_URL   Supabase Project URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY
#   NEXT_PUBLIC_STOCK_API_KEY  Yahoo Finance / Finnhub
#   EMAIL_WEBHOOK_URL + WHATSAPP_WEBHOOK_URL
```

> **演示模式无需配置**：未设 `NEXT_PUBLIC_AUTH_PROVIDER=supabase` 时自动走 Mock Provider。

### 3. （可选）初始化数据库 + 种子

```bash
npx prisma db push       # Schema 同步到 PostgreSQL
npx prisma db seed       # 写入 5 个种子账号 + Mock Auth (可选，演示模式可跳过)
npx tsx test_datascope_rbac.ts   # 运行 RBAC 验收脚本，期望 10/10 PASS
```

### 4. 启动开发服务器

```bash
node node_modules/next/dist/bin/next dev -p 3002
# 浏览器访问 → http://localhost:3002
```

### 5. 演示账号（Mock Provider 自动登录）

| 角色 | 账号 | 邮箱 | 说明 |
|------|------|------|------|
| Admin 管理员 | Evan Pan | evan.pan@institution.com | 风控总监，dataScope 看全部数据 |
| Risk 风控 | Michael Chen | michael.chen@institution.com | 风控主管 |
| Risk 风控 | Sarah Wu | sarah.wu@bd-team.com | 风控分析师 |
| BD 经理 × 4 | 李晓明 / 王思远 / 张志强 / 刘佳 | 见 BD_MANAGERS | dataScope 仅看自己客户 |

### 6. 生产构建 & 启动

```bash
npm run build            # ✅ 9 routes all (Static / Prerender / Dynamic)
npm run start -p 3002
```

---

## 🔐 RBAC 权限体系 <a id="rbac"></a>

### 三档角色 `enum AppRole`
```prisma
enum AppRole {
  ADMIN        // 全量：看所有客户 / 所有批次 / 改阈值 / 增删账号 / 管理收件人
  RISK_MANAGER // 看所有批次但不能改阈值、不能增删账号
  BD_MANAGER   // 仅看自己名下客户 + 对应批次；不能操作任何系统设置
}
```

### 权限守卫（两层）

| 守卫层 | 组件 | 作用 |
|--------|------|------|
| 路由守卫 | `<AuthGuard requiredRole={ADMIN}>` | 包裹页面 Layout，未登录跳转登录，无权限 403 |
| UI 守卫 | `<RoleGate allowedRoles={[ADMIN, RISK_MANAGER]}>` | 包裹按钮/卡片，无权限时不渲染或置灰 |
| 数据层过滤 | `filterClientsByRole / filterBatchesByRole / summarizeByScope / filterAuditLogsByScope` | 从**数据源头**隔离，避免越权 |

> 测试脚本 [test_datascope_rbac.ts](test_datascope_rbac.ts) 覆盖 10 场景（Admin 全量、BD 仅自己、跨 BD 不可见、Audit BD 仅自己、summary 聚合自己、Supabase env 切换、Mock 用户注入、空客户过滤、4 BD 互斥、组合汇总匹配）共 **55 个 assertions 100% PASS**。

---

## 📊 Mock 数据与实时行情 <a id="mock-data"></a>

### 内置数据规模
- **批次 × 8**：覆盖 2024/12 – 2026/06，8 支美股（AAPL / MSFT / GOOGL / AMZN / NVDA / TSLA / META / AMD）
- **客户 × 78**：均匀分配在 8 批次 × 4 BD（李晓明 / 王思远 / 张志强 / 刘佳），3 种 VIP 等级、6 个行业
- **合同类型**：开放期 / 交易窗口 / 锁仓期，3 档位分成（普通 7/3 → VIP 4/6）
- **Mock 数据单例**：`getMockData()` + `refreshMockDataPrices()` 突变后触发 tick 重渲染

### 实时股价联动（设置页开关）
- 总开关 `realtimeTickEnabled`：默认开
- 刷新周期 `realtimeTickIntervalSec`：默认 8 秒，夹紧 [2–120] 秒
- 开盘时段（NYSE 9:30–16:00 工作日）：顶部 Badge「美股 / 港股 开盘中」+ RadioTower `animate-pulse-green`
- 休市时段：顶部 Badge「全球市场休市」，仍按周期刷新但标注盘前/盘后

---

## 🧪 关键模块源码索引

| 能力 | 文件 & 行 |
|------|-----------|
| 风险阶梯条 4 色算法（盈利段占位 2.0） | [RiskLadderBar.tsx L160–210](src/components/dashboard/RiskLadderBar.tsx) |
| 风险弹窗 Dialog + ACK + beep 提示音 | [RiskAlertDialog.tsx](src/components/dashboard/RiskAlertDialog.tsx) |
| FlashNumber 金额跃动（Strict 兼容） | [FlashNumber.tsx](src/components/ui/FlashNumber.tsx) |
| 机构双曲线 + 6 KPI（行情中心） | [market/page.tsx L190–300](src/app/market/page.tsx) |
| 风险引擎（PnL 机构/客户拆分 + 汇总） | [riskEngine.ts L60–220](src/lib/riskEngine.ts) |
| settings 5 字段 + ACK 30min 冷却 | [webAlertSettings.ts](src/lib/webAlertSettings.ts) |
| RBAC 三档角色 + dataScope 过滤函数 | [auth/dataScope.ts](src/lib/auth/dataScope.ts) |
| Mock 8 批 78 客户生成器 + tick | [mockData.ts L160–430](src/lib/mockData.ts) |
| 客户退出流转 LS + storage 事件广播 | [clientStatusStore.ts](src/lib/clientStatusStore.ts) |
| Prisma 六表 Schema + 种子账号 | [prisma/schema.prisma](prisma/schema.prisma) · [prisma/seed.ts](prisma/seed.ts) |
| 深蓝暗主题 + 呼吸/闪烁 15 个 keyframes | [tailwind.config.ts](tailwind.config.ts) · [globals.css](src/app/globals.css) |

---

## 🛠 常用命令速查

```bash
# 开发
node node_modules/next/dist/bin/next dev -p 3002   # 端口 3002 启动（已验证稳定）
lsof -i :3002 -t | xargs kill -9                    # 崩溃清理

# 数据库
npm run db:generate   # Prisma Client
npm run db:push       # Schema → DB
npm run db:studio     # Prisma Studio (浏览器数据管理)

# 质量 & 构建
npx tsc --noEmit                                # ✅ 0 errors
npx tsx test_datascope_rbac.ts                  # ✅ 10/10 tests pass
npm run build                                    # ✅ 9 routes success
npm run lint
```

---

## 📌 Troubleshooting 速查

| 现象 | 根因 & 解决 |
|------|-------------|
| FlashNumber KPI 一直显示 0 | React Strict 开发模式 mount 双调用；代码端已用 `phaseRef + displayValue==0 兜底` 修复，请升级到最新（v2.1+） |
| 弹窗每次打开首页都出现 4 批 | ACK 记录 key 是 `risk_control_alert_ack_v1`；清理 localStorage 或点击「全部知晓」→ 30 分钟内不弹 |
| 设置页改开关后 4 秒才生效 | 同 tab localStorage 写入不触发 `storage` 事件；代码用 `setInterval 4s 兜底轮询`（跨 tab 立即生效） |
| 风险阶梯盈利段宽度溢出 | 已修复 2.0 算法：先给保底段分配 MIN_SEG，剩余按比例缩放，总和严格 100% |
| SSR 刷新客户退出状态丢失 | 已新建 `clientStatusStore.ts`：localStorage key `risk_control_client_status_v1` + CustomEvent `risk-control:client-status-changed` 双监听 |

---

<div align="center">
  <p>
    <strong>RiskControl v2.1 Professional</strong>
    ·
    内部金融工具，仅供授权机构用户使用
  </p>
  <p>
    <sub>
      Made with <span style="color:#ef4444">♥</span> in Next.js + TypeScript ·
      深蓝金融主题 by Tailwind ·
      机构风控最佳实践沉淀
    </sub>
  </p>
</div>
