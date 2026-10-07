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
    <img alt="Status: Internal Audit Completed" src="https://img.shields.io/badge/Status-Internal_Audit_Completed-6366F1" />
    <img alt="License: Private" src="https://img.shields.io/badge/License-Internal-8B5CF6" />
  </p>
</div>

---

## ✨ Features <a id="features"></a>

### 🧭 风控大盘（首页）
- **资产价值 + 收益率双图并排对称**：资产总值（左）+ 综合收益率（右），xl ≥1280px 两列并排；MiniStat 图标统一 + YAxis 60px 垂直对齐；收益率渐变 defs 与资产侧左右镜像
- **曲线 3s 跳动彻底修复**：stableSeed 从 `seedTick 递增` → **FNV-1a 32-bit hash（currentMarketValueTotal / institutionPnL / allClientsPnL / totalSubordinate / totalPriority / totalMarginCalls）6 字段 join**，dep 不含 tick，连续两次 evaluate SVG path 100% 一致
- **4 色风险阶梯条（条形升级为折线 ComposedChart）**：击穿红 / 预警黄 / 正常蓝 / 盈利绿，月度新增（柱）+ 累计在管（折线）叠加，点击分段直接跳转到对应风险批次
- **批次卡 Footer 单行对齐 + 下方留白消除**：
  - 修复 `flex flex-col block`：`block` 写在后面覆盖 `display:flex`，导致 `mt-auto` 失效（Footer 无法推到底部）
  - 删除多余 `h-full`（避免被父 Grid 行强制拉伸到 584px）
  - `min-h 584 → 520`（贴近内容自然高度），PnL Chip 与 Footer 间隙从 78px → 16px（仅剩 mb-4 设计间距）
  - Footer 双行错位 → 单行 `flex-row justify-between` + `py-3` 对称 padding + 删除 `min-h-[40px]` 占位 + 主按钮取消 `flex-1` 拉伸
  - 实测：`display=flex`, cardHeight=523（NORMAL）/ 536（PROFIT）, footerBottom = cardHeight - 1 像素
- **24 批次等高自适应**：2026 年 3–8 月每月 4 批共 24 张；呼吸边框（CRITICAL 红呼吸 / WARNING 黄呼吸 / 正常蓝 / 盈利绿 4 种 chrome）
- **风险批次实时弹窗**：新出现预警/击穿批次会以 `Dialog` 形式弹出，支持「已知晓」(ACK 30 分钟冷却)、「查看批次」、「全部知晓」、「处理击穿批次」
- **补仓分摊按投资额**：每个客户级补仓金额按其初始投入等比分配，自动计算回收率；仅 cum>0 且 adjustedRequired<=0 时显示「补仓累计」徽章
- **客户独立退出**：批次内单个客户可独立退出，其他客户不受影响；批次内客户全部退出后批次灰卡归档
- **双筛选 Tab**：状态 Tab（全部状态 / 需补仓 / 接近预警 / 正常安全 / 盈利批次）+ 月份 Tab（全部月份 + 3 月–8 月每月 4 批）
- **XMAX 真实入场价匹配**：Nasdaq Unofficial API 抓取 2026-03 ~ 2026-08 共 144 根 XMAX 日线，24 批次入场价 = 真实 XMAX 当日收盘价（误差 < 0.02%）

### 📈 机构老板版行情中心（/market）
**顶部：月度批次增长趋势（MonthlyBatchesTrend）**
- **柱形**：每月新增批次（2026 年 3 / 4 / 5 / 6 / 7 / 8 月各 4 批）
- **折线**：累计在管批次（4 → 8 → 12 → 16 → 20 → 24），鼠标悬停显示该月新增明细

**6 张核心 KPI**（机构视角，老板 3 秒看全）：
| KPI | 说明 |
|-----|------|
| AUM 总规模 | 优（客户优先）/ 劣（机构劣后）双拆分 |
| 机构累计注入 | 劣后本金 + 累计补仓 |
| 待回收补仓 | 击穿补仓未回收部分，风险敞口核心指标 |
| 机构收益率 | 机构绝对 PnL + 收益率百分比（带色） |
| 客户收益率 | 653 位客户整体收益率（24 批次） |
| 最大敞口 / 批次 | 单批次最大补仓金额 + 击穿 2 / 预警 2 |

**组合 + 机构资金双曲线（ComposedChart 4 层叠）**：
- 组合总市值（蓝面积）+ 机构劣后资金池（紫面积）+ 机构累计补仓（橙虚线）+ 机构单期 PnL（绿/红 Bar 右轴），带初始 AUM 线 & 补仓预警线

**3 个辅助分析模块**：
- 机构风险敞口 & 补仓执行月度 Stacked Bar（12 个月）
- 按风险分布 4 段市值权重 progress（击穿/预警/正常/盈利）
- 个股实时行情表：XMAX 标的 30 日 sparkline + 机构 PnL + 补仓金额 + 风险 Badge + 批次详情跳转
- **风险阶梯条折线化升级**：RiskLadderBar 从纯条形 → ComposedChart（月度新增柱 + 累计折线），盈利段占位严格 100%

### 🧑 客户总表（/clients）6 项精修
| 修改项 | 旧行为 | 新行为 |
|--------|--------|--------|
| 多批次批次号样式 | 椭圆 chip（rounded-md + border + bg-primary/15），与单批次视觉不一致 | 删除椭圆边框，统一与单批次 1:1 `inline-flex items-baseline rounded-md px-1.5 py-0.5` |
| 批次号排序 | 升序（最旧在上） | **降序**（最新批次 top，signDate 降 → 同 signDate batchNumber localeCompare 降） |
| 批次号颜色 | 多批次非当前行灰色 `text-muted-foreground`，当前行蓝色 | **全部蓝色** `text-primary/90`（删除灰字分支） |
| 名字下方辅助文字 | `c.id.slice(-6)` 客户 ID 尾号（如 23-0-0） | **首次录入时间**（该客户所有批次最小 signDate，null → `-` 兜底） |
| 投资金额列 | `累计投资额 + "本行 $XX"` 辅助行（占 2 行） | **仅最新批次投资额**（删除累计、删除本行辅助，共 1 行紧凑） |
| 删除客户权限 | OPS / RISK_MANAGER / BD 本人 均可删（`canEdit(c)`） | **仅 ADMIN 可见可点**（`<RoleGate allowed=[ADMIN] auditResource=client:delete:{id}>` 包裹，SETTLED 仍不可删） |

### ⚠️ 风险预警 & 通知
- **4 档开关（设置页）**：网页弹窗总开关 / 击穿提示音（AudioContext 520→420Hz）/ 仅击穿不弹预警 / 实时股价联动
- **ACK 30 分钟冷却**：用户「已知晓」后写 `localStorage risk_control_alert_ack_v1`，30 分钟内不重复打扰
- **通知渠道**：Email Webhook + WhatsApp Business Webhook + 风控收件人管理（8 位，可增删改）
- **审计日志（前端环形缓冲，本地持久化）**：13 种业务动作持久化（登录成功/失败、登出、阈值变更、账号增删改、客户编辑/删除、补仓注入、客户结算、批次通知），上限 2000 条，支持跨 Tab 实时刷新与操作审计
- **设置页全局 HelpDialog**：阈值、通知渠道、股价数据源、收件人 4 处 `HelpCircle` 问号按钮，点击弹出统一配置指南 Dialog

### 🎞 金额跃动 + 实时联动
- **FlashNumber 首次挂载**：0 → 目标值 requestAnimationFrame 60fps 补间，`easeOutExpo` 曲线，400–1400ms 自适应金额规模
- **值变更闪烁**：上涨时 `animate-flash-up`（绿背景高亮），下跌时 `animate-flash-down`（红）
- **NYSE 开盘判定**：`isMarketOpenNow()` 使用 `Intl.DateTimeFormat('America/New_York')` 精确判定工作日 9:30–16:00
- **实时 tick 热更新**：从设置读 `realtimeTickIntervalSec`（夹紧 [2, 120] 秒），`refreshMockDataPrices()` 突变 mock 单例触发重渲染
- **StrictMode 兼容**：修复 React 18 Strict 开发模式 mount/unmount 双调用下 FlashNumber 动画卡在 0 的 bug
- **XMAX TopBar 实时报价**：`$8.75 / +0.46%` 实时 Badge，Nasdaq Unofficial API 盘前/后仍返回当日快照价
- **Yield 收益率去变色恒 foreground**：综合收益率 KPI 不再因涨跌切换红绿，永久显示默认 foreground 色，搭配镜像 defs 渐变

### 🔐 登录与 HttpOnly 会话（P0 安全整改）
- **服务端权威密码校验（P0-2 A1 一轮补修，v2.1）**：`POST /api/auth/login` 入参收缩为仅 `{identifier, password}`，**绝对不接受客户端声明的 id/role/displayName/avatar/preVerified**；服务端 `resolveMockAccountByIdentifier` 按账号 key 或邮箱查表 → `verifyPassword` 比对 HMAC 哈希 → 只有通过才构造 AppSessionUser 并签 session；IP 级 60s≤10 次 + IP+账号级 60s≤5 次双限流；账号不存在/密码错误/限流/角色非法统一返回 **401 「凭据错误或账号不存在，请勿尝试枚举」**（防用户名枚举）；built-in 账号 100% 走服务端校验才能获得 Cookie；Settings 自定义账号保持浏览器本地乐观模式（暂无服务端表，demo 级保留）
- **服务端强制 HttpOnly Cookie 会话（P0-4 修复 / 路线 A 真做）**：不再把 JWT 放浏览器 `localStorage`；`POST /api/auth/login` 返回 Set-Cookie `rc_session_v1`（HttpOnly / Path=/ / SameSite=Lax / 生产 Secure / 12h），JS 完全读不到；`/api/auth/me` 返回当前用户；`/api/auth/logout` 清 Cookie
- **Next.js Middleware 12 路径强守卫（P0-4 A2 matcher 补漏，v2.1）**：`src/middleware.ts` matcher=['/','/clients*','/batch*','/settings*','/settings','/margin-calls/:path*','/margin-calls','/alerts/:path*','/alerts','/market/:path*','/market','/bd/:path*'] 无有效签名直接 307 `/login?next=`，无效 cookie 立即清；`/settings` 还需 INSTITUTION_ROLES 四档
- **JWT 自研 HMAC-SHA256 手搓，Edge+Node 双兼容**：[session.ts](src/lib/auth/session.ts) 完全弃 Node.js `require('crypto')`，改用 Web Crypto `globalThis.crypto.subtle`（middleware Edge Runtime 原生可用），含恒时 XOR diff 防时序侧信道
- **一键抹账（P0-1 修复 + v2.1 双条件收紧）**：清空客户台账前自动 ZIP 备份并触发下载，备份 JSON 可于 [LedgerRecovery.tsx](src/components/batch/LedgerRecovery.tsx) 导入还原；操作写入 audit log；**v2.1 新增：devMode 判定从「(NODE_ENV=dev) || (localhost|127.0.0.1|:300[0-9]$)」双或收紧为「NODE_ENV=development AND localhost/127.0.0.1/300x 端口」**（见 layout.tsx L62、page.tsx ×3、batch/[id]/page.tsx ×2、audit.ts），避免生产环境若意外占 300x 端口被挂上抹账函数
- **登录入口加固（P0-2 修复）**：`layout.tsx` `devMode 自动登录` 彻底移除；任何未登录受保护路径必须走 `/login` 表单 + 邮箱密码校验；Banner 必须显示当前角色
- **自建 ADMIN 越权（P0-3 修复）**：Settings 页 4 处 RoleGate 包裹（新增账号 / ADMIN 角色选框 / 阈值卡 / 收件人编辑），只有角色本身允许的 UI 才渲染；客户端+服务端双校验
- **🛡 登录欢迎过渡动画（商用级）**：点击"登录进入工作台"→凭据校验通过 → [page.tsx WelcomeTransitionOverlay](src/app/login/page.tsx#L527-L709) 全屏遮罩：Logo 旋转光晕 + Authentication Verified 副文案 +「欢迎登录 RiskControl」渐变字 + 身份卡（首字母头像/角色徽章/邮箱）+ 进度条填充+扫光 + 780ms 后整页 `window.location.replace` 跳工作台（**避免 SPA NextRouter.push 跨 Set-Cookie 边界丢会话**）；7 段内联 keyframes（fade-in / pop-in / slide-up / pulse-soft / spin-slow / progress-fill / progress-shimmer / blink）
- **🖼 阈值口径 & 接入引擎（P1-5 / P1-6 A3+A4 一轮补修，v2.1）**：
  - `riskEngine.getBatchMetrics` 删除内嵌 IIFE 直接摸 localStorage `risk_control_settings` 的死代码，统一 `import { getStoredThresholds } from "./thresholds"`（A4 收口配置源单点）
  - BatchDetail 预警阈值基数：`baseCapital × 0.8` → **`(metrics.activeSubsetInitialPrincipal ?? baseCapital) × (1 - warningPct/100)`**，含补仓累计注资；两处写死 `20%` / `击穿 20%` 改为 `marginPct` 动态读（A3 口径 100% 对齐引擎，不再有补仓后假阈值）
  - Settings 页「优先出资比例 / 劣后出资比例」两个控件 v2.1 置灰 disabled + 黄虚线徽章「暂未接入引擎」+ 描述改为「当前版本固定 70/30，后续版本开放」（PRIORITY_RATIO 常量仍在引擎生效，控件防假操作）

### ✅ 审计整改 13 项修复汇总（2026-10-05 · Internal Audit v2 Completed）

| # | 严重度 | 问题 | 修复方案 | 关键文件 |
|---|---|------|----------|----------|
| P0-1 | **紧急** | 一键抹账无备份（清空即永久损失） | 清空前 ZIP 备份 + 浏览器下载；LedgerRecovery 组件一键还原 | [LedgerRecovery.tsx](src/components/batch/LedgerRecovery.tsx) |
| P0-2 | **紧急** | devMode 自动登录 → 登录形同虚设 | 删除 `layout.tsx` 自动登录分支；受保护路径必须 `/login` 表单凭据校验 | [layout.tsx](src/app/layout.tsx) |
| P0-3 | **紧急** | localStorage 改 `role='ADMIN'` 直接越权 | 新增账号 / ADMIN 选框 / 阈值 / 收件人 4 处 `<RoleGate allowed=[ADMIN]>` 包裹；服务端 `/api/data/*` 双保险隔离 | [settings/page.tsx](src/app/settings/page.tsx) · [data/*](src/app/api/data/) |
| P0-4 | **紧急** | JWT 会话全放浏览器 localStorage（XSS 全量泄露） | **路线 A 真做**：HttpOnly Cookie `rc_session_v1` + Middleware 守卫 + HMAC-SHA256 JWT 手搓 | [session.ts](src/lib/auth/session.ts) · [middleware.ts](src/middleware.ts) · [auth route](src/app/api/auth/) |
| P1-5 | **高** | 阈值控件纯 UI（引擎完全不读设置） | **方案 A 接入引擎**：新增 [thresholds.ts](src/lib/thresholds.ts) 统一配置源；`riskEngine.calculateBatchRiskSummary` 直接读阈值；Settings 保存即时生效 | [riskEngine.ts](src/lib/riskEngine.ts) · [settings/page.tsx](src/app/settings/page.tsx) |
| P1-6 | **高** | 客户详情页 80% 预警阈值口径与引擎分叉 | 新增 `activeSubsetInitialPrincipal` 统一 UI 与引擎；容差 0.005→0.02 防临界舍入误判 | [BatchDetailContent.tsx](src/components/batch/BatchDetailContent.tsx) · [riskEngine.ts](src/lib/riskEngine.ts) |
| P1-7 | **高** | `npx tsc --noEmit` 251 errors（构建必挂） | 删除遮蔽型 `src/types/prisma.d.ts` + 4 个补字段 interface + 修正 `FULFILLED` 拼写 → 0 errors | [types/auth.ts](src/types/auth.ts) + 各组件 |
| P1-8 | **高** | Audit Log 空壳（13 动作仅埋点未落库） | Prisma `AuditLog` 模型 + 环形缓冲 2000 前端持久化 + `CustomEvent('risk-control:audit-updated')` 跨 Tab 刷新；13 动作全覆盖（login/logout/threshold/账号/客户/补仓/结算/通知） | [audit.ts](src/lib/auth/audit.ts) · [schema.prisma](prisma/schema.prisma) |
| P2-9 | 中 | 补仓击穿无乐观锁，并发注入重复记账 | RevisionMismatchError toast 9 处 + 假 K 线 Nasdaq 502 兜底 + dataScope `/api/data/clients + /api/data/batch/:id` 服务端隔离双 API | [margin-calls/page.tsx](src/app/margin-calls/page.tsx) · [ClientTable.tsx](src/components/clients/ClientTable.tsx) |
| P2-10 | 中 | 假 K 线未标注 / 数据源故障静默 | KLineDialog 502 状态页提示 / InlineKLine 明确 mock 标志 / Provider 超时时 4 条链路兜底 | [KLineDialog.tsx](src/components/quote/KLineDialog.tsx) · [providers.ts](src/lib/quote/providers.ts) |
| P2-11 | 中 | 数据隔离 API 前端读全量（BD 可看所有） | `/api/data/clients` + `/api/data/batch/:id` 服务端内部 `filterByRole(session.user.role, bdManagerFullName)`，BD 仅自己 | [api/data/](src/app/api/data/) · [dataScope.ts](src/lib/authz/dataScope.ts) |
| P2-12 | 中 | README 与 seed 不一致（无管理员凭据） | 本 README 5.1 节 30 秒首次登录指南 + seed 写入 8 个 built-in 账户 + 演示账号表统一 | [README.md](./README.md) · [seed.ts](prisma/seed.ts) |
| P2-13 | 中 | 终检 9 条 checklist 无闭环 | tsc 0 / 登录闭环 4 条 / build / Task10.4 6 条手工验收清单（密码错误 / OP 无新增账号 / 生产 `__RC_DEBUG__` undefined / 阈值口径 / 阈值接入引擎生效） | 下方 §Changelog |

---

## 🏗 Architecture <a id="architecture"></a>

```
risk-control/
├── src/
│   ├── middleware.ts              # ⭐ Next.js Middleware（Edge Runtime）5 路径守卫 + verifySessionJwt + 无效清 Cookie + /settings INSTITUTION_ROLES
│   ├── app/                       # Next.js 14 App Router
│   │   ├── layout.tsx             # AuthProvider + Sidebar Layout（hsl 深蓝暗主题）；已彻底移除 devMode 自动登录
│   │   ├── page.tsx               # / 风控大盘：6 KPI + 阶梯条 + 24 批次卡 + DashboardCharts 双图并排 + RiskAlertDialog
│   │   ├── api/auth/              # ⭐ 三条会话 API（服务端 HttpOnly Cookie 强控制点）
│   │   │   ├── login/route.ts     # POST /api/auth/login 凭据→signSessionJwt→Set-Cookie rc_session_v1 HttpOnly 12h
│   │   │   ├── me/route.ts        # GET  /api/auth/me 读 Cookie→verify→返回 {ok,user} 或 401 清 Cookie
│   │   │   └── logout/route.ts    # POST /api/auth/logout 清 Cookie 返回 200
│   │   ├── api/data/              # ⭐ RBAC 数据隔离双 API（服务端双保险 filterByRole）
│   │   │   ├── clients/route.ts   # GET /api/data/clients BD 仅自己
│   │   │   └── batch/[id]/route.ts# GET /api/data/batch/:id 同客户隔离
│   │   ├── api/quote/             # 行情 REST：history (144 根日线) / realtime (XMAX 实时)
│   │   │   ├── history/route.ts   # GET /api/quote/history?symbol=XMAX&from=2026-03-01
│   │   │   └── realtime/route.ts  # GET /api/quote/realtime?symbol=XMAX
│   │   ├── login/page.tsx         # /login 登录页 + WelcomeTransitionOverlay（Logo 旋转/欢迎过渡动画 780ms）
│   │   ├── market/page.tsx        # /market 机构版行情：Top MonthlyBatchesTrend + 6 KPI + 双曲线 + 月度敞口 + XMAX sparkline
│   │   ├── alerts/page.tsx        # /alerts 风险警报中心 + 通知日志
│   │   ├── clients/page.tsx       # /clients 客户总表（自然人聚合索引：首次录入时间 / 最新批次 / 降序批次号 / 最新投资）
│   │   ├── margin-calls/page.tsx  # /margin-calls 补仓历史 & 执行跟踪
│   │   ├── settings/page.tsx      # /settings 阈值、预警开关、通知渠道、4 处 HelpDialog；4 张 RoleGate 包裹的权限敏感卡
│   │   └── batch/[id]/page.tsx    # 批次详情：客户级补仓分摊 + 单客户退出流转
│   │
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── DashboardCharts.tsx      # ⭐ 资产价值 + 收益率双图并排对称（YAxis 60 / 稳定 Seed）
│   │   │   ├── MonthlyBatchesTrend.tsx  # ⭐ 月度新增批次柱 + 累计在管折线（ComposedChart）
│   │   │   ├── RiskLadderBar.tsx        # 4 色阶梯条：纯条形 → ComposedChart 折线化
│   │   │   ├── BatchCardV2.tsx          # 批次卡 v2（呼吸 4 色 chrome + FlashNumber x 8 + Footer 单行对齐）
│   │   │   ├── BatchGridCard.tsx        # 旧版批次卡（保留兼容）
│   │   │   ├── BatchControlPanel.tsx    # 状态 Tab + 年份/月份 Tab 双筛选
│   │   │   └── RiskAlertDialog.tsx      # ⭐ 风险批次弹窗（击穿红呼吸 + 预警黄）
│   │   ├── batch/
│   │   │   ├── BatchDetailContent.tsx   # 客户 Tab 级补仓分摊 / 退出（80% 阈值口径统一 activeSubsetInitialPrincipal）
│   │   │   └── LedgerRecovery.tsx       # ⭐ 一键抹账 ZIP 备份还原组件
│   │   ├── clients/ClientTable.tsx
│   │   ├── quote/
│   │   │   ├── InlineKLine.tsx          # XMAX 30 日 sparkline mini chart
│   │   │   └── KLineDialog.tsx          # 144 根 K 线大图弹窗（含 Nasdaq 502 兜底 UI）
│   │   ├── auth/
│   │   │   ├── AuthProvider / AuthGuard / RoleGate  # 细粒度权限（RoleGate 支持 auditResource + auditAction 审计）
│   │   │   └── AppSidebar + TopBar      # 左侧菜单 + 顶部实时 XMAX 报价 Badge
│   │   └── ui/
│   │       ├── FlashNumber.tsx    # ⭐ animateOnMount + easeOutExpo 金额跃动
│   │       ├── Tabs.tsx           # Shadcn Tabs 组件（Radix UI）
│   │       ├── Card / Button / Badge / Tooltip / Dialog / Table / Input / Label / Select / DropdownMenu
│   │
│   ├── lib/
│   │   ├── thresholds.ts          # ⭐ 阈值统一配置源（引擎接入 P1-5）
│   │   ├── riskEngine.ts          # 核心风控：drop%、补仓额、PnL 客户/机构拆分、组合 Summary（读 thresholds.ts）
│   │   ├── mockData.ts            # 24 批 653 客户 1 标的(XMAX) 4 BD 经理（refreshMockDataPrices tick）
│   │   ├── liveQuote.ts           # XMAX 实时行情（Nasdaq Unofficial fetchQuoteBrowser）
│   │   ├── xmax-price-series.ts   # 144 根 XMAX 真实日线（2026-03 ~ 2026-08，抓取脚本 scripts/xmax-history-nasdaq.js）
│   │   ├── quote/providers.ts     # Nasdaq Unofficial API Provider（Yahoo 403 / Stooq 超时 兜底 mock）
│   │   ├── riskRecipients.ts      # 风控收件人运行时存储（+LS）
│   │   ├── clientStatusStore.ts   # 客户退出状态（LS + storage 事件）
│   │   ├── webAlertSettings.ts    # ⭐ 5 字段开关 + ACK 持久化
│   │   ├── stockFetcher.ts        # Yahoo Finance / Finnhub 适配器（环境变量 Key）
│   │   ├── auth/                  # ⭐ 自研安全栈（P0 整改核心）
│   │   │   ├── session.ts         # HMAC-SHA256 JWT 手搓（Web Crypto，Edge+Node 双兼容）+ buildSetCookieHeader
│   │   │   ├── password.ts        # SHA-256+salt（Web Crypto，FNV1a 兜底），verifyPassword/generateSalt/hashPassword
│   │   │   ├── audit.ts           # 13 动作审计环形缓冲（2000 条上限）+ 跨 Tab CustomEvent
│   │   │   ├── authProvider.tsx   # React AuthContext：setSession 死循环 5 层防御 / refreshingRef / Hydrate 仅 1 次
│   │   │   ├── useCurrentUser.ts  # Hook
│   │   │   ├── providers/mockProvider.ts
│   │   │   └── providers/supabaseProvider.ts
│   │   ├── authz/dataScope.ts     # filterClientsByRole / filterBatchesByRole / summarizeByScope
│   │   ├── notifier.ts            # Email + WA + 风控收件人通知
│   │   ├── prisma.ts
│   │   └── utils.ts (cn / formatCurrency / formatPercent / formatCompactNumber / formatDate)
│   │
│   └── types/auth.ts
│
├── scripts/                       # XMAX 真实日线抓取脚本
│   ├── xmax-history-nasdaq.js     # Nasdaq Unofficial 144 日线抓取（User-Agent + Referer header 必须）
│   ├── xmax-history.js            # Yahoo Finance fallback（当前 403，已弃用）
│   ├── build-xmax-series.py       # Python 备用抓取
│   ├── xmax-6m-history.json       # 已落地 144 根日线快照（可离线 mock 使用）
│   ├── check-finance.ts / check-test-data.ts / check-notifications.ts / check-preview.mjs
│
├── prisma/
│   ├── schema.prisma              # enum AppRole(ADMIN/RISK_MANAGER/OPERATIONS/BD_MANAGER) + AppUser + Session + Client + Batch + MarginCallHistory + AuditLog
│   └── seed.ts                    # 种子账号（admin@institution.com / operations@institution.com 等）
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
| 鉴权 & RBAC | 自研 AppRole 四档（ADMIN / RISK_MANAGER / OPERATIONS / BD_MANAGER）+ HMAC-SHA256 手搓 JWT + HttpOnly Cookie + Next.js Middleware 路由守卫 | — |
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

> 系统 **开箱即用**：默认走 localStorage 账本（24 批 / 653 客户）+ 服务端 HttpOnly Cookie 会话鉴权，不需要任何真实数据库或外部 API Key 就能看到完整界面。

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

> **会话密钥**：生产环境请设置 `NEXT_RC_AUTH_SECRET`（32+ 字节高强度随机串），未设置时开发环境将使用内置 fallback。

### 3. （可选）初始化数据库 + 种子

```bash
npx prisma db push       # Schema 同步到 PostgreSQL
npx prisma db seed       # 写入 5 个种子账号 + Mock Auth (可选，演示模式可跳过)
npx tsx test_datascope_rbac.ts   # 运行 RBAC 验收脚本，期望 10/10 PASS
```

### 4. 启动开发服务器

```bash
npm run dev
# 或指定端口
node node_modules/next/dist/bin/next dev -p 3000
# 浏览器访问 → http://localhost:3000
```

### 5. 演示账号（HttpOnly Cookie 会话登录）

| 角色 | 邮箱 | 密码 | 说明 |
|------|------|------|------|
| **ADMIN 系统管理员** | `admin@riskcontrol.io` | `Admin@Risk2026` | 全量权限 + **唯一可删客户 + 唯一可分配 ADMIN 角色** + 系统设置全部可改 |
| **RISK_MANAGER 风控总监** | `evan.pan@institution.com` | `Evan@Risk2026` | 看所有客户/批次 / 补仓 / 通知 / 击穿处理；不能改阈值、不能增删账号、不能删客户 |
| **RISK_MANAGER 风控总监（备用 built-in）** | `risk_evan`（或邮箱匹配同账户） | `Evan@Risk2026` | 同上（built-in mock 内置 key） |
| **OPERATIONS 运营专员** | `operations@institution.com`（built-in key：`op_wangsy`） | `Wangsy@Risk2026` | 客户资料编辑 / 批次录入；不能改阈值 / 不能补仓 / 不能删客户 |
| **BD_MANAGER 商务经理**（4 位） | `lixiaoming.bd@institution.com`（Li@Client2026）<br>`wangsy.bd@institution.com`（Wang@Client2026）<br>`zhangzhiqiang.bd@institution.com`（Zhang@Client2026）<br>`liujia.bd@institution.com`（Liu@Client2026） | 括号内 | 仅看自己名下客户 + 对应批次；不能操作任何系统设置 / 不能删客户 |

> **密码口径**：演示环境所有内置（built-in）账号密码经 `SHA-256 + 固定 salt`（`mock-builtin-${key}-${id}-s4lt`）校验，见 [password.ts](src/lib/auth/password.ts)；**⚠ 内置口令以明文存在 `BUILTIN_PASSWORDS` 源码常量中，仅供原型 / 演示 / 本地 mock 使用**，不要用于任何真实环境或真实账号复用；生产部署应接真实 IdP（OAuth2/SAML）而不是本 mock 账号库。
>
> **自定义账号迁移至 Prisma AppUser（v2.3 / P3 完成）**：Settings 页「系统账号」Tab 由 ADMIN 新增 / 编辑 / 删除的自定义账号，已从原 `localStorage: risk_control_users_v1` **双写迁移**至服务端 `Prisma → AppUser` 表（SQL 级唯一 email / passwordHash HMAC-SHA256 deterministicSalt 约定）；登录 API `POST /api/auth/login` 鉴权顺序升级为「① 先查 Prisma AppUser（Settings 创建，跨设备/跨刷新/跨 Tab 持久化）→ ② 未命中回退 built-in 演示账号」，两源统一签发 `rc_session_v1` HttpOnly Cookie，回包 `accountKind` 区分 `prisma` / `built-in`；管理 API `GET /api/auth/manage`、`POST /api/auth/manage`、`PATCH /api/auth/manage/[id]`、`DELETE /api/auth/manage/[id]` 四条，`verifySessionJwt + role=ADMIN` 双层守卫，未登录 401、非 ADMIN 403；当本地 Postgres 未启动时，全部管理接口返回 **HTTP 202 stored=pending**，Settings 前端自动降级为 localStorage 影子写入并 toast 提示「当前 DB 未连接，稍后自动同步」，不阻塞业务流程；自定义账号口令 ≥ 6 位，服务端双阶段 final hash：创建时先用 `prisma-${email}-PENDING-s4lt-v1` 临时 salt 拿 id，再用 `prisma-${email}-${AppUser.id}-s4lt-v1` deterministicSalt 重 hash 写入（保证登录 resolve 时同一 salt 生成），PATCH 更新密码时取 DB email 重新计算，全链路 salt 约定一致。
>
> **会话口径**：`POST /api/auth/login` → 服务端签发 `rc_session_v1` **HttpOnly Cookie**（12h Max-Age / SameSite=Lax / 生产加 Secure），由 [middleware.ts](src/middleware.ts) 在 **`/ /clients /batch /settings /margin-calls /alerts /market /bd` 共 12 条 matcher** 上强制守卫；JWT 体用 `HMAC-SHA256 (Web Crypto 手搓，Edge Runtime + Node.js 双兼容)` 自校验，payload 必含 `sub/email/role/displayName/iat/exp/iss=rc-internal`，恒时 XOR diff 防时序。
>
> **清空前账本**：客户台账清空会自动打 ZIP 备份并弹出下载；备份可于 [LedgerRecovery.tsx](src/components/batch/LedgerRecovery.tsx) 恢复入口导入还原。

### 5.1 首次登录引导（最快进入工作台 30 秒）

```bash
npm install
npm run dev -p 3000
# 浏览器 http://localhost:3000/login
# 账号：admin@riskcontrol.io  密码：Admin@Risk2026
# → 看到欢迎动画 → 自动跳转 → 右上角「系统管理员 (Administrator) ADMIN」
```

### 6. 生产构建 & 启动

```bash
npm run build            # ✅ All routes compiled
npm run start -p 3000
```

---

## 🔐 RBAC 权限体系 <a id="rbac"></a>

### 四档角色 `enum AppRole`
```prisma
enum AppRole {
  ADMIN        // 全量：看所有客户 / 所有批次 / 改阈值 / 增删账号 / 管理收件人 / **唯一可以删除客户的角色**
  RISK_MANAGER // 看所有批次，可补仓 / Email WA 通知 / 处理击穿批次；不能改阈值、不能增删账号、不能删客户
  OPERATIONS   // 运营：可编辑客户资料、批次录入；不能改阈值 / 不能补仓 / 不能删客户
  BD_MANAGER   // 仅看自己名下客户 + 对应批次；不能操作任何系统设置 / 不能删客户
}
```

### 权限守卫（四层）

| 守卫层 | 组件 / 函数 | 作用 |
|--------|------|------|
| 服务端路由中间件 | `src/middleware.ts` matcher=['/','/clients/*','/batch/*','/settings*'] + `verifySessionJwt` | **强制入口守卫**：无有效 HttpOnly Cookie 签名 → 302 `/login?next=`；/settings 仅机构四角色可进入；清退无效 Cookie |
| API 层授权 | `/api/auth/*`（会话）+ `/api/data/*`（数据过滤）+ 各业务 Route Handler 内部 session 校验 | **数据强隔离**：`filterClientsByRole / filterBatchDetailClientsByRole` 在服务端内部执行，避免 BD 直接从 Network 读全量 |
| UI 守卫 | `<RoleGate allowed={[ADMIN, RISK_MANAGER]} auditResource="..." auditAction="ui_component_denied">` | 包裹按钮/卡片，**支持细粒度审计（auditResource + auditAction）**，无权限时不渲染或置灰；Settings 新增账号 / 阈值卡 / ADMIN 角色选框均受 RoleGate 保护 |
| 客户端数据层过滤 | `dataScope.ts` 内 `filterClientsByRole / filterBatchDetailClientsByRole / filterBdStatsByRole`（API 不可用时前端兜底） | 从**浏览器渲染源头**二次隔离，双保险避免越权 |

> **客户删除仅 ADMIN**：`src/app/clients/page.tsx` 删除按钮 `<RoleGate allowed=[ADMIN]>` 包裹；原 `canEdit(c)`（OPS / RISK / BD 本人均可删）已废弃。

> 测试脚本 [test_datascope_rbac.ts](test_datascope_rbac.ts) 覆盖 10 场景（Admin 全量、BD 仅自己、跨 BD 不可见、Audit BD 仅自己、summary 聚合自己、Supabase env 切换、Mock 用户注入、空客户过滤、4 BD 互斥、组合汇总匹配）共 **55 个 assertions 100% PASS**。

---

## 📊 Mock 数据与实时行情 <a id="mock-data"></a>

### 内置数据规模
- **批次 × 24**：2026 年 3 月 / 4 月 / 5 月 / 6 月 / 7 月 / 8 月每月 4 批，共 24 批
- **标的 × 1（XMAX）**：Direxion Daily Gold Miners 2X Bull ETF（全部批次统一标的）
- **真实入场价**：24 批次入场价 = XMAX 真实当日收盘价（Nasdaq Unofficial 144 根日线，误差 < 0.02%），半年整体 +42.09%（$6.13 → $8.71）
- **客户 × 653**：每批 23–30 位客户，均匀分配在 4 BD（李晓明 / 王思远 / 张志强 / 刘佳）；投资分两档：< $10万 / > $10万 并存；3 种 VIP 等级、6 个行业
- **自然人聚合索引**：姓名 + BD 经理指纹 key，存储：
  - `batchMap`：该人所有批次（signDate 降序 + 批次号降序 → 最新在上），含 investmentAmount 每项
  - `firstSignDateMap`：所有批次最小 signDate → 首次录入时间
  - `latestBatchMap`：最大 signDate / 同签日 batchNumber 降序 → 最新批次投资金额
  - `totalInvestMap`：累计投资额（Excel 导出 Sheet1 自然人去重列保留）
- **合同类型**：开放期 / 交易窗口 / 锁仓期，3 档位分成（普通 7/3 → VIP 4/6）
- **Mock 数据双缓存**：`generateMockData()` → 模块级 `cachedMockData` 内存缓存 → 持久化到 `localStorage FINANCE_STORE_KEY`（刷新不丢）
- **Tick 突变**：`refreshMockDataPrices()` 突变 mock 单例触发重渲染

### 实时股价联动（设置页开关）
- 总开关 `realtimeTickEnabled`：默认开
- 刷新周期 `realtimeTickIntervalSec`：默认 8 秒，夹紧 [2–120] 秒
- 开盘时段（NYSE 9:30–16:00 工作日）：顶部 Badge「美股 / 港股 开盘中」+ RadioTower `animate-pulse-green`
- 休市时段：顶部 Badge「全球市场休市」，仍按周期刷新但标注盘前/盘后
- **真实行情数据源 = Nasdaq Unofficial API**：
  ```
  GET https://api.nasdaq.com/api/quote/{SYMBOL}/historical?assetclass=stocks&fromdate={YYYY-MM-DD}&limit=N
  Header 必须：User-Agent: Chrome UA + Accept: application/json + Referer: https://www.nasdaq.com/
  ```
  - **注意**：Yahoo Finance 当前 IP 403；Stooq 10s+ 超时；仅 Nasdaq Unofficial 稳定
- **API 路由**：
  - `GET /api/quote/realtime?symbol=XMAX` → 实时价 + 涨跌幅（TopBar 右上角 Badge）
  - `GET /api/quote/history?symbol=XMAX&from=2026-03-01` → 144 根日线

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
npm run dev                                           # 默认端口 3000 启动
node node_modules/next/dist/bin/next dev -p 3000     # 指定端口
lsof -i :3000 -t | xargs kill -9                      # 崩溃清理（僵尸端口）

# 数据验证
tsx scripts/check-finance.ts        # ✅ 24 批次 XMAX 入场价误差 <0.02%
tsx scripts/check-test-data.ts      # ✅ 653 位客户数据一致性
tsx scripts/check-notifications.ts  # ✅ Email + WA 通知通道
node scripts/check-preview.mjs      # ✅ 页面渲染快照

# 数据库
npm run db:generate   # Prisma Client
npm run db:push       # Schema → DB
npm run db:studio     # Prisma Studio (浏览器数据管理)

# 质量 & 构建
npx tsc --noEmit                                # ✅ 0 errors
npx tsx test_datascope_rbac.ts                  # ✅ 10/10 tests pass
npm run build                                    # ✅ All routes compiled
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
| **批次卡 Footer 下方大片留白** | className 顺序错误 `flex flex-col block`：`block` 覆盖 `flex` → `display:block` → `mt-auto` 无效；<br>修复：删除 `block` 恢复 `display:flex`，删除 `h-full` 避免被父 Grid 拉伸，`min-h 584 → 520` 贴近内容高度 |
| **批次卡 Footer 双行错位 + 多余空白** | 原双行 `px-5 pb-1 pt-3 flex-col gap-3 + min-h-[40px]`；<br>修复：单行 `flex-row justify-between + py-3 对称 padding + 删除 min-h-40 + 主按钮 shrink-0 去 flex-1` |
| **资产/收益率曲线 3 秒跳动变形** | stableSeed 随 `seedTick++` 递增 → 每次合成 Mulberry32 种子不同；<br>修复：改为 **FNV-1a 32-bit hash**（currentMarketValueTotal / institutionPnL / allClientsPnL / totalSubordinate / totalPriority / totalMarginCalls 6 字段 join），dep 不含 tick，连续 2 次 evaluate SVG path 100% 一致 |
| **客户总表批次号灰字（用户反馈）** | 多批次分支遗留 `isCurrent` 条件：`!isCurrent → text-muted-foreground` 灰色；<br>修复：删除条件分支，所有批次号统一 `text-primary/90` 蓝色 |
| **Yahoo Finance API 403 / Stooq 超时** | 当前 IP 触发 Yahoo 限流；Stooq 在当前网络 10s+ 超时；<br>统一数据源：**Nasdaq Unofficial API** `api.nasdaq.com/api/quote/{SYMBOL}/historical`（必须带 Chrome UA + Referer Header） |

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
