"use client";

import { Button } from "@/components/ui/button";

// Граница ошибок журнала (эталон — app/(app)/shipments/error.tsx).
// Отказ RBAC сюда НЕ доходит: он разбирается на самой странице человеческим текстом.
// Различать причину здесь было бы нельзя — в проде Next стирает имя и сообщение
// серверной ошибки, оставляя только digest.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        Не удалось загрузить журнал изменений.
      </p>
      <Button variant="outline" onClick={reset}>
        Повторить
      </Button>
    </div>
  );
}
