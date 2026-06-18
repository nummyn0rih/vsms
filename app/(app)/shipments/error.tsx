"use client";

import { Button } from "@/components/ui/button";

// Граница ошибок ленты: если getFeed упал, показываем сообщение + повтор.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[1880px] flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        Не удалось загрузить ленту отгрузок.
      </p>
      <Button variant="outline" onClick={reset}>
        Повторить
      </Button>
    </div>
  );
}
