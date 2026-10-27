# RiskControl 生产镜像（Next.js 14 + Prisma）
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

# 启动前先跑迁移 + 账号初始化 + 上线自检，再启动服务
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && npm run preflight && npm run start"]
