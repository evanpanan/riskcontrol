# RiskControl 生产镜像（Next.js 15 + Prisma）
# 说明：本地未安装 Docker，本文件尚未在本机构建验证，首次在服务器构建时请留意日志。

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---- 依赖层 ----
FROM base AS deps
COPY package.json package-lock.json* ./
# 跳过 postinstall（此时尚无 prisma/schema.prisma，generate 会失败）；
# Prisma Client 在构建层显式生成，运行层直接复用构建层产物。
RUN npm ci --ignore-scripts

# ---- 构建层 ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---- 运行层 ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

# 运维工具链：加密备份 / 恢复（scripts/operations/backup.ts）依赖 pg_dump、pg_restore、psql。
# 必须装 PostgreSQL 16 客户端：低版本 pg_dump 遇到 16 服务端会直接拒绝执行
# （Debian bookworm 自带的 postgresql-client 是 15，故走 PGDG 官方源）。
RUN apt-get -o Acquire::Retries=3 update \
  && apt-get -o Acquire::Retries=3 install -y --no-install-recommends curl gnupg \
  && curl -fsSL --retry 3 https://apt.postgresql.org/pub/repos/apt/ACCC4CF8.asc -o /usr/share/keyrings/postgresql.asc \
  && echo "deb [signed-by=/usr/share/keyrings/postgresql.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get -o Acquire::Retries=3 update \
  && apt-get -o Acquire::Retries=3 install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y --auto-remove curl gnupg \
  && rm -rf /var/lib/apt/lists/*

# 注意：node_modules 必须取构建层（其中包含已生成的 Prisma Client）
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3000

# 启动前先跑迁移 + 上线自检，再启动服务。
# 账号初始化（seed）改为一次性、需显式授权：默认不执行，仅当 RC_ALLOW_SEED=1 时运行，
# 避免容器每次启动都把演示账号 / 默认口令重新写回生产库。
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$RC_ALLOW_SEED\" = \"1\" ]; then npx prisma db seed; else echo '[seed] skipped (RC_ALLOW_SEED != 1)'; fi && npm run preflight && npm run start"]
