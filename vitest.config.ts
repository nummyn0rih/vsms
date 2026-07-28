import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Юнит-тесты чистого ядра расчётов (audit-w3). Только Node, без БД и без React:
// тестируемые модули (workdays, accepted, feed, board-filter, packaging…) — чистые
// функции, prisma в них не импортируется.

// Корень проекта с завершающим "/". Алиас регекспом "^@/" повторяет tsconfig
// paths "@/*": ["./*"] — и живёт ТОЛЬКО здесь, в tsconfig/next.config его нет.
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: root }],
  },
  test: {
    environment: "node",
    // Тесты лежат рядом с модулем (co-located): server/**/x.test.ts, lib/x.test.ts.
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "lib/generated/**"],
  },
});
