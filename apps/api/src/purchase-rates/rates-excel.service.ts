import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { d } from '@costing/costing-engine';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { NormalisedRow, PurchaseRatesService } from './purchase-rates.service';

const HEADERS = ['Item Code', 'Supplier Code', 'Unit', 'Quantity', 'Rate', 'Purchase Date', 'Reference No', 'Notes'] as const;
const MAX_ROWS = 5000;

export interface ImportRow {
  row: number;
  status: 'ok' | 'error' | 'duplicate';
  errors: string[];
  data: Record<string, string>;
  normalised?: NormalisedRow;
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text).trim();
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
    return '';
  }
  return String(v).trim();
};

@Injectable()
export class RatesExcelService {
  constructor(private readonly prisma: PrismaService, private readonly rates: PurchaseRatesService, private readonly audit: AuditService) {}

  async template(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Purchase Rates');
    this.styleHeader(ws, [...HEADERS], [16, 16, 10, 12, 12, 16, 18, 30]);
    ws.addRow(['MPM', 'SUP01', 'KG', 20, 98, '2026-01-15', 'INV-1001', 'Example row: delete before import']);
    const help = wb.addWorksheet('Instructions');
    [
      'Item Code (required): code from the Item Master.',
      'Supplier Code (optional): code from the Supplier Master.',
      'Unit (optional): unit symbol; defaults to the item\'s base unit. Must be convertible to it.',
      'Quantity (optional, default 1): used to weight the weighted-average rate.',
      'Rate (required): price per the unit given above.',
      'Purchase Date (required): YYYY-MM-DD or an Excel date; not in the future.',
      `Maximum ${MAX_ROWS} rows per file.`,
    ].forEach((t) => help.addRow([t]));
    help.getColumn(1).width = 100;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async export(q: Record<string, string | undefined>): Promise<Buffer> {
    const { items } = await this.rates.listEntries({ ...q, page: '1', pageSize: '200' });
    // listEntries caps pages at 200; export walks all pages
    const all = [...items];
    let page = 2;
    for (let total = (await this.rates.listEntries({ ...q, page: '1', pageSize: '200' })).total; all.length < total; page++) {
      all.push(...(await this.rates.listEntries({ ...q, page: String(page), pageSize: '200' })).items);
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Purchase Rates');
    this.styleHeader(ws, ['Date', 'Item Code', 'Item', 'Supplier', 'Unit', 'Quantity', 'Rate', 'Amount', 'Rate / Base Unit', 'Reference No', 'Notes'], [12, 14, 28, 24, 8, 12, 12, 14, 16, 16, 30]);
    all.forEach((e, i) => {
      const r = i + 2;
      ws.addRow([e.purchaseDate, e.item.code, e.item.name, e.supplier?.name ?? '', e.unit.symbol, Number(e.quantity), Number(e.rate), { formula: `F${r}*G${r}` }, Number(e.baseRate), e.referenceNo ?? '', e.notes ?? '']);
    });
    ws.getColumn(1).numFmt = 'yyyy-mm-dd';
    ['F', 'G', 'H', 'I'].forEach((c) => (ws.getColumn(c).numFmt = '#,##0.00##'));
    if (all.length) {
      const t = ws.addRow(['Total', '', '', '', '', '', '', { formula: `SUM(H2:H${all.length + 1})` }]);
      t.font = { bold: true };
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private styleHeader(ws: ExcelJS.Worksheet, headers: string[], widths: number[]) {
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  }

  /** Parse + validate without writing anything. */
  async preview(file: Express.Multer.File | undefined): Promise<{ fileName: string; rows: ImportRow[] }> {
    if (!file) throw new BadRequestException('Upload an .xlsx file in the "file" field');
    if (!/\.xlsx$/i.test(file.originalname) || file.buffer.subarray(0, 2).toString() !== 'PK') {
      throw new BadRequestException('Only .xlsx files are supported');
    }
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(file.buffer as never); } catch { throw new BadRequestException('The file could not be read as an Excel workbook'); }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('The workbook has no sheets');

    const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => cellText(v).toLowerCase());
    const col = (name: string) => header.indexOf(name.toLowerCase());
    const missing = HEADERS.filter((h, i) => i !== 1 && i !== 2 && i !== 3 && i !== 6 && i !== 7 && col(h) < 0);
    if (missing.length) throw new BadRequestException(`Missing column(s): ${missing.join(', ')}. Download the template for the expected layout.`);
    if (ws.rowCount - 1 > MAX_ROWS) throw new BadRequestException(`Too many rows (maximum ${MAX_ROWS})`);

    const [items, suppliers, units] = await Promise.all([
      this.prisma.item.findMany({ where: { deletedAt: null }, select: { id: true, code: true, unitId: true } }),
      this.prisma.supplier.findMany({ where: { deletedAt: null }, select: { id: true, code: true } }),
      this.prisma.unit.findMany({ where: { deletedAt: null }, select: { id: true, symbol: true } }),
    ]);
    const itemByCode = new Map(items.map((i) => [i.code.toLowerCase(), i]));
    const supplierByCode = new Map(suppliers.map((s) => [s.code.toLowerCase(), s]));
    const unitBySymbol = new Map(units.map((u) => [u.symbol.toLowerCase(), u]));

    const rows: ImportRow[] = [];
    const seen = new Set<string>();
    const today = new Date().toISOString().slice(0, 10);
    for (let n = 2; n <= ws.rowCount; n++) {
      const r = ws.getRow(n);
      const get = (h: string) => (col(h) < 0 ? '' : cellText(r.getCell(col(h)).value));
      const data = Object.fromEntries(HEADERS.map((h) => [h, get(h)]));
      if (Object.values(data).every((v) => v === '')) continue;
      const errors: string[] = [];

      const item = itemByCode.get(data['Item Code'].toLowerCase());
      if (!data['Item Code']) errors.push('Item Code is required');
      else if (!item) errors.push(`Unknown item code "${data['Item Code']}"`);
      const supplier = data['Supplier Code'] ? supplierByCode.get(data['Supplier Code'].toLowerCase()) : undefined;
      if (data['Supplier Code'] && !supplier) errors.push(`Unknown supplier code "${data['Supplier Code']}"`);
      const unit = data.Unit ? unitBySymbol.get(data.Unit.toLowerCase()) : item ? { id: item.unitId } : undefined;
      if (data.Unit && !unit) errors.push(`Unknown unit "${data.Unit}"`);
      if (!/^\d+(\.\d+)?$/.test(data.Rate)) errors.push('Rate must be a non-negative number');
      if (data.Quantity && !(/^\d+(\.\d+)?$/.test(data.Quantity) && Number(data.Quantity) > 0)) errors.push('Quantity must be greater than 0');
      const date = data['Purchase Date'];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) errors.push('Purchase Date must be a valid date (YYYY-MM-DD)');
      else if (date > today) errors.push('Purchase Date cannot be in the future');

      let status: ImportRow['status'] = errors.length ? 'error' : 'ok';
      let normalised: NormalisedRow | undefined;
      if (!errors.length && item && unit) {
        try {
          normalised = (await this.rates.normalise(this.prisma, {
            itemId: item.id, supplierId: supplier?.id, unitId: unit.id, quantity: data.Quantity || undefined, rate: data.Rate,
            purchaseDate: date, referenceNo: data['Reference No'] || undefined, notes: data.Notes || undefined,
          })).row;
        } catch (e) { errors.push(((e as { message?: string }).message ?? 'Invalid row').replace(/^\w+: /, '')); status = 'error'; }
      }
      if (normalised && status === 'ok') {
        const key = [normalised.itemId, normalised.supplierId, normalised.unitId, d(normalised.rate).toString(), d(normalised.quantity).toString(), date, normalised.referenceNo].join('|');
        const existing = await this.prisma.purchaseRate.count({
          where: { itemId: normalised.itemId, supplierId: normalised.supplierId, unitId: normalised.unitId, rate: normalised.rate, quantity: normalised.quantity, purchaseDate: normalised.purchaseDate, referenceNo: normalised.referenceNo, deletedAt: null },
        });
        if (seen.has(key)) { status = 'duplicate'; errors.push('Duplicate of an earlier row in this file'); }
        else if (existing) { status = 'duplicate'; errors.push('Identical purchase already recorded'); }
        seen.add(key);
      }
      rows.push({ row: n, status, errors, data, normalised: status === 'ok' ? normalised : undefined });
    }
    if (!rows.length) throw new BadRequestException('The file contains no data rows');
    return { fileName: file.originalname, rows };
  }

  summarise(p: { fileName: string; rows: ImportRow[] }) {
    const ok = p.rows.filter((r) => r.status === 'ok').length;
    return {
      fileName: p.fileName, total: p.rows.length, valid: ok, invalid: p.rows.filter((r) => r.status === 'error').length,
      duplicates: p.rows.filter((r) => r.status === 'duplicate').length,
      rows: p.rows.map(({ normalised: _n, ...r }) => r),
    };
  }

  async confirm(actor: AuthUser, file: Express.Multer.File | undefined, skipInvalid: boolean) {
    const parsed = await this.preview(file);
    const good = parsed.rows.filter((r) => r.status === 'ok');
    const bad = parsed.rows.filter((r) => r.status !== 'ok');
    if (bad.length && !skipInvalid) {
      throw new BadRequestException({
        message: `${bad.length} row(s) are invalid or duplicated; nothing was imported. Fix the file or choose to skip invalid rows.`,
        summary: this.summarise(parsed),
      });
    }
    if (!good.length) throw new BadRequestException('There are no valid rows to import');
    const changes = await this.prisma.$transaction((tx) => this.rates.insertEntries(tx, good.map((g) => g.normalised!), actor.id, 'IMPORT'), { timeout: 60_000 });
    await this.rates.announceMany(changes, actor.id);
    const errors = bad.map((b) => ({ row: b.row, errors: b.errors }));
    const rec = await this.prisma.importHistory.create({
      data: { kind: 'purchase_rates', fileName: parsed.fileName, totalRows: parsed.rows.length, successRows: good.length, failedRows: bad.length, errors: errors as never, createdBy: actor.id },
    });
    await this.audit.log({ userId: actor.id, action: 'import', entity: 'PurchaseRate', entityId: rec.id, metadata: { imported: good.length, skipped: bad.length } });
    return { importId: rec.id, imported: good.length, skipped: bad.length, itemsWithRateChange: changes.filter((c) => c.moved).length };
  }

  history() {
    return this.prisma.importHistory.findMany({ where: { kind: 'purchase_rates' }, orderBy: { createdAt: 'desc' }, take: 50 });
  }
}
