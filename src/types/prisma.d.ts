import type { Client as PrismaClient } from "@prisma/client";

declare module "@prisma/client" {
  interface Client {
    clientNo?: string | null;
  }
}

export {};
