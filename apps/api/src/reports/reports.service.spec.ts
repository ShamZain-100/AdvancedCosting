import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Pdf } from '../print/pdf';
import { DashboardService } from '../dashboard/dashboard.service';
import { REPORTS, parseFilters } from './report-defs';
import { ReportsService } from './reports.service';

const D = (v: string | number) => ({ toString: () => String(v) });
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = (s: string) => new Date(`${s}T00:00:00.000Z`);
const actor = (...perms: string[]): any => ({ id: 'u1', permissions: new Set(perms) });
const ALL = ['reports:view', 'reports:export', 'reports:print', 'costing:view', 'purchase_rates:view', 'suppliers:view', 'quotations:view'];

const costing = (over: Record<string, any> = {}) => ({
  id: 'c1', costingNumber: 'COST-1', productName: 'Metal Chair', productCode: 'MC1', costingDate: date('2026-02-01'), createdAt: date('2026-02-01'), status: 'APPROVED', version: 2, quantity: D(2),
  materialCost: D('2326.12'), labourCost: D('1800'), expenseCost: D('0'), basicCost: D('4126.12'), gstAmount: D('742.7'), totalCostInclGst: D('4868.82'), sellingPrice: D('5355.7'),
  profitAmount: D('486.88'), profitPercent: D('11.8'), markupPercent: D('10'), netSellingPrice: D('2677.85'), netBasicRate: D('2063.06'), type: { name: 'Chairs' }, ...over,
});

function make() {
  const prisma: any = {
    costing: { findMany: jest.fn(async () => [costing(), costing({ id: 'c2', costingNumber: 'COST-2', costingDate: date('2026-03-01'), createdAt: date('2026-03-01'), basicCost: D('5000'), sellingPrice: D('6490'), profitPercent: D('10'), profitAmount: D('590'), status: 'DRAFT' }), costing({ id: 'c3', costingNumber: 'COST-3', productName: 'Side Table', productCode: 'ST1', type: { name: 'Tables' }, basicCost: D('2000'), sellingPrice: D('2800'), profitPercent: D('18'), profitAmount: D('300') })]) },
    costingMaterial: { findMany: jest.fn(async () => [
      { total: D('2093.28'), quantity: D('20.94'), effectiveQuantity: D('21.36'), unitId: 'kg', item: { name: 'Pipe' }, costingCategory: { category: { name: 'Frame' }, costingGroup: { group: { name: 'Metal' } } } },
      { total: D('1000'), quantity: D('10'), effectiveQuantity: D('10'), unitId: 'kg', item: { name: 'Plate' }, costingCategory: { category: { name: 'Frame' }, costingGroup: { group: { name: 'Metal' } } } },
      { total: D('216'), quantity: D('0.8'), effectiveQuantity: D('0.8'), unitId: 'kg', item: { name: 'Powder' }, costingCategory: { category: { name: 'Coating' }, costingGroup: { group: { name: 'Powder' } } } },
    ]) },
    costingLabour: { findMany: jest.fn(async () => [
      { rate: D('1200'), total: D('1200'), labour: { name: 'Metal Labour' }, costingGroup: { costingId: 'c1', group: { name: 'Metal' } } },
      { rate: D('1300'), total: D('1300'), labour: { name: 'Metal Labour' }, costingGroup: { costingId: 'c2', group: { name: 'Metal' } } },
      { rate: D('600'), total: D('600'), labour: { name: 'Powder Labour' }, costingGroup: { costingId: 'c1', group: { name: 'Powder' } } },
    ]) },
    purchaseRate: { findMany: jest.fn(async () => [
      { itemId: 'i1', supplierId: 's1', baseRate: D('100'), baseQuantity: D('10'), purchaseDate: date('2026-01-01'), supplier: { name: 'Steel Co' }, item: { name: 'Pipe', unit: { symbol: 'KG' } } },
      { itemId: 'i1', supplierId: 's1', baseRate: D('120'), baseQuantity: D('30'), purchaseDate: date('2026-02-01'), supplier: { name: 'Steel Co' }, item: { name: 'Pipe', unit: { symbol: 'KG' } } },
      { itemId: 'i1', supplierId: 's2', baseRate: D('110'), baseQuantity: D('10'), purchaseDate: date('2026-02-05'), supplier: { name: 'Metals Ltd' }, item: { name: 'Pipe', unit: { symbol: 'KG' } } },
    ]) },
    item: { findMany: jest.fn(async () => [{ id: 'i1', code: 'MPM', name: 'Pipe', defaultPurchaseRate: D('110'), unit: { symbol: 'KG' } }]) },
    unit: { findMany: jest.fn(async () => [{ id: 'kg', symbol: 'KG' }]) },
    priceListItem: { findMany: jest.fn(async () => [{ costingId: 'c1', effectiveExGst: D('4538.73'), priceList: { name: 'Retail', number: 'PL-1' } }]) },
    quotationItem: { findMany: jest.fn(async () => [{ costingId: 'c1', unitPrice: D('4600'), quotation: { number: 'QTN-1', quotationDate: date('2026-02-10'), createdAt: date('2026-02-10') } }]) },
    quotation: { findMany: jest.fn(async () => [
      { number: 'QTN-1', quotationDate: date('2026-02-10'), validUntil: date('2026-03-12'), customerName: 'Acme', status: 'SENT', taxableAmount: D('1000'), gstAmount: D('180'), grandTotal: D('1180'), preparedBy: { name: 'Asha' } },
      { number: 'QTN-2', quotationDate: date('2026-02-11'), validUntil: date('2026-03-13'), customerName: 'Beta', status: 'APPROVED', taxableAmount: D('500'), gstAmount: D('90'), grandTotal: D('590'), preparedBy: { name: 'Asha' } },
    ]) },
    purchaseRateHistory: { findMany: jest.fn(async () => [{ changedAt: new Date('2026-02-05T10:30:00Z'), oldRate: D('100'), newRate: D('110'), source: 'PURCHASE', reason: null, impact: { total: 4 }, changedBy: 'u1', item: { code: 'MPM', name: 'Pipe' } }]) },
    costingRevision: { findMany: jest.fn(async () => [
      { version: 2, note: 'Approved: rates frozen', createdAt: new Date('2026-02-03T09:00:00Z'), createdBy: 'u1', snapshot: { status: 'APPROVED', totals: { basicCost: '4126.12', sellingPrice: '5355.70' } }, costing: { costingNumber: 'COST-1', productName: 'Metal Chair' } },
      { version: 1, note: 'Created', createdAt: new Date('2026-02-01T09:00:00Z'), createdBy: 'u1', snapshot: { status: 'DRAFT', totals: { basicCost: '4000', sellingPrice: '5200' } }, costing: { costingNumber: 'COST-1', productName: 'Metal Chair' } },
    ]) },
    user: { findMany: jest.fn(async () => [{ id: 'u1', name: 'Asha' }]) },
  };
  const company: any = { getRaw: jest.fn(async () => ({ name: 'Acme Furniture', address: 'Pune', phone: null, email: null, gstin: null, currencyCode: 'INR', footerNote: null })), logoBuffer: jest.fn(async () => null) };
  return { svc: new ReportsService(prisma, company), prisma };
}

const run = (id: string, q: Record<string, string> = {}) => make().svc.run(actor(...ALL), id, q);
const pdfText = (buf: Buffer) => [...buf.toString('latin1').matchAll(/\[(.*?)\]\s*TJ/gs)].map((m) => [...m[1].matchAll(/<([0-9a-f]+)>/gi)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('')).join('\n');

describe('filters', () => {
  it('accepts valid filters and rejects malformed ones', () => {
    expect(parseFilters({ from: '2026-01-01', to: '2026-02-01', typeId: u(1), status: 'APPROVED', product: ' chair ' }, ['from', 'to', 'typeId', 'status', 'product'], ['APPROVED'])).toEqual({ from: '2026-01-01', to: '2026-02-01', typeId: u(1), status: 'APPROVED', product: 'chair' });
    expect(() => parseFilters({ from: 'yesterday' }, ['from'])).toThrow(BadRequestException);
    expect(() => parseFilters({ typeId: "1' OR '1'='1" }, ['typeId'])).toThrow(/not a valid id/);
    expect(() => parseFilters({ status: 'WEIRD' }, ['status'], ['APPROVED'])).toThrow(/status must be one of/);
    expect(() => parseFilters({ from: '2026-03-01', to: '2026-01-01' }, ['from', 'to'])).toThrow(/after/);
  });
  it('ignores filters a report does not support', () => {
    expect(parseFilters({ supplierId: 'junk', status: 'x' }, ['from'])).toEqual({});
  });
});

describe('access control', () => {
  it('lists only the reports the user can read and needs reports:view', () => {
    const { svc } = make();
    expect(svc.list(actor())).toEqual([]);
    const costingOnly = svc.list(actor('reports:view', 'costing:view')).map((r) => r.id);
    expect(costingOnly).toEqual(expect.arrayContaining(['product-costing', 'profit', 'wastage']));
    expect(costingOnly).not.toContain('item-purchase-rate');
    expect(costingOnly).not.toContain('quotation');
    expect(svc.list(actor(...ALL))).toHaveLength(12);
  });
  it('blocks a report whose data the user cannot view, even with reports:view', async () => {
    const { svc } = make();
    await expect(svc.run(actor('reports:view', 'costing:view'), 'supplier-rate', {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.run(actor(...ALL), 'nonsense', {})).rejects.toBeInstanceOf(NotFoundException);
  });
  it('export and print need their own permissions', async () => {
    const { svc } = make();
    await expect(svc.excel(actor('reports:view', 'costing:view'), 'profit', {})).rejects.toThrow(/export permission/);
    await expect(svc.pdf(actor('reports:view', 'costing:view'), 'profit', {})).rejects.toThrow(/print permission/);
  });
});

describe('the twelve reports', () => {
  it('product-wise: one row per product with latest costing and price range', async () => {
    const r = await run('product-costing');
    const chair = r.rows.find((x) => x.product === 'Metal Chair')!;
    expect(chair).toMatchObject({ costings: 2, latestNumber: 'COST-1', minSelling: '5355.70', maxSelling: '6490.00', avgProfit: '10.90' });
    expect(r.rows).toHaveLength(2);
    expect(r.totals.costings).toBe('3');
  });
  it('type-wise: sums per type', async () => {
    const r = await run('type-costing');
    expect(r.rows.find((x) => x.type === 'Chairs')).toMatchObject({ costings: 2, basic: '9126.12', selling: '11845.70' });
    expect(r.totals.selling).toBe('14645.70');
  });
  it('group-wise material: cost, wastage share and share of total per group/category', async () => {
    const r = await run('group-material');
    const frame = r.rows.find((x) => x.category === 'Frame')!;
    expect(frame).toMatchObject({ group: 'Metal', lines: 2, cost: '3093.28' });
    expect(frame.wastage).toBe('41.16'); // 2093.28 × (21.36 − 20.94) / 21.36
    expect(r.totals.cost).toBe('3309.28');
    expect(Number(frame.share)).toBeCloseTo(93.47, 1);
  });
  it('item-wise purchase rates: min, max, averages, last and current', async () => {
    const r = await run('item-purchase-rate');
    expect(r.rows[0]).toMatchObject({ code: 'MPM', purchases: 3, min: '100.00', max: '120.00', avg: '110.00', last: '110.00', current: '110.00', lastDate: '2026-02-05' });
    expect(r.rows[0].weighted).toBe('114.00'); // (100×10 + 120×30 + 110×10) / 50 = 5700 / 50
  });
  it('supplier-wise rates: one row per supplier and item', async () => {
    const r = await run('supplier-rate');
    expect(r.rows.map((x) => [x.supplier, x.purchases, x.min, x.max])).toEqual([['Metals Ltd', 1, '110.00', '110.00'], ['Steel Co', 2, '100.00', '120.00']]);
  });
  it('labour cost: totals, average rate and share per labour and group', async () => {
    const r = await run('labour-cost');
    expect(r.rows.find((x) => x.labour === 'Metal Labour')).toMatchObject({ lines: 2, costings: 2, avgRate: '1250.00', cost: '2500.00' });
    expect(r.totals.cost).toBe('3100.00');
  });
  it('wastage: only items with wastage, with percentage and cost', async () => {
    const r = await run('wastage');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ item: 'Pipe', unit: 'KG', base: '20.94', waste: '0.42', wastePct: '2.01', wasteCost: '41.16' });
  });
  it('profit: highest profit % first, with overall profit in the summary', async () => {
    const r = await run('profit');
    expect(r.rows.map((x) => x.number)).toEqual(['COST-3', 'COST-1', 'COST-2']);
    expect(r.totals.profit).toBe('1376.88');
    expect(r.summary[0]).toEqual({ label: 'Total profit', value: '1376.88' });
  });
  it('selling price: costing price against price list and last quotation', async () => {
    const r = await run('selling-price');
    expect(r.rows.find((x) => x.number === 'COST-1')).toMatchObject({ perUnit: '2677.85', priceList: 'PL-1', listPrice: '4538.73', quote: 'QTN-1', quotePrice: '4600.00' });
    expect(r.rows.find((x) => x.number === 'COST-3')).toMatchObject({ priceList: null, quote: null });
  });
  it('quotations: rows, totals and a summary by status', async () => {
    const r = await run('quotation');
    expect(r.totals.total).toBe('1770.00');
    expect(r.summary).toEqual([{ label: 'Sent', value: '1 · 1180.00' }, { label: 'Approved', value: '1 · 590.00' }]);
  });
  it('rate-change impact: size of change, who, and records affected', async () => {
    const r = await run('rate-change-impact');
    expect(r.rows[0]).toMatchObject({ item: 'Pipe', oldRate: '100.00', newRate: '110.00', change: '10.00', by: 'Asha', affected: 4, source: 'purchase' });
    expect(r.totals.affected).toBe('4');
  });
  it('costing history: every version with its status and price at the time, filterable by status', async () => {
    const all = await run('costing-history');
    expect(all.rows.map((x) => [x.version, x.status, x.selling])).toEqual([[2, 'approved', '5355.70'], [1, 'draft', '5200.00']]);
    expect((await run('costing-history', { status: 'DRAFT' })).rows).toHaveLength(1);
  });
});

describe('queries use the filters', () => {
  it('passes date, type, product and status filters to the database', async () => {
    const { svc, prisma } = make();
    await svc.run(actor(...ALL), 'profit', { from: '2026-01-01', to: '2026-01-31', typeId: u(5), status: 'APPROVED', product: 'chair' });
    const where = prisma.costing.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ deletedAt: null, typeId: u(5), status: 'APPROVED' });
    expect(where.costingDate.gte).toEqual(date('2026-01-01'));
    expect(where.costingDate.lte.toISOString()).toBe('2026-01-31T23:59:59.999Z'); // "to" is inclusive of the whole day
    expect(where.OR).toHaveLength(2);
  });
  it('refuses to run over an unreasonable number of records', async () => {
    const { svc, prisma } = make();
    prisma.costing.findMany.mockResolvedValue(Array.from({ length: 100_001 }, () => costing()));
    await expect(svc.run(actor(...ALL), 'profit', {})).rejects.toThrow(/too many records/);
  });
  it('every report definition has unique column keys and a valid filter list', () => {
    expect(new Set(REPORTS.map((r) => r.id)).size).toBe(12);
    for (const r of REPORTS) { expect(new Set(r.columns.map((c) => c.key)).size).toBe(r.columns.length); expect(r.columns.every((c) => c.width > 0)).toBe(true); }
  });
});

describe('Excel and PDF output', () => {
  beforeAll(() => { Pdf.compress = false; });
  afterAll(() => { Pdf.compress = true; });

  it('writes a formatted workbook with SUM totals and the applied filters', async () => {
    const { svc } = make();
    const { buffer, filename } = await svc.excel(actor(...ALL), 'profit', { from: '2026-01-01' });
    expect(filename).toBe('profit.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    const ws = wb.worksheets[0];
    expect(ws.getRow(1).getCell(1).value).toBe('Profit Report');
    expect(String(ws.getRow(2).getCell(1).value)).toContain('From: 2026-01-01');
    const header = ws.getRow(7); // title, filters, generated, 2 summary lines, blank, then the header
    expect(header.getCell(1).value).toBe('Costing');
    expect(ws.getRow(8).getCell(1).value).toBe('COST-3');
    expect(ws.getRow(8).getCell(9).value).toBe(300); // money cells are numbers
    const totals = ws.getRow(11);
    expect(totals.getCell(1).value).toBe('Total');
    expect(totals.getCell(9).value).toMatchObject({ formula: 'SUM(I8:I10)' });
  });

  it('writes a landscape A4 PDF with company, title, filters, rows and totals', async () => {
    const { svc } = make();
    const { buffer, filename } = await svc.pdf(actor(...ALL), 'quotation', { status: 'SENT' });
    expect(filename).toBe('quotation.pdf');
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const box = buffer.toString('latin1').match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!.slice(1).map(Number);
    expect(box[0]).toBeGreaterThan(box[1]);
    const text = pdfText(buffer);
    for (const needle of ['Acme Furniture', 'Quotation Report', 'Status: SENT', 'QTN-1', 'Acme', '1,180.00', 'Total']) expect(text).toContain(needle);
  });

  it('exports every report without error', async () => {
    const { svc } = make();
    for (const r of REPORTS) {
      expect((await svc.excel(actor(...ALL), r.id, {})).buffer.length).toBeGreaterThan(1000);
      expect((await svc.pdf(actor(...ALL), r.id, {})).buffer.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });
});

describe('DashboardService', () => {
  function dash() {
    const live = { deletedAt: null };
    const prisma: any = {
      $queryRaw: jest.fn(async () => [{ n: 3n }]),
      costing: { groupBy: jest.fn(async () => [{ status: 'APPROVED', _count: { _all: 4 } }, { status: 'DRAFT', _count: { _all: 2 } }]), findMany: jest.fn(async () => ([{ id: 'c1', costingNumber: 'COST-1', productName: 'Chair', status: 'APPROVED', sellingPrice: D('5355.7'), updatedAt: new Date(), preparedBy: { name: 'A' } }])) },
      quotation: { groupBy: jest.fn(async () => [{ status: 'PENDING', _count: { _all: 2 }, _sum: { grandTotal: D('2000') } }, { status: 'SENT', _count: { _all: 1 }, _sum: { grandTotal: D('1000') } }, { status: 'APPROVED', _count: { _all: 3 }, _sum: { grandTotal: D('9000') } }]), findMany: jest.fn(async () => []) },
      template: { count: jest.fn(async () => 5) }, supplier: { count: jest.fn(async () => 7) }, item: { count: jest.fn(async () => 42) }, customer: { count: jest.fn(async () => 9) },
      purchaseRateHistory: { findMany: jest.fn(async () => [{ id: 'h', oldRate: D(98), newRate: D(105), source: 'MANUAL', changedAt: new Date(), item: { id: 'i', name: 'Pipe', code: 'P', unit: { symbol: 'KG' } } }]) },
      auditLog: { findMany: jest.fn(async () => []) },
      recalculationBatch: { count: jest.fn(async () => 2) },
    };
    return { svc: new DashboardService(prisma), prisma, live };
  }

  it('returns every section for a user who can see everything', async () => {
    const { svc } = dash();
    const r = await svc.overview(actor('costing:view', 'quotations:view', 'templates:view', 'suppliers:view', 'items:view', 'customers:view', 'purchase_rates:view', 'audit_logs:view'));
    expect(r.counts).toEqual({ products: 3, costings: 6, templates: 5, suppliers: 7, items: 42, customers: 9, pendingRecalculations: 2, quotations: 6, pendingQuotations: 3, approvedQuotations: 3 });
    expect(r.costingsByStatus).toEqual({ APPROVED: 4, DRAFT: 2 });
    expect(r.recentCostings![0]).toMatchObject({ costingNumber: 'COST-1', sellingPrice: '5355.7' });
    expect(r.recentRateChanges![0]).toMatchObject({ oldRate: '98', newRate: '105' });
  });

  it('leaves out anything the user may not see, and never queries it', async () => {
    const { svc, prisma } = dash();
    const r = await svc.overview(actor('items:view'));
    expect(r.counts).toMatchObject({ items: 42, costings: null, quotations: null, suppliers: null, templates: null, pendingQuotations: null });
    expect(r.recentCostings).toBeNull(); expect(r.recentRateChanges).toBeNull(); expect(r.recentQuotations).toBeNull(); expect(r.recentActivity).toBeNull();
    expect(r.quotationValueByStatus).toBeNull();
    expect(prisma.costing.groupBy).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.purchaseRateHistory.findMany).not.toHaveBeenCalled();
    expect(prisma.supplier.count).not.toHaveBeenCalled();
  });
});
