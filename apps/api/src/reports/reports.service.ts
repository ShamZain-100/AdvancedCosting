import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { d } from '@costing/costing-engine';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyService } from '../company/company.service';
import { Pdf, latin, money as fmtMoney, qty as fmtQty } from '../print/pdf';
import type { AuthUser } from '../common/decorators';
import { COSTING_STATUSES, ColType, Filters, QUOTATION_STATUSES, REPORTS, ReportColumn, ReportDef, Row, parseFilters, reportOf } from './report-defs';

export const MAX_SHOWN_ROWS = 5000;
const letter = (n: number) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
const NUM_FMT: Record<ColType, string | undefined> = { money: '#,##0.00', qty: '#,##0.####', percent: '0.00"%"', int: '0', date: 'yyyy-mm-dd', text: undefined };

export interface ReportOutput {
  id: string; title: string; description: string; columns: ReportColumn[]; rows: Row[]; totals: Record<string, string>;
  summary: { label: string; value: string }[]; count: number; truncated: boolean; filters: Filters; generatedAt: string;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly company: CompanyService) {}

  private allowed(actor: AuthUser, def: ReportDef) {
    return actor.permissions.has('reports:view') && def.needs.every((p) => actor.permissions.has(p));
  }

  /** Reports this user may open (needs reports:view and view access to the data the report reads). */
  list(actor: AuthUser) {
    return REPORTS.filter((r) => this.allowed(actor, r)).map(({ run: _run, ...r }) => ({ ...r, statusOptions: r.statuses === 'costing' ? COSTING_STATUSES : r.statuses === 'quotation' ? QUOTATION_STATUSES : [] }));
  }

  private def(actor: AuthUser, id: string, action?: 'export' | 'print') {
    const def = reportOf(id);
    if (!def) throw new NotFoundException('Unknown report');
    if (!this.allowed(actor, def)) throw new ForbiddenException('You do not have access to this report');
    if (action && !actor.permissions.has(`reports:${action}`)) throw new ForbiddenException(`You need the reports ${action} permission`);
    return def;
  }

  /** Runs a report. Totals are summed with decimals and returned as strings. */
  async run(actor: AuthUser, id: string, query: Record<string, unknown>, opts: { all?: boolean } = {}): Promise<ReportOutput> {
    const def = this.def(actor, id);
    const filters = parseFilters(query, def.filters, def.statuses === 'costing' ? COSTING_STATUSES : def.statuses === 'quotation' ? QUOTATION_STATUSES : []);
    const { rows, summary } = await def.run({ prisma: this.prisma }, filters);
    const totals: Record<string, string> = {};
    for (const c of def.columns.filter((x) => x.total)) totals[c.key] = rows.reduce((s, r) => s.plus(d(String(r[c.key] ?? 0))), d(0)).toFixed(c.type === 'int' ? 0 : 2);
    const truncated = !opts.all && rows.length > MAX_SHOWN_ROWS;
    return {
      id: def.id, title: def.title, description: def.description, columns: def.columns, rows: truncated ? rows.slice(0, MAX_SHOWN_ROWS) : rows, totals, summary: summary ?? [],
      count: rows.length, truncated, filters, generatedAt: new Date().toISOString(),
    };
  }

  private describeFilters(f: Filters) {
    const parts = Object.entries(f).map(([k, v]) => `${({ from: 'From', to: 'To', product: 'Product', typeId: 'Type', groupId: 'Group', supplierId: 'Supplier', itemId: 'Item', status: 'Status' } as Record<string, string>)[k]}: ${k.endsWith('Id') ? '(selected)' : v}`);
    return parts.length ? parts.join('  |  ') : 'No filters (all records)';
  }

  async excel(actor: AuthUser, id: string, query: Record<string, unknown>): Promise<{ buffer: Buffer; filename: string }> {
    this.def(actor, id, 'export');
    const r = await this.run(actor, id, query, { all: true });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(r.title.slice(0, 31));
    ws.addRow([r.title]).font = { bold: true, size: 14 };
    ws.addRow([this.describeFilters(r.filters)]);
    ws.addRow([`Generated ${r.generatedAt.slice(0, 16).replace('T', ' ')} UTC · ${r.count} row(s)`]);
    r.summary.forEach((s) => ws.addRow([s.label, s.value]));
    ws.addRow([]);
    const headRow = ws.rowCount + 1;
    const head = ws.addRow(r.columns.map((c) => c.header));
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    r.rows.forEach((row) => ws.addRow(r.columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined || v === '') return null;
      if (c.type === 'money' || c.type === 'qty' || c.type === 'percent' || c.type === 'int') return Number(v);
      if (c.type === 'date') return new Date(`${v}T00:00:00Z`);
      return String(v);
    })));
    r.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; const f = NUM_FMT[c.type]; if (f) ws.getColumn(i + 1).numFmt = f; });
    // the heading rows above the table must not take the number format
    for (let n = 1; n < headRow; n++) ws.getRow(n).eachCell((cell) => { cell.numFmt = 'General'; });
    if (r.rows.length && r.columns.some((c) => c.total)) {
      const first = headRow + 1, last = headRow + r.rows.length;
      const total = ws.addRow(r.columns.map((c, i) => (i === 0 ? 'Total' : c.total ? { formula: `SUM(${letter(i + 1)}${first}:${letter(i + 1)}${last})` } : null)));
      total.font = { bold: true }; total.border = { top: { style: 'thin' } };
    }
    ws.views = [{ state: 'frozen', ySplit: headRow }];
    ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow, column: r.columns.length } };
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `${r.id}.xlsx` };
  }

  async pdf(actor: AuthUser, id: string, query: Record<string, unknown> = {}): Promise<{ buffer: Buffer; filename: string }> {
    this.def(actor, id, 'print');
    const r = await this.run(actor, id, query, { all: true });
    const c = await this.company.getRaw();
    const pdf = new Pdf({ name: c.name, address: c.address, phone: c.phone, email: c.email, gstin: c.gstin, currencyCode: c.currencyCode, footerNote: c.footerNote, logo: await this.company.logoBuffer() }, r.title, 'landscape', r.id);
    pdf.letterhead();
    pdf.documentTitle(r.title, [['Generated', r.generatedAt.slice(0, 16).replace('T', ' ')], ['Rows', String(r.count)]]);
    pdf.paragraph(this.describeFilters(r.filters), 8.5, '#64748b');
    if (r.summary.length) pdf.kv(r.summary.map((s) => [s.label, s.value] as [string, string]), 3);
    const fmt = (c: ReportColumn, v: Row[string]) => (v === null || v === undefined || v === '' ? '' : c.type === 'money' ? fmtMoney(v) : c.type === 'qty' ? fmtQty(v) : c.type === 'percent' ? `${Number(v).toFixed(2)}%` : String(v));
    pdf.table(
      r.columns.map((col) => ({ header: col.header, width: col.width, align: (['money', 'qty', 'percent', 'int'].includes(col.type) ? 'right' : 'left') as 'left' | 'right' })),
      r.rows.map((row) => r.columns.map((col) => fmt(col, row[col.key]))),
      { fontSize: 7.5, foot: r.rows.length && r.columns.some((col) => col.total) ? r.columns.map((col, i) => (i === 0 ? 'Total' : col.total ? fmt(col, r.totals[col.key]) : '')) : undefined },
    );
    return { buffer: await pdf.finish(), filename: `${latin(r.id)}.pdf` };
  }
}
