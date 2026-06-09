import dns from "node:dns";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

// WSL2 без IPv6-egress: резолвер Neon отдаёт IPv6 → P1001. Форсим IPv4.
dns.setDefaultResultOrder("ipv4first");

// Prisma 7 — клиент без нативного движка, обязателен driver adapter.
// Рантайм идёт через pooled-строку Neon (DATABASE_URL).
const connectionString = process.env.DATABASE_URL;

// Singleton: при HMR в dev Next пересоздаёт модули → без globalThis
// плодились бы лишние коннекты к БД.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
