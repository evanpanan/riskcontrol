# 任务清单：优先劣后风控预警系统 — RBAC 账号与权限体系

> 父规格：`./spec.md`
> 日期：2026-09-19
> 代码库：`/Users/evan/Desktop/技术/risk control`（Next.js 14.2 App Router + TS strict + Prisma 5.18 + Shadcn UI + Mock 数据驱动）

---

## 全局依赖说明

```
Task 0 (Schema)
  └─ Task 1 (Auth 基础层：类型/Context/Hook/Mock Session)
       ├─ Task 2 (dataScope 统一数据过滤层)
       ├─ Task 3 (AuthGuard 路由守卫)
       └─ Task 4 (UI 通用组件：RoleGate + 角色切换器)
            ├─ Task 5 (大盘 / page.tsx 接入)
            ├─ Task 6 (BatchCardV2 CRIT 按钮显隐)
            ├─ Task 7 (批次详情 BatchDetailContent)
            ├─ Task 8 (/clients 客户管理页)
            └─ Task 9 (/settings 设置页守卫 + 收件人保留风控可见)
                 └─ Task 10 (tsc + next build + 双视角验收)
```

所有任务 **不得跳级**。先写底层类型 / 过滤函数，再在 UI 层一行行替换，避免中途 RoleGate 找不到组件或类型不匹配爆红色 TS 报错。

---

## Task 0：Prisma Schema 扩展 & 演示种子账号

**修改范围**：`prisma/schema.prisma`；新增 `prisma/seed.ts`；新增 `src/types/auth.ts`（Prisma 生成前过渡类型）。

### 工作项
1. 在 `schema.prisma` 顶部枚举区追加：
   - `enum AppRole { RISK_MANAGER BD_MANAGER OPERATIONS }`
2. 追加 2 个模型：
   - `AppUser { id / email @unique / passwordHash? / displayName / role AppRole / avatarInitials / bdManagerFullName? / lastLoginAt? / createdAt / updatedAt }`
   - `Session { id / userId / expiresAt / token @unique / ipAddr? / userAgent? / createdAt }`
3. `Client` 模型追加 2 行（保留原 `bdManager String` 兼容）：
   ```prisma
   bdUserId String?
   bdUser   AppUser?  @relation("BdToClients", fields: [bdUserId], references: [id])
   ```
   并在 `AppUser` 反向加 `clients Client[] @relation("BdToClients")`。
4. 新建 `prisma/seed.ts`，`AppUser.createMany` 插入 7 条演示账号：
   | displayName | email | role | bdManagerFullName（仅 BD） |
   |---|---|---|---|
   | Evan Pan | evan.pan@institution.com | RISK_MANAGER | — |
   | 李晓明 (Evan Li) | evan.li@institution.com | BD_MANAGER | 李晓明 (Evan Li) |
   | 王思远 (Sylvia Wang) | sylvia.wang@institution.com | BD_MANAGER | 王思远 (Sylvia Wang) |
   | 张志强 (Jack Zhang) | jack.zhang@institution.com | BD_MANAGER | 张志强 (Jack Zhang) |
   | 刘佳 (Jennifer Liu) | jennifer.liu@institution.com | BD_MANAGER | 刘佳 (Jennifer Liu) |
   | 陈志远 (Daniel Chen) | daniel.chen@institution.com | BD_MANAGER | 陈志远 (Daniel Chen) |
   | 林晓雯 (Sharon Lin) | sharon.lin@institution.com | BD_MANAGER | 林晓雯 (Sharon Lin) |
5. 同步 `package.json` 新增 `"prisma": {"seed": "tsx prisma/seed.ts"}`（若缺 `tsx` 后续 `npm install -D tsx`，本轮不实际跑，只写入 package.json 方便将来用）。
6. 新建 `src/types/auth.ts`，Prisma 生成过渡类型：
   - `export type AppRole = 'RISK_MANAGER' | 'BD_MANAGER' | 'OPERATIONS'`（as const）；
   - `export interface AppSessionUser { id; email; role: AppRole; displayName; avatarInitials; bdManagerFullName?: string }`；
   - `export const ALLOWED_ROLES: readonly AppRole[] = [...] as const`（Grep 裸字符串的锚）；
   - `export function isAllowedRole(r: any): r is AppRole` 类型守卫。

### 本地 Test Requirements

| TR | 类型 | 通过条件 |
|---|---|---|
| T0-R1 | rule | `prisma validate`（Prisma schema 语法）通过；若本地无 DB 连接，可跑 `npx prisma validate` 无错误输出（exit 0） |
| T0-R2 | rule | Grep 裸字符串：`rg "RISK_MANAGER" src/ --type ts --type tsx -n` → 仅命中 `src/types/auth.ts` 的 enum/const 定义（0 处散落）；`BD_MANAGER / OPERATIONS` 同理 |
| T0-R3 | rule | `seed.ts` 至少 7 个账号；6 位 BD 的 `bdManagerFullName` 必须与 `getMockData()` 的 Client.bdManager 字段完全一致（可通过 grep 现有 mockData 比对） |

---

## Task 1：Auth 基础层 — AppSessionUser / useCurrentUser / AuthProvider / 拒绝日志

**修改范围**：
- 新建 `src/lib/auth/authProvider.tsx`（React Context）
- 新建 `src/lib/auth/useCurrentUser.ts`（Hook）
- 新建 `src/lib/auth/providers/mockProvider.ts`（`localStorage.rbac_mock_session` CRUD）
- 新建 `src/lib/auth/providers/supabaseProvider.ts`（空壳，标注 TODO：真实集成时填）
- 新建 `src/lib/auth/index.ts`（统一入口）
- 新建 `src/lib/auth/audit.ts`（结构化权限拒绝日志，`NFR-5`）

### 工作项
1. `audit.ts` 导出 `logAuthDeny({ action, resource, reason, userId, role })`，`console.log` JSON：`{ ts: ISO, event: "auth_denied", userId, role, action, resource, reason }`。
2. `providers/mockProvider.ts`：
   - `MOCK_LS_KEY = 'rbac_mock_session_v1'`；
   - `getStoredSession(): AppSessionUser | null`；
   - `saveSession(u: AppSessionUser): void`；
   - `clearSession(): void`；
   - `createDefaultRiskManagerSession(): AppSessionUser`（Evan Pan）；
   - `createMockSessionByKey(key: 'risk_evan' | 'bd_lixiaoming' | 'bd_wangsy' | 'bd_zhangzhiq' | 'bd_liujia' | 'bd_chenzhiyuan' | 'bd_linxw'): AppSessionUser`；
3. `supabaseProvider.ts`：export `supabaseAuthStub = { signIn: () => { throw new Error('[RBAC] Supabase Auth provider requires NEXT_PUBLIC_AUTH_PROVIDER=supabase + env keys'); } }`；
4. `authProvider.tsx`：
   - `createContext<{ user: AppSessionUser | null; role: AppRole; isLoading: boolean; switchToMockRole: (key: MockUserKey) => Promise<void>; forceLogout: () => void; }>`；
   - 初始化时：若 LS 有 → 读；无 → 写入默认 Evan Pan；
   - `switchToMockRole`：写入 LS 后 `window.dispatchEvent(new CustomEvent('rbac:session-updated'))`；
   - 挂 `AuthProvider` 在 `src/app/layout.tsx` 根 children 外层。
5. `useCurrentUser.ts`：消费 Context，返回 `{ user, role, isLoading, switchToMockRole, forceLogout, hasRole(r), hasAnyRole(rs) }`。
6. `index.ts` 统一 re-export：`export * from './authProvider'; export * from './useCurrentUser'; export * from './audit'; export { AppRole, type AppSessionUser, ALLOWED_ROLES } from '@/types/auth';`。

### Test Requirements

| TR | 类型 | 通过条件 | 对齐 AC |
|---|---|---|---|
| T1-R1 | rule | useCurrentUser() 首次渲染返回 `role = RISK_MANAGER / user.displayName = 'Evan Pan'`，刷新后仍一致 | AC-R2.3 |
| T1-R2 | rule | switchToMockRole('bd_liujia') → setTimeout 50ms 后重新读取 useCurrentUser().role === 'BD_MANAGER' / bdManagerFullName === '刘佳 (Jennifer Liu)' | AC-R2.4 |
| T1-R3 | rule | 清空 `localStorage.rbac_mock_session_v1` → 下次渲染自动恢复 Evan Pan | AC-N3.2 |
| T1-R4 | rule | LS key `rbac_mock_session_v1` 存在，JSON 字段齐全 | AC-N3.1 |
| T1-R5 | rule | 触发一次"未授权访问"场景 → audit.logAuthDeny 打印 JSON 结构正确（含 event / ts / userId） | AC-N5.1 基础 |
| T1-R1-Rub | rubric | 扩展点结构：providers 目录下 mock.ts + supabase.ts 双文件 + index.ts `NEXT_PUBLIC_AUTH_PROVIDER` 分支判定（存在即可，不真接 Supabase），分值 0-2； ≥ 1 通过 | AC-R2.5 |

---

## Task 2：统一数据过滤层 dataScope.ts（**Source of Truth**）

**新增文件**：`src/lib/authz/dataScope.ts`。
**禁止**：任何 `page.tsx / component` 内自己写 `if (role === 'BD_MANAGER')` 过滤数组，必须走这个文件 4 个函数。

### 工作项
导出 4 个纯函数：

1. **`filterClientsByRole(allClients: ClientLike[], user: AppSessionUser): ClientLike[]`**
   - RISK_MANAGER / OPERATIONS → 返回原数组；
   - BD_MANAGER → `c.bdManager === user.bdManagerFullName` 过滤。

2. **`filterBatchDetailClientsByRole`**
   ```ts
   (clients: ClientLike[], user: AppSessionUser) => {
     visible: ClientLike[];        // 自己 BD 行
     redactedPlaceholderRows: Array<{ id: `redacted-${i}`; name: '— 其他 BD 客户（已脱敏）—'; bdManager: '（已隐藏）'; investmentAmount: null /* 或 0 按 UI 决定不显示 */; status: ClientStatus.ACTIVE; __placeholder: true }>;
     totalOriginalCount: number;
   }
   ```
   - 返回 `visible.concat(redactedPlaceholderRows)` 的合并数组（保证总行数 ≠ 过滤后缩水，防止 BD 从"缺行"猜其他 BD 客户数量级）；
   - 占位行保留唯一 id `redacted-${i}`，避免 React key 冲突。

3. **`filterBdStatsByRole`**
   ```ts
   (bdMap: Record<bdFullName: string, { count: number; amount: number; pnl: number }>, user: AppSessionUser) => {
     visibleEntries: Array<[bdName, obj]>;  // RISK=全部 / BD=自己
     aggregatedOthers: null | { label: `其他商务经理（N 位）`; count; amount; pnl; countOthers: number };
   }
   ```
   - BD 视角：其他 N-1 位 BD 聚合为"其他商务经理（N-1 位）"，仅展示 count/amount/pnl 总和，不展开单 BD。

4. **`filterMarginCallsByRole(mcs, user)` —** 简化：本轮不做行级过滤，补仓记录属于批次级风控，BD 允许查看（**与权限矩阵 FR-1 对齐**：批次详情页允许 BD 看宏观行情，补仓记录 Dialog 属于批次宏观信息，客户明细已按位脱敏）。

5. 导出 `RedactedClientPlaceholder` 类型，保证 UI 层类型安全。

### Test Requirements

| TR | 类型 | 通过条件 | 对齐 AC |
|---|---|---|---|
| T2-R1 | rule | RISK 视角 filterClientsByRole → 返回 78 位全量（mock 数据） | — |
| T2-R2 | rule | BD 刘佳 (Jennifer Liu) 视角 filterClientsByRole → 所有返回 client.bdManager === '刘佳 (Jennifer Liu)'，抽样 2 行 clientId 手动与 mockData 对比正确 | AC-R4.2 |
| T2-R3 | rule | BD 视角 filterBatchDetailClientsByRole 后总长度 = 原 clients 长度；且 placeholder 行 name 为脱敏文案；抽样 1 个 placeholder 行确认 investmentAmount = null | AC-R4.2 |
| T2-R4 | rule | filterBdStatsByRole BD 视角：可见条目数 1；aggregatedOthers 非 null，`countOthers = 5`（6 BD 总数 - 1 = 5 位其他） | AC-R4.3 |
| T2-R1-Rub | rubric | 对 T2-R2/T2-R3/T2-R4 双视角 × 3 个 BD（李晓明+王思远+刘佳）抽查，9 组全部通过给 2，通过 7-8 组给 1，≤6 给 0；阈值 ≥ 2 | AC-R4.4 |

---

## Task 3：路由守卫 AuthGuard 组件（替代 middleware.ts，演示模式可用）

**新增文件**：`src/components/auth/AuthGuard.tsx`；`src/app/layout.tsx`（改 toast，放 `<AuthToast />`）。

### 工作项
1. `AuthGuard` Props：
   ```tsx
   { route: string; allowed: AppRole[]; children: React.ReactNode; redirectUnauthorizedTo?: string; showToast?: boolean }
   ```
2. 内部 useCurrentUser() → 若 role ∉ allowed：
   - 调 `logAuthDeny({ action: 'route_blocked', resource: route })`；
   - 触发 `toast.error('当前账号无权限访问该页面，已返回首页')`（用 Shadcn 现有 `sonner` Toast，若项目缺则 `alert()` 降级，再补装 `sonner@latest`，优先装）；
   - 展示"无权限"占位 Card + `<Link href={redirectUnauthorizedTo ?? '/'}>返回风控大盘</Link>`，**不真的做路由跳转**（Client 组件避免闪烁）。
3. 挂载点：
   - `/settings/page.tsx` → `allowed={[RISK_MANAGER]}`；
   - `/alerts/page.tsx`、`/margin-calls/page.tsx` → `allowed={[RISK_MANAGER, OPERATIONS]}`。

### Test Requirements

| TR | 类型 | 通过条件 | 对齐 AC |
|---|---|---|---|
| T3-R1 | rule | BD_MANAGER 访问 `/settings` → 看到 AuthGuard "无权限" 占位 Card，原 settings 表单组件不渲染（浏览器 DOM diff 无 CardContent 原 3 大卡片） | AC-R3.1 |
| T3-R2 | rule | audit.logAuthDeny 被调用，JSON resource === '/settings' | AC-N5.1 |
| T3-R3 | rule | RISK_MANAGER 访问 `/settings` → AuthGuard 通过，原设置表单渲染（no regression） | AC-N4.3 |

---

## Task 4：UI 通用组件 — RoleGate + TopBar 角色切换下拉菜单

### 4.1 RoleGate（声明式组件）
**新增文件**：`src/components/auth/RoleGate.tsx`
```tsx
{ allowed: AppRole[]; children: React.ReactNode; fallback?: React.ReactNode; onDeny?: () => void; auditAction?: string; auditResource?: string }
```
命中 allowed → render children；否则 render fallback（默认 null）+ logAuthDeny。

### 4.2 TopBar 角色切换器（FR-2.4 演示要求）
**修改文件**：`src/components/layout/TopBar.tsx`。
已装 Radix DropdownMenu：`@radix-ui/react-dropdown-menu 2.1.1`。

工作项：
1. 替换 TopBar 右侧原来的 `EV` 文字 + 头像为：
   - 头像圆形 `avatarInitials` + 右侧文字 `displayName` + 下方 11px 角色 Badge（RISK 用 `Badge variant="primary"` / BD 用 `variant="warning"` / OPERATIONS 用 variant=`outline`）；
   - 外层 `<DropdownMenuTrigger asChild><Button variant="ghost" className="gap-2">...</Button>`；
2. `<DropdownMenuContent align="end" className="w-72">`：
   - Header：当前登录人 + 小 badge + `🔄 切换演示账号（Mock）` 11px header；
   - Separator；
   - 7 项 Demo 账号 DropdownMenuItem：
     - 每项图标（Shield = RISK / BriefcaseBusiness = BD）+ 姓名 + 角色 Badge；
     - 点击后 `switchToMockRole(key)`；当前选中项左侧打勾；
   - Separator；
   - 底部 `💾 真实环境（生产）` 次级提示 `authProvider=mock`，TODO 切换 Supabase。
3. 切换完账号后 toast.success(`已切换为 {displayName} ({role})`)。

### Test Requirements

| TR | 类型 | 通过条件 | 对齐 AC |
|---|---|---|---|
| T4-R1 | rule | `<RoleGate allowed={[RISK_MANAGER]}>敏感按钮</RoleGate>` 在 BD 视角下不渲染 children，无 fallback 则 DOM 无该按钮 | AC-FR5.1 |
| T4-R2 | rule | TopBar 下拉有 7 个账号，点击"BD经理 · 刘佳" → useCurrentUser().bdManagerFullName === '刘佳 (Jennifer Liu)' | AC-R2.4 |
| T4-R3 | rule | 切换后刷新 LS key rbac_mock_session_v1 bdManagerFullName 持久化正确 | AC-N3.1 |
| T4-R1-Rub | rubric | 切换到 BD→等待 UI 过滤 → 回到大盘 → 点击卡片 → 批次详情，总计耗时（从 DropdownMenuItem click → 批次详情客户表第一行"其他 BD 客户占位"出现）< 250ms 给 2，< 450ms 给 1，≥ 给 0；阈值 ≥ 1 | AC-N2.1 |

---

## Task 5：大盘 / page.tsx 接入

**修改文件**：`src/app/page.tsx`。
**禁止**：散乱 `if (role === 'BD_MANAGER')` 写数组过滤，所有数据过滤走 `dataScope.ts`。

### 工作项
1. 顶部 `const { role, user } = useCurrentUser();`（默认页面 use client，已有 directive）。
2. BD 分布 KPI / 阶梯条（若用到 BD 聚合数据）→ 走 `filterBdStatsByRole`。
3. 若有"BD业绩穿透入口"按钮 → RoleGate allowed=[RISK_MANAGER]。
4. **批次网格 BatchCardV2**：把 `role + user` 通过 props 传给 BatchCardV2（或 Context，二选一帮 Task 6 省 props）。优先用 **Props 显式传**，避免隐藏依赖：
   ```diff
   -<BatchCardV2 key={b.id} batch={b} />
   +<BatchCardV2 key={b.id} batch={b} viewerRole={role} viewerUser={user} />
   ```

### Test Requirements

| TR | 类型 | 通过条件 | 对齐 AC |
|---|---|---|---|
| T5-R1 | rule | BD 视角大盘能看到 8 批次卡（批次大盘 BD 全可见符合 FR-1 矩阵 / 只读）；CRIT 卡 Footer 3 个按钮（处理补仓/邮件/WA）通过 Task 6 RoleGate 消失，不报错 | — |
| T5-R2 | rule | 风控视角：与本轮修改前大盘 UI / 数据完全一致（no regression，对照 screenshot 节点数） | AC-N4.3 |

---

## Task 6：BatchCardV2 接入 — CRIT 按钮显隐

**修改文件**：`src/components/dashboard/BatchCardV2.tsx`。

### 工作项
1. Props 追加 `viewerRole?: AppRole; viewerUser?: AppSessionUser`（Task 5 传入），默认 `viewerRole ?? 'RISK_MANAGER'`，保证不传也等于现有行为（向后兼容）。
2. Footer 三个高敏按钮用 3 个独立 RoleGate 包：
   - "处理补仓" → `allowed={[RISK_MANAGER]}`；
   - "邮件通知 BD" → `allowed={[RISK_MANAGER]}` auditAction='click' auditResource='card.email_notify'；
   - "WhatsApp 提醒" → `allowed={[RISK_MANAGER]}`。
3. **需求对齐**：FR-1 矩阵 BD → 查看批次 OK，但写操作 × → 这三个按钮对 BD 完全隐藏（不灰化）符合 OQ-Q3 决策。
4. 若 `riskLevel !== CRITICAL` → 原 Footer 正常（"查看详情"Link 永远对 BD/Risk 可见）。

### Test Requirements

| TR | 类型 | 通过条件 | 对齐 AC |
|---|---|---|---|
| T6-R1 | rule | BD 视角 CRIT 卡 Footer：仅"查看详情"Link 保留，无处理补仓/邮件/WA 按钮（browser_snapshot interactive 节点无该 3 按钮） | AC-FR5.2 (卡1) |
| T6-R2 | rule | 风控视角 CRIT 卡 Footer 三按钮仍存在（no regression） | AC-N4.3 |
| T6-R3 | rule | 点击 BD 视角 "查看详情" → 路由跳转正常（不因缺 props 报错 / 卡死） | 兼容 |

---

## Task 7：批次详情 BatchDetailContent 接入（最高风险页面）

**修改文件**：`src/components/batch/BatchDetailContent.tsx`；`src/components/clients/AddClientDialog.tsx`。

### 工作项 7.1 BatchDetailContent 自身
1. 从 useCurrentUser() 拿 `{ role, user }`（已有 'use client'）。
2. 右上角按钮组：
   - `邮件通知 BD / WhatsApp 提醒 / 确认补仓 $N` 三个按钮用 RoleGate `allowed={[RISK_MANAGER]}` 包裹；其中"补仓记录 N"按钮对 BD / Risk **都可见**（补仓记录是批次宏观行情，可看，已与 FR-1 矩阵一致）；
3. "客户明细穿透" 卡：
   - 数据源 `clients` 走 `filterBatchDetailClientsByRole(clients, user)` → 合并 visible + placeholderRows；
   - Placeholder 行在 Table 渲染时 name 用 `text-muted-foreground italic`；投资/收益列渲染 `'—'`；操作列空；
   - **Search / BD filter**：BD 视角下 `combobox "全部 BD"` → 只允许选中"自己"，其他 BD 项 `<SelectItem disabled>`（避免 BD 通过 filter 下拉看到其他 BD 姓名泄露）；
4. "BD 经理资金分布" 卡：走 `filterBdStatsByRole` → 仅显示自己 1 条 + 聚合 1 条"其他商务经理（N-1 位）"。
5. 顶部"新增客户" Button：永远可见（BD 也能新增，但 Dialog 内部会锁定 BD 字段，FR-6），但操作列"客户行编辑/删除"：
   - 编辑 → 仅该行属于自己 BD 时显示（BD）；风控永远显示；
   - 删除 → RoleGate `[RISK_MANAGER]`。

### 工作项 7.2 AddClientDialog BD 字段锁定
1. 新增 Props：`lockedBdManager?: string`；若存在：
   - BD 下拉 `<Select value={lockedBdManager} disabled>`；
   - Select 下方 `<p className="text-[11px] text-success mt-1"><CheckCircle2 className="inline h-3 w-3 mr-1" />🔒 已自动锁定为当前登录账号</p>`；
2. 调用 AddClientDialog 的地方（BatchDetailContent.tsx 内）：
   - `viewerRole === 'BD_MANAGER'` → 传 `lockedBdManager={viewerUser.bdManagerFullName}`；
   - Risk → 不传（默认可自由选）。

### Test Requirements

| TR | 类型 | 通过条件 | 对齐 AC |
|---|---|---|---|
| T7-R1 | rule | BD 视角右上角：**没有**"邮件/WA/确认补仓"3 按钮；仅补仓记录、导出明细可见 | AC-FR5.2 (详情页按钮) |
| T7-R2 | rule | BD 视角客户明细表：自己客户行 name 正常，其他 BD 客户行全部为 `— 其他 BD 客户（已脱敏）—`；抽样 18 行（batch-2026-008）计算：可见非脱敏行数 = mockData 中该批次 bdManager='刘佳' 的行数，二者相等 | AC-R4.2 + FR-1 |
| T7-R3 | rule | BD 视角 BD 下拉 combobox 其他 BD 项 disabled | 防泄露 |
| T7-R4 | rule | BD 打开 AddClientDialog → BD Select disabled；绿色锁定提示出现；风控打开无 | AC-FR6.1 + 6.2 |
| T7-R5 | rule | 风控视角客户明细表 18 行姓名全可见（no regression） | AC-N4.3 |

---

## Task 8：/clients 客户管理页接入

**修改文件**：`src/app/clients/page.tsx`。

### 工作项
1. useCurrentUser()。
2. `allClients = filterClientsByRole(useMemo 原数组, user)`。
3. BD 视角：
   - BD combobox 只允许选中自己（其他 disabled）；
   - "新增客户"按钮可见；打开 AddClientDialog（若 clients 页也有）同样传 `lockedBdManager`；
4. RISK 视角无变化（no regression）。

### Test Requirements

| TR | 类型 | 通过条件 | 对齐 AC |
|---|---|---|---|
| T8-R1 | rule | BD 刘佳视角 /clients：返回表每行 bdManager === '刘佳 (Jennifer Liu)'；Grep DOM 无"李晓明"字符串 | AC-R1.2 客户行隔离 |
| T8-R2 | rule | RISK 视角 /clients：78 位全可见（对照 mockData 总数 78） | AC-N4.3 |

---

## Task 9：/settings 设置页守卫 & 风控收件人保留风控可见

**修改文件**：`src/app/settings/page.tsx`（已重写收件人 Card 于本轮需求1）。

### 工作项
1. 整个 settings 根组件 return 内容外层包：
   ```tsx
   <AuthGuard route="/settings" allowed={[RISK_MANAGER]}>
     {/* 原 4 大 Card：风控阈值 / 通知渠道 / 收件人管理 / 数据源 */}
   </AuthGuard>
   ```
   （右侧栏分成档位 + 系统信息：也放在 AuthGuard 里，BD 不应该看到任何系统设置细节）
2. 若 T3 已装 sonner toast，settings 守卫拒绝时弹 toast.error(`仅风控总监可访问系统设置`)。

### Test Requirements

| TR | 类型 | 通过条件 | 对齐 AC |
|---|---|---|---|
| T9-R1 | rule | BD /settings → 看到 AuthGuard 占位；DOM 无"风控阈值配置"、"风控收件人管理"Card Title 文字 | AC-R3.1 + FR-1 (矩阵 settings ✗) |
| T9-R2 | rule | RISK /settings → 4 大 Card 全渲染（no regression，对比上轮截图节点数） | AC-N4.3 |

---

## Task 10：全局 tsc / next build / 三场景双视角验收

### 工作项
1. `npx tsc --noEmit 2>&1 | tail -80` → exit 0。
2. `npx next build 2>&1 | tail -80` → 9/9 routes exit 0。
3. 三账号验收（每账号打开 `/` → `/batch/batch-2026-008` → `/clients` → `/settings` 4 个页面，录 browser_snapshot）：
   - A 组：RISK · Evan Pan（no regression 基线）
   - B 组：BD · 刘佳（Jennifer Liu）
   - C 组：BD · 李晓明（Evan Li）
4. 对 B/C 组分别运行：
   - `page.tsx`：8 批次卡存在 + CRIT 卡 Footer 仅"查看详情"
   - `/batch/batch-2026-008`：右上角无补仓按钮；客户表自己客户正常 + 其他 BD 已脱敏；BD 分布 1 条自己 + 聚合；
   - `/clients`：只有自己名下客户；
   - `/settings`：AuthGuard 占位；
   - 新增客户 Dialog：BD 字段锁定。

### Test Requirements

| TR | 类型 | 通过条件 | 对齐 AC |
|---|---|---|---|
| T10-R1 | rule | tsc --noEmit exit 0 | AC-N4.1 |
| T10-R2 | rule | next build 9/9 routes exit 0 | AC-N4.2 |
| T10-R3 (T2-R1-Rub 实际执行) | rubric | 三账号 × 4 页面 × 5 关键检查点 = 60 节点；58+ 通过 = 2 分；55-57 = 1 分；≤ 54 = 0 分；阈值 ≥ 2 | AC-R4.4 |

---

## 验收覆盖矩阵（Review 最终对照）

| Spec AC | 对应 Task TR |
|---|---|
| AC-R1.1 | T0-R1 |
| AC-R1.2 (15 项矩阵) → 拆分 T5/T6/T7/T8/T9 各子 TR | T6-R1, T7-R1, T8-R1, T9-R1, + FR-1 备注 |
| AC-R2.1 | T1-R1 |
| AC-R2.2 | Task 1 类型定义 + T1-R2（字段验证） |
| AC-R2.3 | T1-R1 |
| AC-R2.4 | T4-R2 |
| AC-R3.1 | T3-R1, T9-R1 |
| AC-R4.1 | 代码走读：4 函数 dataScope.ts 存在 |
| AC-R4.2 | T2-R2, T2-R3, T7-R2 |
| AC-R4.3 | T2-R4 + Task 7 BD 分布渲染检查 |
| AC-FR5.1 | T4-R1 |
| AC-FR5.2 | T6-R1, T7-R1, 抽查 settings 入口 |
| AC-FR6.1 / 6.2 | T7-R4 |
| AC-FR7.1 / 7.2 | T0-R1, T0-R3 |
| AC-N1.1 | T0-R2 |
| AC-N3.1 / 3.2 | T1-R3, T1-R4, T4-R3 |
| AC-N4.1 / 4.2 / 4.3 | T10-R1, R2, T5-R2, T6-R2, T7-R5, T8-R2, T9-R2 |
| AC-R2.5 | T1-R1-Rub |
| AC-R4.4 | T2-R1-Rub + T10-R3 实际执行 |
| AC-N2.1 | T4-R1-Rub |
| AC-N5.1 | T1-R5 + T3-R2 + RoleGate onDeny 日志 |
