// Единый тип результата мутаций server actions. Используется всеми справочниками.
// ok=false несёт текст ошибки и (для валидации) ошибки по полям формы.
export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
