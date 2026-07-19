import * as XLSX from "xlsx";

// Единственная точка использования SheetJS в проекте. Клиентский экспорт: строит
// один лист из плоских строк и триггерит скачивание (XLSX.writeFile в браузере).
// Числа кладём числами (json_to_sheet типизирует как 'n'); null → пустая ячейка.

// Ключ строки = человекочитаемый заголовок колонки (первая строка листа — из ключей).
export type XlsxRow = Record<string, string | number | null>;

// Excel режет имя листа на 31 символе — обрезаем сами, чтобы не падало.
const SHEET_NAME_MAX = 31;

export function downloadXlsx(params: {
  rows: XlsxRow[];
  columns: string[]; // порядок и состав колонок (передаётся как header)
  sheetName: string;
  fileName: string;
}): void {
  const { rows, columns, sheetName, fileName } = params;
  const ws = XLSX.utils.json_to_sheet(rows, { header: columns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, SHEET_NAME_MAX));
  XLSX.writeFile(wb, fileName);
}
