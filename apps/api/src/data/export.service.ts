import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { CostingsService } from '../costings/costings.service';
import type { AuthUser } from '../common/decorators';
import { dataWorkbook, styleHeader } from './excel-io';
import { KINDS, kindOf } from './kinds';
import { allowedColumns } from '../common/column-access';

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v.toString()));
const day = (d: Date) => d.toISOString().slice(0, 10);
const XLSX_MONEY = '#,##0.00';

export interface ExportKind { kind: string; label: string; module: string; description: string; external?: string }
const EXTRA: ExportKind[] = [
  { kind: 'costings', label: 'Costing summaries', module: 'costing', description: 'One row per costing with cost, GST, selling price and profit.' },
  { kind: 'quotations', label: 'Quotations', module: 'quotations', description: 'One row per quotation with totals.' },
];

/** An export never loads more than this many records at once; narrow by filters beyond it. */
export const MAX_EXPORT_ROWS = 50_000;

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService, private readonly costings: CostingsService) {}

  /** Exports this user may run (each needs the module's own export permission). */
  kinds(actor: AuthUser): ExportKind[] {
    const masters: ExportKind[] = KINDS.map((k) => ({ kind: k.kind, label: k.label, module: k.module, description: 'Same layout as the import template, so the file can be edited and imported again.' }));
    const all = [
      ...masters, ...EXTRA,
      { kind: 'purchase-rates', label: 'Purchase rates', module: 'purchase_rates', description: 'All purchase entries with amounts and totals.', external: '/purchase-rates/excel/export' },
    ];
    return all.filter((k) => actor.permissions.has(`${k.module}:export`));
  }

  private allow(actor: AuthUser, module: string) {
    if (!actor.permissions.has(`${module}:export`)) throw new ForbiddenException(`You need the ${module} export permission`);
  }

  async export(actor: AuthUser, kind: string, q: Record<string, string | undefined>): Promise<{ buffer: Buffer; filename: string }> {
    const master = kindOf(kind);
    if (master) {
      this.allow(actor, master.module);
      const rows = await (this.prisma as any)[master.cfg.model].findMany({ where: { deletedAt: null }, orderBy: { [master.naturalKey]: 'asc' }, include: master.exportInclude, take: MAX_EXPORT_ROWS });
      const buffer = await dataWorkbook(master.label, master.columns.map((c) => (c.required ? `${c.header} *` : c.header)), rows.map((r: any) => { const o = master.toRow(r); return master.columns.map((c) => o[c.key] ?? ''); }), master.columns.map((c) => c.width ?? Math.max(14, c.header.length + 6)));
      return { buffer, filename: `${kind}.xlsx` };
    }
    if (kind === 'costings') { this.allow(actor, 'costing'); return { buffer: await this.costingSummaries(q, allowedColumns(actor, 'costings')), filename: 'costing-summaries.xlsx' }; }
    if (kind === 'quotations') { this.allow(actor, 'quotations'); return { buffer: await this.quotationList(q), filename: 'quotations.xlsx' }; }
    throw new NotFoundException('Unknown export');
  }

  private totalsRow(ws: ExcelJS.Worksheet, label: string, cols: Record<string, number>, first: number, last: number) {
    if (last < first) return;
    const row = ws.addRow([]);
    row.getCell(1).value = label;
    for (const [letter] of Object.entries(cols)) row.getCell(letter).value = { formula: `SUM(${letter}${first}:${letter}${last})` };
    row.font = { bold: true };
    row.border = { top: { style: 'thin' } };
  }

  /** One row per costing; only the columns this user may see (same rule as the costing list on screen). */
  private async costingSummaries(q: Record<string, string | undefined>, visible: Set<string>): Promise<Buffer> {
    const all: any[] = [];
    for (let page = 1; ; page++) {
      const r = await this.costings.list({ ...q, page: String(page), pageSize: '200' });
      all.push(...r.items);
      if (all.length >= r.total || !r.items.length) break;
    }
    type Col = { col: string | null; header: string; width: number; value: (c: any) => unknown; fmt?: string; total?: boolean };
    const cols: Col[] = ([
      { col: 'costingNumber', header: 'Number', width: 18, value: (c) => c.costingNumber },
      { col: 'productName', header: 'Product', width: 30, value: (c) => c.productName },
      { col: null, header: 'Code', width: 14, value: (c) => c.productCode ?? '' },
      { col: 'type', header: 'Type', width: 16, value: (c) => c.type.name },
      { col: 'costingDate', header: 'Date', width: 12, value: (c) => c.costingDate, fmt: 'yyyy-mm-dd' },
      { col: 'status', header: 'Status', width: 18, value: (c) => String(c.status).replace('_', ' ').toLowerCase() },
      { col: null, header: 'Version', width: 9, value: (c) => c.version },
      { col: 'basicCost', header: 'Basic cost', width: 14, value: (c) => n(c.basicCost), fmt: XLSX_MONEY, total: true },
      { col: 'totalCostInclGst', header: 'Total cost incl. GST', width: 20, value: (c) => n(c.totalCostInclGst), fmt: XLSX_MONEY, total: true },
      { col: 'sellingPrice', header: 'Selling price', width: 16, value: (c) => n(c.sellingPrice), fmt: XLSX_MONEY, total: true },
      { col: 'profitPercent', header: 'Profit %', width: 10, value: (c) => (n(c.profitPercent) ?? 0) / 100, fmt: '0.00%' },
      { col: 'preparedBy', header: 'Prepared by', width: 20, value: (c) => c.preparedBy?.name ?? '' },
    ] as Col[]).filter((c) => c.col === null || visible.has(c.col));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Costings');
    styleHeader(ws, cols.map((c) => c.header), cols.map((c) => c.width));
    all.forEach((c) => ws.addRow(cols.map((col) => col.value(c))));
    cols.forEach((c, i) => { if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt; });
    const letter = (i: number) => String.fromCharCode(65 + i);
    this.totalsRow(ws, 'Total', Object.fromEntries(cols.flatMap((c, i) => (c.total ? [[letter(i), i + 1]] : []))), 2, 1 + all.length);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private async quotationList(q: Record<string, string | undefined>): Promise<Buffer> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (q.status) where.status = q.status;
    if (q.from || q.to) where.quotationDate = { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T00:00:00Z`) } : {}) };
    const rows = await this.prisma.quotation.findMany({ where, orderBy: { quotationDate: 'desc' }, include: { preparedBy: { select: { name: true } } }, take: MAX_EXPORT_ROWS });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Quotations');
    styleHeader(ws, ['Number', 'Date', 'Valid until', 'Customer', 'Subject', 'Status', 'Taxable amount', 'GST', 'Grand total', 'Prepared by'], [18, 12, 12, 28, 28, 12, 16, 14, 16, 20]);
    rows.forEach((r) => ws.addRow([r.number, r.quotationDate, r.validUntil, r.customerName, r.subject ?? '', r.status.toLowerCase(), n(r.taxableAmount), n(r.gstAmount), n(r.grandTotal), r.preparedBy.name]));
    [2, 3].forEach((i) => (ws.getColumn(i).numFmt = 'yyyy-mm-dd'));
    [7, 8, 9].forEach((i) => (ws.getColumn(i).numFmt = XLSX_MONEY));
    this.totalsRow(ws, 'Total', { G: 7, H: 8, I: 9 }, 2, 1 + rows.length);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** One costing in detail: summary, materials (group-wise), labour and expenses, with sums as formulas. */
  async costingDetail(actor: AuthUser, id: string): Promise<{ buffer: Buffer; filename: string }> {
    this.allow(actor, 'costing');
    const c = await this.prisma.costing.findFirst({
      where: { id, deletedAt: null },
      include: {
        type: true, preparedBy: { select: { name: true } },
        groups: { orderBy: { sortOrder: 'asc' }, include: { group: true, categories: { orderBy: { sortOrder: 'asc' }, include: { category: true, materials: { orderBy: { sortOrder: 'asc' }, include: { item: true } } } }, labour: { orderBy: { sortOrder: 'asc' }, include: { labour: true } } } },
        expenses: { orderBy: { sortOrder: 'asc' }, include: { expense: true, costingGroup: { include: { group: true } } } },
      },
    });
    if (!c) throw new NotFoundException('Costing not found');
    const units = new Map((await this.prisma.unit.findMany({ select: { id: true, symbol: true } })).map((u) => [u.id, u.symbol]));

    const wb = new ExcelJS.Workbook();
    const sum = wb.addWorksheet('Summary');
    sum.addRow([`Costing ${c.costingNumber}`]).font = { bold: true, size: 14 };
    sum.addRow([`${c.productName}${c.productCode ? ` (${c.productCode})` : ''} · ${c.type.name} · ${day(c.costingDate)} · ${c.status.replace('_', ' ').toLowerCase()} · prepared by ${c.preparedBy.name}`]);
    sum.addRow([]);

    const mat = wb.addWorksheet('Materials');
    styleHeader(mat, ['SL', 'Group', 'Category', 'Item code', 'Item', 'Notes', 'Qty', 'Unit', 'Wastage', 'Effective qty', 'Rate', 'Total'], [5, 16, 18, 12, 30, 24, 10, 8, 10, 12, 12, 14]);
    let sl = 0;
    for (const g of c.groups) for (const cat of g.categories) for (const m of cat.materials) {
      sl++;
      mat.addRow([sl, g.group.name, cat.category.name, m.item.code, m.item.name, m.notes ?? '', n(m.quantity), units.get(m.unitId) ?? '', n(m.effectiveQuantity)! - n(m.quantity)!, n(m.effectiveQuantity), n(m.rate), n(m.total)]);
    }
    [7, 9, 10].forEach((i) => (mat.getColumn(i).numFmt = '#,##0.####'));
    [11, 12].forEach((i) => (mat.getColumn(i).numFmt = XLSX_MONEY));
    this.totalsRow(mat, 'Total material', { L: 12 }, 2, 1 + sl);

    const lab = wb.addWorksheet('Labour');
    styleHeader(lab, ['SL', 'Group', 'Labour', 'Qty', 'Unit', 'Rate', 'Total'], [5, 18, 28, 10, 8, 12, 14]);
    let ln = 0;
    for (const g of c.groups) for (const l of g.labour) { ln++; lab.addRow([ln, g.group.name, l.labour.name, n(l.quantity), l.unitId ? (units.get(l.unitId) ?? '') : '', n(l.rate), { formula: `ROUND(D${ln + 1}*F${ln + 1},2)`, result: n(l.total) ?? 0 }]); }
    [6, 7].forEach((i) => (lab.getColumn(i).numFmt = XLSX_MONEY));
    this.totalsRow(lab, 'Total labour', { G: 7 }, 2, 1 + ln);

    const exp = wb.addWorksheet('Expenses');
    styleHeader(exp, ['SL', 'Expense', 'Applies to', 'Method', 'Value', 'Qty', 'Timing', 'Amount'], [5, 26, 18, 16, 12, 8, 14, 14]);
    c.expenses.forEach((e, i) => exp.addRow([i + 1, e.expense.name, e.costingGroup?.group.name ?? 'Whole product', e.calculationMethod.replace('_', ' ').toLowerCase(), n(e.value), n(e.quantity), e.applyTiming.replace('_', ' ').toLowerCase(), n(e.amount)]));
    exp.getColumn(8).numFmt = XLSX_MONEY;
    this.totalsRow(exp, 'Total expenses', { H: 8 }, 2, 1 + c.expenses.length);

    const lines: [string, number | { formula: string } | null][] = [
      ['Total material cost', n(c.materialCost)], ['   of which wastage', n(c.materialWastage)], ['Total labour cost', n(c.labourCost)], ['Other expenses', n(c.expenseCost)],
      ...(Number(c.companyExpenseCost ?? 0) > 0 ? [['of which company expenses', n(c.companyExpenseCost)] as [string, number]] : []), ['Basic cost (before GST)', n(c.basicCost)], [`GST (${n(c.gstPercent)}%)`, n(c.gstAmount)], ['Total cost including GST', n(c.totalCostInclGst)], ...(Number(c.extraAmount ?? 0) > 0 ? [[`Extra (${n(c.extraPercent)}%)`, n(c.extraAmount)] as [string, number]] : []), [`Markup (${n(c.markupPercent)}%)`, n(c.markupAmount)],
      ['Selling price', n(c.sellingPrice)], ['Profit amount', n(c.profitAmount)], ['Profit %', (n(c.profitPercent) ?? 0) / 100], [`Net basic rate (per unit, qty ${n(c.quantity)})`, n(c.netBasicRate)], ['Net selling price (per unit)', n(c.netSellingPrice)],
    ];
    lines.forEach(([k, v]) => { const r = sum.addRow([k, v]); if (/Basic cost|Total cost|Selling price$/.test(k)) r.font = { bold: true }; });
    sum.getColumn(2).numFmt = XLSX_MONEY;
    sum.getRow(sum.rowCount - 2).getCell(2).numFmt = '0.00%';
    sum.addRow([]);
    sum.addRow(['Check: material lines add up to', { formula: `Materials!L${2 + sl}` }]);
    sum.addRow(['Check: labour lines add up to', { formula: `Labour!G${2 + ln}` }]);
    sum.getColumn(1).width = 44; sum.getColumn(2).width = 18;
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `${c.costingNumber}.xlsx` };
  }
}
