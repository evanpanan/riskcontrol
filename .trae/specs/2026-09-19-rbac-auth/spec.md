# 规格：优先劣后风控预警系统 — RBAC 账号与权限体系

## 1. Problem & Users

### 1.1 问题（Problem）
现版优先劣后风控预警系统**无任何账号与权限体系**，任何访问者均可：
- 查看所有 8 个批次大盘、所有 78 位客户穿透数据、所有 BD 经理业绩；
- 执行"确认机构补仓"、"修改风控阈值"、"发送邮件/Webhook 预警"等高敏核心写操作；
- 修改/新增非本人名下客户信息；

这在真实金融资管场景下存在严重合规风险与数据泄露隐患。

### 1.2 用户角色（Users）
| 内部角色 ID | 中文名称 | 典型账号（演示） | 人员规模参考 |
|---|---|---|---|
| `RISK_MANAGER` | 风控经理 / 风控总监 / 高管 | Evan Pan（风控总监） | 2-5 人 |
| `BD_MANAGER` | 商务经理 / BD 经理 | 李晓明 / 王思远 / 张志强 / 刘佳 / 陈志远 / 林晓雯 | 6-20 人 |
| `OPERATIONS`（可选保留） | 运营/结算 | — | 1-3 人 |

### 1.3 目标（Goals）
1. **最小可用 RBAC 闭环**：角色定义 → 登录鉴权 → 路由中间件校验 → 前端按钮显隐 → 后端数据层行级过滤，一次打通；
2. **演示可切换性**：无真实 OAuth / SSO 环境下，顶部导航内置 Mock 角色切换器，一键切换"风控总监 / 各 BD 经理"，便于产品演示；
3. **生产可扩展性**：所有 Mock 鉴权接口按 Supabase Auth / Auth.js (Next-Auth) 标准结构封装，未来接入真实身份提供商（Supabase Email+Pwd / Google / Azure AD / 企业 SSO）**仅需替换 Auth Provider 实现，业务代码零改动**；
4. **零破坏**：`RISK_MANAGER` 默认等同于当前"完全访问"，`BD_MANAGER` 严格行级隔离，不改变已有大盘数据计算口径与 UI 结构。

### 1.4 非目标（Non-Goals）
- 不接入真实第三方 OAuth（Google/企业微信/钉钉/飞书），仅保留 Provider 钩子；
- 不做复杂组织架构（部门/团队/多租户），仅保留单组织单层角色；
- 不做"自定义角色/细粒度 CRUD 权限矩阵"（如 per-entity per-action ACL），仅保留枚举 3 角色的硬编码判定；
- 不做密码强度校验、邮箱验证、MFA、审计日志等合规能力（可列 Roadmap 预留）；
- 不改变 Mock 数据驱动的开发架构（当前无真实 DB 写入），仅在**数据访问层（getMockData 包一层）**做角色过滤。

---

## 2. Functional Requirements（功能需求）

### FR-1 角色与权限矩阵
**AC-R1.1 rule：** 定义枚举 `AppRole = RISK_MANAGER | BD_MANAGER | OPERATIONS`，并在 Prisma `AppUser.role` 字段落地；
**AC-R1.2 rule：** 如下权限矩阵 100% 满足（✓=允许，✗=拒绝）：

| 能力项 / 资源 | RISK_MANAGER | BD_MANAGER | OPERATIONS |
|---|---|---|---|
| 查看风控大盘（/ page.tsx）所有批次 | ✓ 全量 | ✓ 全量（只读，不显示"处理补仓"按钮） | ✓ 全量 |
| 查看所有客户穿透（/clients） | ✓ 全量 78 位 | ✗ 仅 `client.bdManager === currentUser.displayName` 行 | ✓ 全量 |
| 查看所有 BD 业绩分布（大盘 & 批次页 BD 分布卡） | ✓ 全部 BD | ✗ 仅自己 BD 条目，其他 BD 显示为"其他 BD（已脱敏）"，金额聚合不显示单客金额 | ✓ 全量 |
| 进入批次详情页（/batch/[id]） | ✓ 全量，所有客户可见 | ✓ 仅自己名下客户可见，其他 BD 客户行替换为"其他 BD 客户（已脱敏）"，总数/合计金额保留聚合 | ✓ 全量 |
| 创建批次（新增按钮，预留入口） | ✓ | ✗ | ✗ |
| 确认机构补仓（大盘 CRIT 卡 / 批次详情 CRIT 按钮） | ✓ | ✗ 隐藏按钮 | ✗ |
| 发送邮件 / Webhook / WhatsApp 预警 | ✓ | ✗ 隐藏按钮 | ✗ |
| 修改风控阈值 / 通知渠道 / 收件人管理（/settings） | ✓ 全模块可写 | ✗ 路由中间件 302 拒绝 | ✗ 仅"通知渠道"只读 |
| 新增 / 编辑客户 | ✓ 任意 BD | ✓ 仅新增且 BD 字段**自动锁定为自己**，不可改 | ✗ 只读 |
| 删除客户 | ✓ 任意 | ✗ | ✗ |
| 查看系统设置 / 分成档位 / API Key | ✓ 全量读写 | ✗ 中间件拦截 | ✗ 只读无 API Key 明文 |

### FR-2 认证体系（双轨：Mock Session + Supabase Auth 可切换）
**AC-R2.1 rule：** 前端存在统一 Hook `useCurrentUser(): { user: AppSessionUser | null; role: AppRole; isLoading; switchToMockRole(role, mockUserId?): Promise<void> }`；
**AC-R2.2 rule：** `AppSessionUser` 至少含字段：
```ts
{ id: string; email: string; role: AppRole; displayName: string; avatarInitials: string; bdManagerFullName?: string /* BD 专属：匹配 client.bdManager 字段 */ }
```
**AC-R2.3 rule（演示模式 Mock）：** 首次访问无 session 时自动以 `RISK_MANAGER` 演示账号"Evan Pan / evan.pan@institution.com"登录，写入 `localStorage.rbac_mock_session`；
**AC-R2.4 rule（演示模式切换器）：** 顶部导航右侧当前登录用户点击展开后，列表显示：
  - 风控总监 · Evan Pan (RISK_MANAGER)
  - BD经理 · 李晓明 (Evan Li)
  - BD经理 · 王思远 (Sylvia Wang)
  - BD经理 · 张志强 (Jack Zhang)
  - BD经理 · 刘佳 (Jennifer Liu)
  - BD经理 · 陈志远 (Daniel Chen)
  - BD经理 · 林晓雯 (Sharon Lin)
点击任何一项立即切换 `AppSessionUser`，并触发**全局权限状态刷新**（React Context + Event Dispatch）；
**AC-R2.5 rubric：** 生产可扩展性评分 [0-2]
  - 2 = `auth.ts` 内部完全封装 3 Provider 分支：`mock | supabase | next-auth`，通过 `.env.NEXT_PUBLIC_AUTH_PROVIDER` 切换，业务代码（UI / 中间件 / 数据层）完全看不到分支；
  - 1 = 分支散落在 2-3 个函数内；
  - 0 = 硬编码 mock，无扩展点。

### FR-3 路由级中间件校验
**AC-R3.1 rule：** 存在 `src/middleware.ts` 或 `src/app/*/layout + server guard` 组合（Next 14 App Router 推荐），实现：
  - `/settings*`：仅 `RISK_MANAGER` 可进入，其他角色 302 → `/` 并带 `?error=no_permission_settings` toast；
  - `/alerts*`、`/margin-calls*`：仅 `RISK_MANAGER | OPERATIONS`；
  - `/market*`：全部登录用户；
  - 其余路由（`/`、`/clients`、`/batch/[id]`）：登录即可；
**AC-R3.2 rule：** 未登录（非演示模式）统一 302 → `/login`（预留页面，演示模式自动登录不会命中）。

### FR-4 数据访问层行级过滤（Business Source of Truth）
**AC-R4.1 rule：** 新增 `src/lib/authz/dataScope.ts` 统一封装**唯一判定入口**：
```ts
filterClientsByRole(allClients: Client[], user: AppSessionUser): Client[]
filterBdStatsByRole(bdMap: Record<bdName, any>, user: AppSessionUser): { visible: Record; redactedOthersCount: number }
filterMarginCallsByRole(mcs: MarginCall[], user: AppSessionUser): MarginCall[]
filterBatchDetailClientsByRole(clients: Client[], user: AppSessionUser): { visible: Client[]; redactedRows: RedactedClientPlaceholder[] }
```
**严禁**在 6+ 个 UI 组件里分别写 `if (role === 'BD_MANAGER')` 分支。所有数据过滤必须走以上 4 函数，便于未来审计与扩展；
**AC-R4.2 rule：** BD_MANAGER 数据隔离判定条件：
  - 仅保留 `client.bdManager === user.bdManagerFullName`（用户模型 `bdManagerFullName` 字段严格等于 Client.bdManager 中文字段，如"李晓明 (Evan Li)"）；
  - 其他 BD 客户在批次详情页客户表中保留占位行：`name = "— 其他 BD 客户（已脱敏）—"`、`投资金额 = 不显示`、`状态 = ACTIVE`、`操作列 = 空`，数量保留以便总行数和聚合总金额仍正确；
**AC-R4.3 rule：** 大盘 BD 分布卡（RiskLadderBar 与批次详情 BD 卡）中，BD_MANAGER 角色：
  - 仅显示**自己一条**（高亮 primary 边框）；
  - 其他 BD 聚合为一行"其他商务经理（N 位）"显示总人数 / 总投资占比，**不展开**单 BD 条目；
**AC-R4.4 rubric：** 数据过滤一致性评分 [0-2]
  - 2 = 所有 page（`/`、`/clients`、`/batch/[id]`）在 RISK_MANAGER vs BD_MANAGER 双视角下抽查 3 个 BD 账号，可见行/聚合完全一致无泄露；
  - 1 = 偶有 1 处泄露（如搜索框可搜到其他 BD 客户名）；
  - 0 = 多处泄露。

### FR-5 前端按钮 & UI 元素权限控制（声明式组件）
**AC-FR5.1 rule：** 新增声明式组件 `src/components/auth/RoleGate.tsx`：
```tsx
<RoleGate allowed={[RISK_MANAGER]} fallback={<LockedHint />}>
  <Button>确认补仓</Button>
</RoleGate>
```
**AC-FR5.2 rule：** 以下按钮/卡片严格按 FR-1 矩阵控制显隐（抽查每个页面至少 1 处确实消失/锁定）：
- 大盘 CRIT 卡 Footer：`处理补仓`、邮件通知、WA 通知 → BD 隐藏；
- 批次详情页右上角：`确认补仓 $N` → BD 隐藏；
- 批次详情页客户表列 `操作 → 编辑 / 删除` → BD 仅自己名下客户显示"编辑"，删除隐藏；
- 客户管理页顶部 `新增客户` → BD 可见但打开的 Dialog BD 字段 Select 锁定（disabled + 默认 `user.bdManagerFullName`）；
- TopBar / 左侧菜单 / 大盘 KPI"设置"入口 → BD 看不到；
- 设置页整体 → BD 被中间件 302（FR-3.1）。

### FR-6 新增客户锁定 BD 字段
**AC-FR6.1 rule：** BD_MANAGER 打开 `AddClientDialog.tsx` 时：
- `BD 经理` Select / Combobox 字段 → `disabled` + `value = 当前 user.bdManagerFullName`；
- Select 下方出现一个绿色提示 Badge：`🔒 已自动锁定为当前登录账号`；
**AC-FR6.2 rule：** RISK_MANAGER 打开 Dialog 时 Select 可自由选 6 位 BD（行为与现网一致）。

### FR-7 数据库 Schema（Prisma PostgreSQL）扩展
**AC-FR7.1 rule：** `prisma/schema.prisma` 新增：
  - 枚举 `AppRole { RISK_MANAGER BD_MANAGER OPERATIONS }`
  - 模型 `AppUser`（字段：`id cuid pk / email @unique / passwordHash? / displayName / role AppRole / avatarInitials / bdManagerFullName? / lastLoginAt? / createdAt / updatedAt`）
  - 模型 `Session`（`id / userId / expiresAt / token @unique / ipAddr? / userAgent? / createdAt`）
  - `Client` 模型新增**可选**外键：`bdUserId String?` + `bdUser AppUser? @relation("BdToClients", fields: [bdUserId], references: [id])`；保留原 `bdManager String` 做兼容（双写过渡期）；
**AC-FR7.2 rule：** 为演示模式预置 7 条种子 SQL / seed.ts：
  - RISK_MANAGER：Evan Pan / evan.pan@institution.com
  - BD_MANAGER：李晓明 / 王思远 / 张志强 / 刘佳 / 陈志远 / 林晓雯（6 人，邮箱与 bdManagerFullName 对应 Client 字段）。

---

## 3. Non-Functional Requirements（非功能）

### NFR-1 类型安全
**AC-N1.1 rule：** 所有权限判定字符串 `RISK_MANAGER / BD_MANAGER / OPERATIONS` 均走 TypeScript 联合字面量 + `as const`，不允许任何裸字符串 `'RISK_MANAGER'` 散落在业务代码（Grep "RISK_MANAGER" 定位全部命中点必须在 enum/const 文件）。

### NFR-2 演示切换性能
**AC-N2.1 rule：** 角色切换 → 大盘/客户表/批次详情 3 个页面**首屏渲染 + 过滤** < 250ms（78 位客户 Mock 数据量级），不出现明显白屏。

### NFR-3 持久化
**AC-N3.1 rule：** Mock Session 持久化到 `localStorage.rbac_mock_session`，刷新不丢；
**AC-N3.2 rule：** 清除 localStorage 后自动恢复默认 `RISK_MANAGER Evan Pan` 登录。

### NFR-4 向后兼容
**AC-N4.1 rule：** `tsc --noEmit` exit 0；
**AC-N4.2 rule：** `next build` 9/9 routes 构建通过；
**AC-N4.3 rule：** RISK_MANAGER 登录后，现有功能（CRIT 处理补仓 / 新增客户 / 设置阈值 / 补仓记录 Dialog）100% 行为与本轮修改前完全一致（no regression）。

### NFR-5 可审计性
**AC-N5.1 rubric：** 权限日志（console 级别，演示期不写 DB）评分 [0-2]
- 2 = 所有拒绝访问事件（中间件 302 / RoleGate fallback / 行过滤命中）console 输出统一结构化 JSON：`{ ts, userId, role, action:"access_denied", resource:"/settings", reason:"role_not_in_allowed_list" }`；
- 1 = 仅有零散日志；
- 0 = 无日志。

---

## 4. Constraints & Dependencies

### 4.1 约束（Constraints）
1. **不改技术栈主链**：Next.js 14.2.8 App Router + TypeScript + Prisma 5.18 + Shadcn UI + Tailwind，**不新增 Auth.js (Next-Auth)** 以避免 Next 14 版本冲突（用户给了 Next-Auth 或 Supabase Auth 二选一，因已装 `@supabase/supabase-js: 2.45.4` → **默认走 Supabase Auth 抽象**，内部仍 Mock 实现）；
2. **不依赖真实 Supabase 项目**：所有 `supabase.auth.*` 调用均走 `src/lib/auth/providers/supabase.ts` 下 Mock，不发网络请求；
3. **零后端 Route Handler**（本轮）：鉴权均在客户端 Context + 数据层函数完成（因项目当前以 Mock 驱动，下一轮接入真实 DB 时加 Server Actions）。

### 4.2 依赖（Dependencies）
已装依赖直接复用：`@supabase/supabase-js: 2.45.4`（已存在 `package.json` L23）、`@radix-ui/react-dropdown-menu: 2.1.1`（已装 L17）→ 用于顶部角色切换下拉菜单（现已有 DropdownMenu，避免手写 Popover）。

### 4.3 假设（Assumptions）
1. `Client.bdManager` 字段格式：`"李晓明 (Evan Li)"`（中文字 + 英文括号，6 BD 已验证匹配现 mockData），与演示账号 `AppUser.bdManagerFullName` 1:1 对齐；
2. BD 经理不允许跨批次访问不属于自己客户的投资明细，但允许看到**批次的总市值/跌幅/风险等级**（因为 BD 要知道自己客户所在批次是否安全），这一点在 FR-1 矩阵已标注；
3. 本轮不引入密码登录，演示模式 7 个账号一键切换（真实密码登录放 Roadmap）。

### 4.4 开放问题（Open Questions）
本轮 **User-Autonomy-Resolve** 不需用户确认，决策如下（写进 Spec 便于审计）：

| OQ | 决策 | 理由 |
|---|---|---|
| Q1：OPERATIONS 角色要不要本轮落地 UI？ | 要落地 Type 枚举 + 种子 1 个账号，但不做专属菜单/按钮（ROADMAP 预留） | 避免枚举缺字段导致未来破 Schema |
| Q2：中间件用 `middleware.ts` 还是每个路由 `export const dynamic / authorize()`？ | `src/app/*/page.tsx 内顶部 <AuthGuard route="/xxx" /> Client 组件 wrapper` | 演示模式 100% Client Context，Next middleware 的 Edge Runtime 拿不到 localStorage Mock Session，改用 Client Guard 简单可靠；真实 Supabase Auth 时再换 middleware |
| Q3：BD_MANAGER 在大盘看到的 CRIT 批次卡"处理补仓"按钮，直接隐藏还是灰掉+Tooltip？ | 直接隐藏 | 合规最小惊讶原则：不可执行的动作不应出现在 BD 界面，避免误触投诉 |

---

## 5. Acceptance Criteria 汇总（AC）

### rule 类（可二值验证，全部通过 = 功能正确）
| AC 编号 | 简述 |
|---|---|
| AC-R1.1 | Prisma 新增 AppRole 枚举 & AppUser/Session 模型 & Client.bdUserId FK |
| AC-R1.2 | FR-1 权限矩阵 15 项全通过（抽查 RISK_MANAGER vs BD_MANAGER 各页面） |
| AC-R2.1 | `useCurrentUser()` Hook 存在并暴露统一接口 |
| AC-R2.2 | AppSessionUser 字段：id/email/role/displayName/avatarInitials/bdManagerFullName? |
| AC-R2.3 | 首次访问自动以 RISK_MANAGER 登录，LS 持久化 |
| AC-R2.4 | 顶部导航下拉可切换 7 个演示账号，切换后全局刷新过滤 |
| AC-R3.1 | /settings* 对 BD 302 拒绝；/alerts、/margin-calls 仅风控/运营 |
| AC-R4.1 | dataScope.ts 存在 4 个过滤函数，UI 禁止散落 role if |
| AC-R4.2 | BD 客户行严格按 bdManagerFullName 过滤 + 其他 BD 脱敏占位行 |
| AC-R4.3 | BD 视角大盘 BD 分布其他 BD 聚合为"其他商务经理 N 位" |
| AC-FR5.1 | RoleGate 组件存在 & Props 正确 |
| AC-FR5.2 | 6 处关键按钮/卡片在 BD 视角消失（抽查 2 个 BD 账号） |
| AC-FR6.1 | BD 打开 AddClientDialog 时 BD 字段 disabled + 绿色锁定 Badge |
| AC-FR6.2 | 风控打开 AddClientDialog BD 字段可自由选 |
| AC-FR7.1 | Prisma schema 新增 AppRole/AppUser/Session/Client bdUserId |
| AC-FR7.2 | seed.ts / SQL 预置 7 条演示账号 |
| AC-N1.1 | 裸字符串 role Grep 零命中（除定义处外） |
| AC-N3.1 | Mock Session 存 LS，刷新不丢 |
| AC-N3.2 | 清 LS 恢复 Evan Pan |
| AC-N4.1 | tsc --noEmit exit 0 |
| AC-N4.2 | next build 9/9 routes 构建通过 |
| AC-N4.3 | RISK_MANAGER 视角现有功能 100% no regression |

### rubric 类（评估性）
| AC 编号 | 维度 | 分值阈 | 达标线 |
|---|---|---|---|
| AC-R2.5 | Auth 生产扩展性 | 0-2 | ≥ 1 |
| AC-R4.4 | 数据过滤一致性（双视角 3 BD 抽查） | 0-2 | ≥ 2 |
| AC-N2.1 | 角色切换性能首屏 | 0-2（<250ms=2 / <450ms=1 / ≥=0） | ≥ 1 |
| AC-N5.1 | 拒绝事件结构化日志 | 0-2 | ≥ 1 |

**总通过率：rule 全通过 + rubric 每项 ≥ 达标线 = Spec 通过。**
