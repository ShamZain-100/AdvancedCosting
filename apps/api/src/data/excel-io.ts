import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

export interface Col {
  key: string;
  header: string;
  required?: boolean;
  /** shown on the Instructions sheet */
  help: string;
  example?: string;
  width?: number;
}

export interface RawRow { row: number; raw: Record<string, string> }

export const MAX_IMPORT_ROWS = 5000;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[*]/g, '').trim();

export const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text).trim();
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
    return '';
  }
  // numbers like 98 or 0.8 come back as JS numbers; String() keeps them exact for the decimal-string schemas
  return String(v).trim();
};

/** Open an uploaded .xlsx safely and return its data rows keyed by column key. */
export async function readRows(file: Express.Multer.File | undefined, columns: Col[], sheetName?: string): Promise<{ fileName: string; rows: RawRow[]; ignored: string[] }> {
  if (!file) throw new BadRequestException('Upload an .xlsx file in the "file" field');
  if (!/\.xlsx$/i.test(file.originalname) || file.buffer.subarray(0, 2).toString() !== 'PK') throw new BadRequestException('Only .xlsx files are supported');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(file.buffer as never); } catch { throw new BadRequestException('The file could not be read as an Excel workbook'); }
  const ws = (sheetName ? wb.getWorksheet(sheetName) : undefined) ?? wb.worksheets[0];
  if (!ws) throw new BadRequestException('The workbook has no sheets');

  const headers = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => norm(cellText(v)));
  const index = new Map<string, number>();
  for (const c of columns) { const i = headers.indexOf(norm(c.header)); if (i > 0) index.set(c.key, i); }
  const missing = columns.filter((c) => c.required && !index.has(c.key)).map((c) => c.header);
  if (missing.length) throw new BadRequestException(`Missing column(s): ${missing.join(', ')}. Download the template for the expected layout.`);
  const known = new Set(columns.map((c) => norm(c.header)));
  const ignored = headers.filter((h) => h && !known.has(h));
  if (ws.rowCount - 1 > MAX_IMPORT_ROWS) throw new BadRequestException(`Too many rows (maximum ${MAX_IMPORT_ROWS})`);

  const rows: RawRow[] = [];
  for (let n = 2; n <= ws.rowCount; n++) {
    const r = ws.getRow(n);
    const raw: Record<string, string> = {};
    for (const c of columns) raw[c.key] = index.has(c.key) ? cellText(r.getCell(index.get(c.key)!).value) : '';
    if (Object.values(raw).every((v) => v === '')) continue;
    rows.push({ row: n, raw });
  }
  if (!rows.length) throw new BadRequestException('The file contains no data rows');
  return { fileName: file.originalname, rows, ignored };
}

export function styleHeader(ws: ExcelJS.Worksheet, headers: string[], widths: number[] = []) {
  const row = ws.addRow(headers);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  row.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: ws.rowCount }];
  headers.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i] ?? Math.max(12, h.length + 4); });
  ws.autoFilter = { from: { row: ws.rowCount, column: 1 }, to: { row: ws.rowCount, column: headers.length } };
}

/** Template workbook: a sheet with only the header row (so nothing sample-like can be imported by accident) and an instructions sheet. */
export async function templateWorkbook(label: string, columns: Col[], notes: string[] = [], sheetName = 'Data'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  styleHeader(wb.addWorksheet(sheetName), columns.map((c) => (c.required ? `${c.header} *` : c.header)), columns.map((c) => c.width ?? Math.max(14, c.header.length + 6)));
  const help = wb.addWorksheet('Instructions');
  help.addRow([`${label} import`]).font = { bold: true, size: 14 };
  help.addRow(['Fill the "' + sheetName + '" sheet (one record per row, header row kept as is). Columns marked * are required. Nothing is imported until you confirm the preview.']);
  notes.forEach((n) => help.addRow([n]));
  help.addRow([]);
  const h = help.addRow(['Column', 'Required', 'Description', 'Example']);
  h.font = { bold: true };
  columns.forEach((c) => help.addRow([c.header, c.required ? 'Yes' : 'No', c.help, c.example ?? '']));
  [26, 10, 90, 28].forEach((w, i) => (help.getColumn(i + 1).width = w));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function dataWorkbook(sheet: string, headers: string[], rows: (string | number | null)[][], widths: number[] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  styleHeader(ws, headers, widths);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
