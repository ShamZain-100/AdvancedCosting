import { ALL_COLUMN_KEYS, columnKey } from '@costing/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ExportService } from './export.service';

const D = (v: string) => ({ toString: () => v });
const actor = (...perms: string[]): any => ({ id: 'u1', permissions: new Set(perms) });
const load = async (buffer: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer as never); return wb; };

function make() {
  const prisma: any = {
    type: { findMany: jest.fn().mockResolvedValue([{ code: 'CHAIRS', name: 'Chairs', description: null, isActive: true }]) },
    item: { findMany: jest.fn().mockResolvedValue([{
      code: 'MPM', name: 'Metal Pipe', type: { code: 'CHAIRS' }, group: { code: 'METAL' }, category: { code: 'FRAME' }, unit: { symbol: 'KG' }, defaultPurchaseRate: D('98'), gstPercent: D('18'), hasRateRange: false,
      minRate: null, maxRate: null, avgRate: null, rateMethod: 'LAST_PURCHASE', defaultSupplier: { code: 'SUP01' }, description: null, isActive: true,
      unitConversions: [{ unit: { symbol: 'M' }, conversionValue: D('3.15') }], suppliers: [{ supplier: { code: 'SUP01' }, rate: D('95'), isDefault: true }],
    }]) },
    quotation: { findMany: jest.fn().mockResolvedValue([
      { number: 'Q1', quotationDate: new Date('2026-02-01'), validUntil: new Date('2026-03-03'), customerName: 'Acme', subject: null, status: 'SENT', taxableAmount: D('1000'), gstAmount: D('180'), grandTotal: D('1180'), preparedBy: { name: 'A' } },
      { number: 'Q2', quotationDate: new Date('2026-02-02'), validUntil: new Date('2026-03-04'), customerName: 'Beta', subject: 'x', status: 'DRAFT', taxableAmount: D('500'), gstAmount: D('90'), grandTotal: D('590'), preparedBy: { name: 'A' } },
    ]) },
    unit: { findMany: jest.fn().mockResolvedValue([{ id: 'kg', symbol: 'KG' }, { id: 'pc', symbol: 'PC' }]) },
    costing: { findFirst: jest.fn() },
  };
  const costings: any = { list: jest.fn().mockResolvedValue({ items: [{ costingNumber: 'COST-1', productName: 'Chair', productCode: null, type: { name: 'Chairs' }, costingDate: new Date('2026-01-01'), status: 'APPROVED', version: 2, basicCost: D('4126.12'), totalCostInclGst: D('4868.82'), sellingPrice: D('5355.7'), profitPercent: D('10'), preparedBy: { name: 'A' } }], total: 1 }) };
  return { svc: new ExportService(prisma, costings), prisma, costings };
}

describe('ExportService', () => {
  it('lists only the exports the user is allowed to run', () => {
    const { svc } = make();
    expect(svc.kinds(actor('items:export', 'quotations:export')).map((k) => k.kind)).toEqual(['items', 'quotations']);
    expect(svc.kinds(actor())).toEqual([]);
  });

  it('requires the module export permission', async () => {
    const { svc } = make();
    await expect(svc.export(actor('items:view'), 'items', {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.export(actor(), 'nonsense', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('exports masters in the import layout so the file can be edited and imported again', async () => {
    const { svc } = make();
    const wb = await load((await svc.export(actor('items:export'), 'items', {})).buffer);
    const ws = wb.getWorksheet('Items')!;
    const header = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(String);
    expect(header.slice(0, 6)).toEqual(['Code *', 'Name *', 'Type Code *', 'Group Code *', 'Category Code *', 'Base Unit *']);
    const row = Object.fromEntries(header.map((h, i) => [h, ws.getRow(2).getCell(i + 1).value]));
    expect(row).toMatchObject({ 'Code *': 'MPM', 'Base Unit *': 'KG', 'Default Purchase Rate': '98', 'Unit Conversions': 'M=3.15', Suppliers: 'SUP01=95*', Active: 'Y' });
  });

  it('adds SUM formulas to the totals row of list exports', async () => {
    const { svc } = make();
    const q = (await load((await svc.export(actor('quotations:export'), 'quotations', { status: 'SENT' })).buffer)).getWorksheet('Quotations')!;
    expect(q.getRow(2).getCell(9).value).toBe(1180);
    expect(q.getRow(4).getCell(9).value).toMatchObject({ formula: 'SUM(I2:I3)' });
    const c = (await load((await svc.export(actor('costing:export', ...ALL_COLUMN_KEYS), 'costings', {})).buffer)).getWorksheet('Costings')!;
    expect(c.getRow(2).getCell(10).value).toBe(5355.7);
    expect(c.getRow(3).getCell(8).value).toMatchObject({ formula: 'SUM(H2:H2)' });
  });

  it('exports one costing as Summary / Materials / Labour / Expenses sheets with checks', async () => {
    const { svc, prisma } = make();
    prisma.costing.findFirst.mockResolvedValue({
      costingNumber: 'COST-2026-0001', productName: 'Chair', productCode: 'C1', costingDate: new Date('2026-02-01'), status: 'APPROVED', quantity: D('2'), unitId: 'pc', type: { name: 'Chairs' }, preparedBy: { name: 'Asha' },
      materialCost: D('2326.12'), materialWastage: D('0'), labourCost: D('1800'), expenseCost: D('50'), basicCost: D('4176.12'), gstPercent: D('18'), gstAmount: D('751.7'), totalCostInclGst: D('4927.82'), markupPercent: D('10'), markupAmount: D('492.78'),
      extraPercent: D('5'), extraAmount: D('246.40'), companyExpenseCost: D('30'), sellingPrice: D('5420.6'), profitAmount: D('492.78'), profitPercent: D('11.8'), netBasicRate: D('2088.06'), netSellingPrice: D('2710.3'),
      groups: [{ group: { name: 'Metal' }, categories: [{ category: { name: 'Frame' }, materials: [{ item: { code: 'MPM', name: 'Pipe' }, notes: null, quantity: D('20.94'), unitId: 'kg', effectiveQuantity: D('21.36'), rate: D('98'), total: D('2093.28') }] }], labour: [{ labour: { name: 'Metal Labour' }, quantity: D('1'), unitId: 'pc', rate: D('1200'), total: D('1200') }] }],
      expenses: [{ expense: { name: 'Packing' }, costingGroup: null, calculationMethod: 'FIXED', value: D('50'), quantity: D('1'), applyTiming: 'BEFORE_GST', amount: D('50') }],
    });
    const { buffer, filename } = await svc.costingDetail(actor('costing:export'), 'c1');
    expect(filename).toBe('COST-2026-0001.xlsx');
    const wb = await load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Materials', 'Labour', 'Expenses']);
    const mat = wb.getWorksheet('Materials')!;
    expect(mat.getRow(2).getCell(5).value).toBe('Pipe');
    expect(mat.getRow(2).getCell(9).value).toBeCloseTo(0.42, 5); // wastage = effective − base
    expect(mat.getRow(3).getCell(12).value).toMatchObject({ formula: 'SUM(L2:L2)' });
    expect(wb.getWorksheet('Labour')!.getRow(2).getCell(7).value).toMatchObject({ formula: 'ROUND(D2*F2,2)', result: 1200 });
    const sum = wb.getWorksheet('Summary')!;
    const labels = sum.getColumn(1).values as ExcelJS.CellValue[];
    expect(labels).toContain('Selling price');
    expect(labels).toContain('Extra (5%)');
    expect(labels).toContain('of which company expenses');
    expect(JSON.stringify(sum.getSheetValues())).toContain('Materials!L3');
    await expect(svc.costingDetail(actor('costing:view'), 'c1')).rejects.toBeInstanceOf(ForbiddenException);
    prisma.costing.findFirst.mockResolvedValue(null);
    await expect(svc.costingDetail(actor('costing:export'), 'zz')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the costing summary export leaves out the money columns this user may not see', async () => {
    const { svc } = make();
    const limited = actor('costing:export', columnKey('costings', 'costingNumber'), columnKey('costings', 'productName'), columnKey('costings', 'sellingPrice'));
    const c = (await load((await svc.export(limited, 'costings', {})).buffer)).getWorksheet('Costings')!;
    expect((c.getRow(1).values as any[]).filter(Boolean)).toEqual(['Number', 'Product', 'Code', 'Version', 'Selling price']);
  });
});
