import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PriceListsService } from './price-lists.service';
import { testSettings } from '../settings/test-helpers';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C1 = u(1), C2 = u(2), LIST = u(9);

const costing = (id: string, over: Record<string, any> = {}) => ({
  id, costingNumber: `COST-2026-000${id.slice(-1)}`, productName: id === C1 ? 'Metal Chair' : 'Side Table', productCode: id === C1 ? 'MC1' : 'ST1',
  version: 3, status: 'APPROVED', basicCost: '4126.12', totalCostInclGst: '4868.82', gstPercent: '18', gstAmount: '742.70', extraAmount: '0', quantity: '1', ...over,
});

const body = (items: any[] = [{ costingId: C1, profitMethod: 'PERCENT', profitValue: '20' }], over: Record<string, any> = {}) => ({
  name: 'Retail 2026', effectiveDate: '2026-02-01', costBase: 'BASIC_COST', gstTreatment: 'EXCLUSIVE', items, ...over,
});

function make(costings: any[] = [costing(C1), costing(C2)]) {
  const tx: any = {
    numberSequence: { upsert: jest.fn().mockResolvedValue({ value: 7 }) },
    priceList: { create: jest.fn().mockResolvedValue({ id: LIST }), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    priceListItem: { createMany: jest.fn(), deleteMany: jest.fn(), update: jest.fn() },
  };
  const db: any = {
    costing: { findMany: jest.fn(async ({ where }: any) => costings.filter((c) => where.id.in.includes(c.id))) },
    priceList: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
    priceListItem: { findMany: jest.fn(), createMany: jest.fn(), count: jest.fn() },
    reviewFlag: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const settings: any = { getRules: jest.fn().mockResolvedValue({ decimals: 2, rounding: 'HALF_UP' }) };
  const svc = new PriceListsService(db, { log: jest.fn() } as any, settings, { mainImages: async () => new Map() } as any, testSettings().numbering);
  return { svc, db, tx, actor: { id: 'u1' } as any };
}

/** What get() would return for a stored list; used to stub the re-read after a write. */
const stored = (over: Record<string, any> = {}, items: any[] = []) => ({
  id: LIST, number: 'PL-2026-0007', name: 'Retail 2026', status: 'DRAFT', effectiveDate: new Date('2026-02-01'), costBase: 'BASIC_COST', gstTreatment: 'EXCLUSIVE',
  roundTo: null, defaultProfitMethod: 'PERCENT', defaultProfitValue: '20', defaultDiscountPercent: null, notes: null, deletedAt: null, items, ...over,
});
const storedItem = (over: Record<string, any> = {}) => ({
  id: 'i1', priceListId: LIST, costingId: C1, costingVersion: 3, productName: 'Metal Chair', productCode: 'MC1', sortOrder: 0, profitMethod: 'PERCENT', profitValue: '20',
  discountPercent: null, discountAmount: null, minPrice: null, maxPrice: null, notes: null, effectivePrice: '4951.34', flags: [],
  costBaseAmount: '4126.12', profitAmount: '825.22', listPriceExGst: '4951.34', gstAmount: '891.24', listPriceInclGst: '5842.58', sellingPrice: '4951.34', discountApplied: '0',
  effectiveExGst: '4951.34', effectiveInclGst: '5842.58', effectiveProfit: '825.22', marginPercent: '16.67', markupPercent: '20',
  costing: { costingNumber: 'COST-2026-0001', version: 3, status: 'APPROVED', deletedAt: null }, ...over,
});

describe('PriceListsService calculation', () => {
  it('prices one unit, including the extra % and after-GST expenses', async () => {
    const { svc } = make([costing(C1, { basicCost: '1000', gstAmount: '180', totalCostInclGst: '1280', extraAmount: '64', quantity: '2' })]);
    const r = await svc.preview(body([{ costingId: C1, profitMethod: 'PERCENT', profitValue: '0' }]));
    expect(r.items[0]).toMatchObject({ basicCost: '569.49', totalCostInclGst: '672', costBaseAmount: '569.49', listPriceInclGst: '672', pricedPerUnit: true });
  });

  it('prices an approved costing with percentage profit', async () => {
    const { svc } = make();
    const r = await svc.preview(body());
    expect(r.items[0]).toMatchObject({ costingId: C1, basicCost: '4126.12', profitAmount: '825.22', sellingPrice: '4951.34', listPriceInclGst: '5842.58', effectivePrice: '4951.34', costingVersion: 3 });
  });

  it('supports fixed profit, discount, and min / max prices', async () => {
    const { svc } = make();
    const fixed = await svc.preview(body([{ costingId: C1, profitMethod: 'FIXED', profitValue: '500' }]));
    expect(fixed.items[0].sellingPrice).toBe('4626.12');
    const capped = await svc.preview(body([{ costingId: C1, profitMethod: 'PERCENT', profitValue: '20', maxPrice: '4500', discountPercent: '50', minPrice: '3000' }]));
    expect(capped.items[0]).toMatchObject({ sellingPrice: '4500', effectivePrice: '3000' });
    expect(capped.items[0].flags).toEqual(expect.arrayContaining(['MAX_APPLIED', 'DISCOUNT_LIMITED']));
  });

  it('can base profit on total cost and quote GST-inclusive prices', async () => {
    const { svc } = make();
    const r = await svc.preview(body([{ costingId: C1, profitMethod: 'PERCENT', profitValue: '10' }], { costBase: 'TOTAL_COST', gstTreatment: 'INCLUSIVE' }));
    expect(r.items[0].sellingPrice).toBe('5355.7');
  });

  it('refuses costings that are not approved (draft figures are not frozen)', async () => {
    const { svc } = make([costing(C1, { status: 'DRAFT' })]);
    await expect(svc.preview(body())).rejects.toThrow(/Only approved costings/);
  });

  it('rejects unknown costings, duplicates and inconsistent prices', async () => {
    const { svc } = make([costing(C1)]);
    await expect(svc.preview(body([{ costingId: C2, profitMethod: 'PERCENT', profitValue: '1' }]))).rejects.toThrow(/do not exist/);
    await expect(svc.preview(body([{ costingId: C1, profitMethod: 'PERCENT', profitValue: '1' }, { costingId: C1, profitMethod: 'PERCENT', profitValue: '1' }]))).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.preview(body([{ costingId: C1, profitMethod: 'PERCENT', profitValue: '1', minPrice: '10', maxPrice: '5' }]))).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.preview(body([{ costingId: C1, profitMethod: 'PERCENT', profitValue: '1', discountPercent: '5', discountAmount: '5' }]))).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PriceListsService persistence', () => {
  it('generates a price list for many costings with shared settings and a numbered header', async () => {
    const { svc, tx, actor } = make();
    jest.spyOn(svc, 'get').mockResolvedValue({ id: LIST } as any);
    await svc.generate(actor, {
      name: 'Bulk', effectiveDate: '2026-02-01', costBase: 'BASIC_COST', gstTreatment: 'EXCLUSIVE', profitMethod: 'PERCENT', profitValue: '15', costingIds: [C1, C2, C1],
    });
    expect(tx.priceList.create.mock.calls[0][0].data).toMatchObject({ number: 'PL-' + new Date().getUTCFullYear() + '-0007', defaultProfitValue: '15' });
    const rows = tx.priceListItem.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2); // duplicate costing id collapsed
    expect(rows.map((r: any) => r.productName)).toEqual(['Metal Chair', 'Side Table']);
    expect(rows[0]).toMatchObject({ priceListId: LIST, sellingPrice: '4745.04' }); // 4126.12 × 1.15
  });

  it('only drafts can be edited, repriced or extended', async () => {
    const { svc, db, actor } = make();
    db.priceList.findFirst.mockResolvedValue(stored({ status: 'ACTIVE' }));
    await expect(svc.update(actor, LIST, body())).rejects.toThrow(/Only draft/);
    await expect(svc.reprice(actor, LIST)).rejects.toThrow(/Only draft/);
    await expect(svc.addCostings(actor, LIST, { costingIds: [C1] })).rejects.toThrow(/Only draft/);
  });

  it('adds costings using the list defaults and skips ones already present', async () => {
    const { svc, db, actor } = make();
    db.priceList.findFirst.mockResolvedValue(stored());
    db.priceListItem.findMany.mockResolvedValue([{ costingId: C1 }]);
    jest.spyOn(svc, 'get').mockResolvedValue({ id: LIST } as any);
    await svc.addCostings(actor, LIST, { costingIds: [C1, C2] });
    const rows = db.priceListItem.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ costingId: C2, sortOrder: 1, sellingPrice: '4951.34' });
  });

  it('reprice picks up a re-approved costing', async () => {
    const { svc, db, tx, actor } = make([costing(C1, { version: 4, basicCost: '5000.00', gstAmount: '900.00', totalCostInclGst: '5900.00' })]);
    db.priceList.findFirst.mockResolvedValue(stored());
    db.priceListItem.findMany.mockResolvedValue([{ id: 'i1', costingId: C1, costingVersion: 3, sortOrder: 0, profitMethod: 'PERCENT', profitValue: { toString: () => '20' }, effectivePrice: { toString: () => '4951.34' } }]);
    jest.spyOn(svc, 'get').mockResolvedValue({ id: LIST } as any);
    const r = await svc.reprice(actor, LIST);
    expect(r.changed).toBe(1);
    expect(tx.priceListItem.update.mock.calls[0][0].data).toMatchObject({ costingVersion: 4, sellingPrice: '6000' });
  });
});

describe('PriceListsService status and staleness', () => {
  it('flags items whose costing changed, was reopened or deleted', async () => {
    const { svc, db } = make();
    db.priceList.findFirst.mockResolvedValue(stored({}, [
      storedItem(),
      storedItem({ id: 'i2', costing: { costingNumber: 'X', version: 4, status: 'APPROVED', deletedAt: null } }),
      storedItem({ id: 'i3', costing: { costingNumber: 'X', version: 3, status: 'DRAFT', deletedAt: null } }),
      storedItem({ id: 'i4', costing: { costingNumber: 'X', version: 3, status: 'APPROVED', deletedAt: new Date() } }),
    ]));
    const l = await svc.get(LIST);
    expect(l.items.map((i) => i.staleReason)).toEqual([null, 'Costing changed since pricing', 'Costing is no longer approved', 'Costing deleted']);
    expect(l.payload.items[0]).toMatchObject({ costingId: C1, profitValue: '20' });
  });

  it('will not activate a list with stale or no items', async () => {
    const { svc, db, actor } = make();
    db.priceList.findFirst.mockResolvedValue(stored({}, [storedItem({ costing: { costingNumber: 'X', version: 9, status: 'APPROVED', deletedAt: null } })]));
    await expect(svc.setStatus(actor, LIST, { status: 'ACTIVE' })).rejects.toThrow(/Reprice the list/);
    db.priceList.findFirst.mockResolvedValue(stored({}, []));
    db.priceListItem.count.mockResolvedValue(0);
    await expect(svc.setStatus(actor, LIST, { status: 'ACTIVE' })).rejects.toThrow(/at least one product/);
  });

  it('activates a clean list and blocks deleting an active one', async () => {
    const { svc, db, actor } = make();
    db.priceList.findFirst.mockResolvedValue(stored({}, [storedItem()]));
    db.priceListItem.count.mockResolvedValue(1);
    expect(await svc.setStatus(actor, LIST, { status: 'ACTIVE' })).toEqual({ id: LIST, status: 'ACTIVE' });
    db.priceList.findFirst.mockResolvedValue(stored({ status: 'ACTIVE' }));
    await expect(svc.remove(actor, LIST)).rejects.toThrow(/Archive or revert/);
  });

  it('404s for a missing list', async () => {
    const { svc, db } = make();
    db.priceList.findFirst.mockResolvedValue(null);
    await expect(svc.get(LIST)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PriceListsService export', () => {
  it('builds a formatted workbook with one row per product', async () => {
    const { svc, db } = make();
    db.priceList.findFirst.mockResolvedValue(stored({}, [storedItem()]));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await svc.exportExcel(LIST)) as never);
    const ws = wb.getWorksheet('Price List')!;
    expect(ws.getRow(1).getCell(1).value).toContain('Retail 2026');
    expect(ws.getRow(4).getCell(3).value).toBe('Product');
    expect(ws.getRow(5).getCell(3).value).toBe('Metal Chair');
    expect(ws.getRow(5).getCell(13).value).toBe(4951.34);
    expect(ws.getRow(5).getCell(14).value).toBe(5842.58);
  });
});
