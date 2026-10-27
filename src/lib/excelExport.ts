// Small compatibility surface for existing exports; no workbook import/parser exposed.
type Sheet = { rows: Record<string, unknown>[]; header: string[]; '!cols'?: { wch: number }[] };
type Book = { sheets: { name: string; sheet: Sheet }[] };
export const utils = {
  json_to_sheet(rows: Record<string, unknown>[], opts?: { header?: string[] }): Sheet {
    return { rows, header: opts?.header ?? [...new Set(rows.flatMap(Object.keys))] };
  },
  book_new(): Book { return { sheets: [] }; },
  book_append_sheet(book: Book, sheet: Sheet, name: string) { book.sheets.push({ name, sheet }); },
};
export async function workbookBuffer(book: Book) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  for (const { name, sheet } of book.sheets) {
    const ws = wb.addWorksheet(name);
    ws.columns = sheet.header.map((header, i) => ({ header, key: header, width: sheet['!cols']?.[i]?.wch ?? 18 }));
    for (const row of sheet.rows) ws.addRow(row);
  }
  return wb.xlsx.writeBuffer();
}
export async function writeFile(book: Book, filename: string): Promise<void> {
  const bytes = await workbookBuffer(book);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
