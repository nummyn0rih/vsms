import "dotenv/config";
import dns from "node:dns";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

// Автономный сид (вне Next): свой клиент, relative-импорты, без @-алиаса.
// WSL2: форсим IPv4 (см. lib/prisma.ts).
dns.setDefaultResultOrder("ipv4first");

const BCRYPT_ROUNDS = 10;

async function main() {
  const login = process.env.SEED_ADMIN_LOGIN;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!login || !password) {
    throw new Error(
      "Нужны переменные окружения SEED_ADMIN_LOGIN и SEED_ADMIN_PASSWORD",
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // upsert по login: повторный запуск не плодит дублей, а сбрасывает пароль/роль.
  const user = await prisma.user.upsert({
    where: { login },
    update: { password_hash, role: "admin", active: true },
    create: { login, password_hash, role: "admin", active: true },
  });

  console.log(`admin готов: id=${user.id} login=${user.login} role=${user.role}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
