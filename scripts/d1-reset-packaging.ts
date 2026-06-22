import "dotenv/config";
import dns from "node:dns";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

// D1: разовый сброс движений тары. Модель тары сменилась (DOMAIN §3: двухфазность,
// транзит-сентинелы, opening) — старые тестовые packaging-движения невалидны.
// Входящие появятся заново в D2, начальные остатки — через UI «Начальные остатки».
// НЕ трогает kind=ingredient. Запуск вручную: npx tsx scripts/d1-reset-packaging.ts
//
// Автономный скрипт (вне Next): свой клиент, relative-импорты, без @-алиаса
// (tsx не резолвит @) — паттерн как в prisma/seed.ts. WSL2: форсим IPv4.
dns.setDefaultResultOrder("ipv4first");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const { count } = await prisma.stockMovement.deleteMany({
    where: { kind: "packaging" },
  });
  console.log(`Удалено packaging-движений: ${count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
