import * as XLSX from "xlsx";

// Единственная точка использования SheetJS в проекте. Клиентский экспорт: строит
// листы из плоских строк и триггерит скачивание (XLSX.writeFile в браузере).
// Числа кладём числами (json_to_sheet типизирует как 'n'); null → пустая ячейка.
// Пакет используется ТОЛЬКО на запись: разбор чужих файлов не вводим.

// Ключ строки = человекочитаемый заголовок колонки (первая строка листа — из ключей).
export type XlsxRow = Record<string, string | number | null>;

// Один лист книги: строки + фиксированный порядок колонок + имя вкладки.
export type XlsxSheet = {
  rows: XlsxRow[];
  columns: string[]; // порядок и состав колонок (передаётся как header)
  sheetName: string;
};

// Excel режет имя листа на 31 символе — обрезаем сами, чтобы не падало.
const SHEET_NAME_MAX = 31;

// Тонны для xlsx: округление до 0.1 (паритет с fmtTons), но числом (numeric-ячейка).
export const t1 = (n: number) => Math.round(n * 10) / 10;

// Заголовок колонки-дня для xlsx из ключа «YYYY-MM-DD» (UTC — ключ дня строится в UTC).
const wdFmt = new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "UTC" });
const dmFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${wdFmt.format(d)} ${dmFmt.format(d)}`;
}

// Книга из нескольких листов. Единственная реализация записи: downloadXlsx — её обёртка.
//
// Лист с пустым rows[] создаётся ВСЁ РАВНО, с одной шапкой: json_to_sheet пишет строку
// заголовка из opts.header независимо от числа строк. Пропускать пустые листы нельзя —
// книга «съезжала» бы по составу между выгрузками, и два файла не сравнить между собой.
export function downloadXlsxBook(params: {
  sheets: XlsxSheet[];
  fileName: string;
}): void {
  const { sheets, fileName } = params;
  // Книга без единого листа: XLSX.writeFile на ней кидает «Workbook is empty», да и
  // качать нечего — молча выходим, это ошибка вызывающего, а не пользователя.
  if (sheets.length === 0) return;

  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    // Копия columns намеренно: sheet_add_json ДОПИСЫВАЕТ в переданный массив header'а
    // ключи строк, которых в нём нет. Без копии общий набор колонок мутировал бы у
    // вызывающего и разъезжался между листами одной книги.
    const ws = XLSX.utils.json_to_sheet(s.rows, { header: [...s.columns] });
    XLSX.utils.book_append_sheet(wb, ws, s.sheetName.slice(0, SHEET_NAME_MAX));
  }
  XLSX.writeFile(wb, fileName);
}

export function downloadXlsx(params: {
  rows: XlsxRow[];
  columns: string[];
  sheetName: string;
  fileName: string;
}): void {
  const { rows, columns, sheetName, fileName } = params;
  downloadXlsxBook({ sheets: [{ rows, columns, sheetName }], fileName });
}
