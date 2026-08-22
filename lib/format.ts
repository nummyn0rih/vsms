// Вывод тонн: округление до 0,1 т, целые целыми, запятая. Только отображение —
// в БД/расчётах полная точность. 123.251→«123,3»; 240→«240»; 39.001→«39»; 1.4→«1,4».
export function fmtTons(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "").replace(".", ",");
}

// Процент с одним знаком, запятая (4→«4,0», 6.13→«6,1»). Для брака.
export function fmtPct1(n: number): string {
  return n.toFixed(1).replace(".", ",");
}

// Целое с разрядами (пробел-разделитель, ru): 1284→«1 284».
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

// Цена ₽/кг (Decimal(…,2)): разделитель — запятая, как у остальных чисел. 30→«30», 49.5→«49,5».
// Значение не округляем: цена договорная, «49,50» и «49,5» — одно число, лишний ноль на листе шумит.
export function fmtPrice(n: number): string {
  return String(n).replace(".", ",");
}

// Процент корректировки расчёта (Decimal(5,2)): 97→«97», 97.5→«97,5». Правило то же, что
// у цены, поэтому делегируем — второй копии тела не заводим.
// ⚠ Не путать с fmtPct1: тот ВСЕГДА с одним знаком (брак 4→«4,0»).
export function fmtPercent(n: number): string {
  return fmtPrice(n);
}
