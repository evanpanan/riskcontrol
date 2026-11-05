import { PrismaClient } from "@prisma/client";
import { hydrateRuntimeEnv } from "./server/runtimeEnv";

hydrateRuntimeEnv();

const getOptimizedDatabaseUrl = () => {
  let url = process.env.DATABASE_URL;
  if (!url) return url;
  
  // 在生产环境（Vercel Serverless）中，如果没有使用 6543 连接池端口，
  // 强制限制每个无服务器函数的连接数为 1，防止打爆 Supabase 免费版的 60 个连接上限。
  if (process.env.NODE_ENV === "production" && !url.includes("6543")) {
    try {
      const parsedUrl = new URL(url);
      if (!parsedUrl.searchParams.has("connection_limit")) {
        parsedUrl.searchParams.set("connection_limit", "1");
        // 设置连接超时，避免死锁
        parsedUrl.searchParams.set("pool_timeout", "10");
        url = parsedUrl.toString();
      }
    } catch (e) {
      // 解析失败则忽略
    }
  }
  return url;
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasourceUrl: getOptimizedDatabaseUrl(),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
