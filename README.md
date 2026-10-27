# RiskControl

股票结构化产品的机构风控、人工记账和客户退出管理。当前版本采用服务端 PostgreSQL 账本，不会在生产环境自动生成模拟客户，也不接受公开演示账号登录。

## 本次修复

- 数据库账号创建、登录、停用与权限变更闭环；随机盐 scrypt 密码哈希；旧 SHA-256 凭据在成功验证后升级。
- 必须显式配置至少 32 字符的会话密钥。签名会话同时在数据库登记；登出、停用、改角色或重置密码撤销会话。各业务接口每次读取当前账号状态。
- 核心账本位于 LedgerBatch；客户端只保留当前账号有权读取的临时快照。商务经理以 bdUserId 绑定客户。
- 补仓、退出申请、结算等采用明确的服务端命令、批次版本比较、请求幂等键，以及账本和审计同一数据库事务。禁止上传整份客户端余额覆盖数据库。
- 已入账本金、签约日期与归属不可通过普通客户编辑直接改写；有资金记录的客户不可删除，须走结算流程。
- 财务阈值与新合同分成配置服务端保存；历史合同分成快照保持不变。
- 退出按配置的锁定日期、通知期、季度窗口、最终到期日计算；月份相加按 UTC 月末截断。
- NYSE 日历覆盖 2026–2028 节假日与公布的提前收市。超出覆盖期的 T+2 计算会明确拒绝，需先更新日历。
- 行情抓取时间与来源成交时间分开记录。无来源时间的报价仅供展示；资金操作需要 15 分钟内的有效来源时间或管理员人工确认的参考价。
- Next.js 15.5.28 与传递依赖安全更新；Excel 导出改用 ExcelJS，不开放不可信文件解析入口。

## 安装与首次运行

使用 Node.js 20.19+ 或 22 LTS、PostgreSQL。推荐 Node 22 LTS；本次另在 Node 25.8.0 完成构建和回归。

```sh
npm ci
cp .env.example .env
```

编辑 .env，配置：

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/risk_control
DIRECT_DATABASE_URL=postgresql://user:password@localhost:5432/risk_control
NEXT_RC_AUTH_SECRET=至少32字符的随机密钥
ADMIN_EMAIL=管理员真实邮箱
ADMIN_PASSWORD=至少12字符的独立密码
ADMIN_NAME=系统管理员
```

生成密钥可运行 `openssl rand -hex 32`。不要提交 .env。首次管理员初始化只创建新账号，不会覆盖已有密码。

```sh
npm run db:push
npm run db:bootstrap
npm run dev
```

管理员创建后，从运行环境移除 ADMIN_PASSWORD。在系统设置创建启用的商务经理账号后，才可为客户分配归属。

生产运行：

```sh
npm run build
npm start
```

生产数据库不可用时，登录和资金操作拒绝执行。不会退回浏览器模拟账本。

## 从旧版本升级

1. 先备份 PostgreSQL 和每个曾记账浏览器的本地台账导出文件，保存原始成交、结算凭证。
2. 新安装使用 db:push；已部署旧 schema 的数据库可先审核 `prisma/migrations/20261027_authoritative_ledger_auth/migration.sql`，再在维护窗口应用。该脚本只增加字段和表，不会抹除旧表。
3. 原仓库历史迁移缺少完整初始建表迁移；不要在没有核对迁移历史的数据库上直接执行 migrate deploy。按现有部署的基线管理方案应用上述增量 SQL。
4. 新账本默认是空的。旧 localStorage 或旧 Batch/Client 表不会自动被认定为已核验的真实资金台账，也不会自动导入。应对照凭证逐批迁移并完成余额、客户归属和历史结算对账，不能把模拟数据直接导入生产。
5. 生产演示密码已停用；已有数据库账号若未设置有效凭据，需要管理员重新初始化或重置密码。不要恢复原来的演示账号回落。
6. 轮换原有会话密钥。旧 JWT 没有数据库会话登记，升级后自动失效。

## 业务边界

- 当前支持人工确认参考价和机构补仓记账；没有实际下单、划款或自动券商同步，BROKER_SYNC_ENABLED 仍为 false。系统“已入账”不能替代银行流水和券商成交凭证。
- 默认退出规则：锁定六个月，之后每三个月开放一次，每次 14 个自然日，提前通知 15 个自然日，最终期限两年。到期后不受季度窗口限制，但仍要提交退出申请并满足通知期。14 天沿用原产品已有窗口宽度表达，**正式使用前必须按签署协议核对**；服务端合同字段支持配置窗口天数、周期和具体日期。
- 后加入的客户拥有独立的六个月锁定日期，并受批次最终到期日约束。新增客户以批次当前有效参考价认购；服务端拒绝客户端自行指定更早的锁价。需要追补历史成交的业务，应另建凭证核验流程。
- 有资金记录的删除、事后改本金或改归属均被拒绝。客户端旧表单里的同名控件不会绕过这些规则。
- 行情和通知服务须自行配置授权。通知仍需要服务端会话角色及通知授权码；测试不发送真实 Email/WhatsApp。
- 机构财务规则只有管理员可保存；浏览器本地偏好不是服务端计算依据。
- 退出窗口、交易日和费用规则不能替代正式协议确认。NYSE 特殊临时休市如有变更，必须更新日历。

## 验证

```sh
npx tsc --noEmit
npm run lint
npm test
npm run verify:boundaries
node --import tsx scripts/check-finance.ts
node --import tsx scripts/check-test-data.ts
node --import tsx scripts/check-notifications.ts
node --import tsx test_datascope_rbac.ts
npm run build
npm audit
```

`verify:server` 是有写入行为的本地集成测试，仅允许 localhost 服务和名称为 riskcontrol_fix 的隔离数据库。先在该库建表，以 `audit-admin@example.invalid`、测试专用密码 `LocalAudit2026!Only` 初始化测试管理员，然后启动 3019 端口的生产服务，设置 DATABASE_URL 后运行：

```sh
npm run verify:server
```

测试覆盖账号创建登录、两位商务经理隔离、双会话读同一结算、并发补仓、幂等请求、审计故障事务回滚、退出结算守恒、登出撤销和禁用账户。通知只使用替身，不代表外部送达验收。

如需演示模拟数据，只可在 development 中显式设置 `NEXT_PUBLIC_RC_DATA_MODE=demo`。它用于本地展示和函数回归，不是多人账本；生产无论该开关为何值都使用服务器账本。

历史产品说明归档于 docs/legacy-demo-notes.md，其中的模拟数据、演示账号和审计完成标识不适用于当前部署。
