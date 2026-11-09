import { BadRequestException } from '@nestjs/common';
import { CostingsService } from './costings.service';
import { RateImpactService } from '../purchase-rates/rate-impact.service';
import { testSettings } from '../settings/test-helpers';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const D = (v: string | number) => ({ toString: () => String(v) });
const TYPE = u(1), GROUP = u(2), CAT = u(3), ITEM = u(4), KG = u(10), LAB = u(20), EXP = u(30), RENT = u(31);
const unitKg = { id: KG, symbol: 'KG', unitType: 'WEIGHT', baseFactor: null };
const rules = { decimals: 2, rounding: 'HALF_UP', roundLines: true, materialRatesIncludeGst: false, labourRatesIncludeGst: false, expenseRatesIncludeGst: false, gstMode: 'COSTING', wastageMode: 'MOST_SPECIFIC', markupBase: 'TOTAL_COST', profitBase: 'BASIC_COST' };

const ownMaster = { id: EXP, name: 'Packing', calculationMethod: 'FIXED', defaultValue: D('100'), applyTiming: 'BEFORE_GST' };
const rentMaster = { id: RENT, name: 'Factory rent', calculationMethod: 'FIXED', defaultValue: D('100'), applyTiming: 'BEFORE_GST', isCompanyExpense: true };

/** 20.94 kg x 98 = 2052.12, labour 1200, own expense 100 (+ company expense 100 when present); GST 18 %, markup 10 %. */
const payload = (over: Record<string, any> = {}) => ({
  productName: 'Chair', typeId: TYPE, quantity: '1', costingDate: '2026-01-15', wastagePercent: '0', gstPercent: '18', markupPercent: '10',
  groups: [{ groupId: GROUP, categories: [{ categoryId: CAT, materials: [{ itemId: ITEM, quantity: '20.94', unitId: KG, wastageMode: 'PERCENT', rateBasis: 'STANDARD' }] }], labour: [{ labourId: LAB, quantity: '1' }] }],
  expenses: [{ expenseId: EXP }], ...over,
});

function make(company: any[] = []) {
  const tx: any = {
    costing: { update: jest.fn(), findUniqueOrThrow: jest.fn() },
    costingGroup: { deleteMany: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'tg1' }) },
    costingExpense: { deleteMany: jest.fn(), createMany: jest.fn() },
    costingRevision: { create: jest.fn() },
  };
  const db: any = {
    item: { findMany: jest.fn().mockResolvedValue([{ id: ITEM, name: 'Pipe', unitId: KG, unit: unitKg, gstPercent: '18', defaultPurchaseRate: '98', hasRateRange: false, unitConversions: [], suppliers: [] }]) },
    areaConversion: { findMany: jest.fn().mockResolvedValue([]) },
    unit: { findMany: jest.fn().mockResolvedValue([unitKg]) },
    labour: { findMany: jest.fn().mockResolvedValue([{ id: LAB, defaultRate: '1200' }]) },
    // company expenses are looked up first (where.isCompanyExpense), then the expenses the costing names
    expense: { findMany: jest.fn(async (a: any) => (a?.where?.isCompanyExpense ? company : [ownMaster, rentMaster].filter((m) => a.where.id.in.includes(m.id)))) },
    supplier: { findMany: jest.fn().mockResolvedValue([]) },
    costing: { findFirst: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const svc = new CostingsService(db, { log: jest.fn() } as any, { getRules: jest.fn().mockResolvedValue(rules) } as any, { validateTree: jest.fn() } as any, new RateImpactService(),
    { mainImages: async () => new Map(), copyLinks: jest.fn() } as any, testSettings().numbering, testSettings().appSettings);
  return { svc, db, tx, actor: { id: 'u1', permissions: new Set<string>(['costing:edit']) } as any };
}

describe('extra percentage through the server', () => {
  it('flows from the payload into the figures: extra, markup on the uplifted cost, selling price', async () => {
    const { svc, actor } = make();
    const r = await svc.preview(actor, payload({ extraPercent: '5' }));
    // basic 3352.12, GST 603.38, total 3955.50; extra 5 % = 197.775; markup on (3955.50 + 197.78) = 415.328
    expect(r).toMatchObject({ totalCostInclGst: '3955.5', extraAmount: '197.78', markupAmount: '415.33', sellingPrice: '4568.61', companyExpenseCost: '0' });
  });

  it('defaults to no extra and leaves the old figures unchanged', async () => {
    const { svc, actor } = make();
    const r = await svc.preview(actor, payload());
    expect(r).toMatchObject({ extraAmount: '0', sellingPrice: '4351.05' });
  });

  it('is rejected above 100 with a 400', async () => {
    const { svc, actor } = make();
    const err = await svc.preview(actor, payload({ extraPercent: '101' })).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).toMatch(/extraPercent.*Max 100|Max 100.*extraPercent/s);
  });
});

describe('company expenses through the server', () => {
  it('are added to the costing by the server and reported separately, locked', async () => {
    const { svc, actor } = make([rentMaster]);
    const r: any = await svc.preview(actor, payload({ extraPercent: '5' }));
    // basic 3452.12 (own 100 + company 100), GST 621.38, total 4073.50, extra 203.68, markup 427.72
    expect(r).toMatchObject({ basicCost: '3452.12', expenseCost: '200', companyExpenseCost: '100', extraAmount: '203.68', sellingPrice: '4704.9' });
    expect(r.companyExpenses).toEqual([{ expenseId: RENT, name: 'Factory rent', method: 'FIXED', value: '100', timing: 'BEFORE_GST', amount: '100' }]);
    // the editor's own rows keep their position: company rows are not among them
    expect(Object.keys(r.rows.expenses)).toEqual(['e0']);
  });

  it('a row the client sends for a company expense is ignored (it cannot be added twice or changed)', async () => {
    const { svc, actor } = make([rentMaster]);
    const tampered = payload({ expenses: [{ expenseId: EXP }, { expenseId: RENT, calculationMethod: 'FIXED', value: '1' }] });
    const r: any = await svc.preview(actor, tampered);
    expect(r.companyExpenseCost).toBe('100');
    expect(r.expenseCost).toBe('200');
  });

  it('without company expenses nothing changes', async () => {
    const { svc, actor } = make([]);
    const r: any = await svc.preview(actor, payload());
    expect(r.companyExpenses).toEqual([]);
    expect(r.expenseCost).toBe('100');
  });
});

describe('saving a costing with company expenses and an extra %', () => {
  const stored = (over: Record<string, any> = {}, expenses: any[] = []) => ({
    id: 'c1', costingNumber: 'COST-2026-0001', productName: 'Chair', productCode: null, typeId: TYPE, templateId: null, description: null, length: null, width: null, height: null, dimensionUnitId: null,
    quantity: D(1), unitId: null, costingDate: new Date('2026-02-01'), notes: null, wastagePercent: D(0), gstPercent: D(18), markupPercent: D(10), extraPercent: D(5), status: 'DRAFT', pricingMode: 'LIVE', version: 3,
    basicCost: D('3352.12'), gstAmount: D('603.38'), totalCostInclGst: D('3955.5'), extraAmount: D('197.78'), companyExpenseCost: D(0), sellingPrice: D('4568.61'),
    groups: [{
      groupId: GROUP, wastagePercent: null,
      categories: [{ categoryId: CAT, wastagePercent: null, materials: [{ itemId: ITEM, notes: null, quantity: D('20.94'), unitId: KG, wastageMode: 'PERCENT', wastagePercent: null, wastageQuantity: null, rateBasis: 'STANDARD', supplierId: null, rate: D('98'), total: D('2052.12'), effectiveQuantity: D('20.94') }] }],
      labour: [{ labourId: LAB, quantity: D(1), unitId: null, customRate: false, rate: D('1200'), total: D('1200') }],
    }],
    expenses: [{ expenseId: EXP, costingGroup: null, calculationMethod: 'FIXED', value: D('100'), quantity: D(1), applyTiming: 'BEFORE_GST', overrideFields: [], amount: D('100'), isCompany: false, expense: { name: 'Packing' } }, ...expenses],
    ...over,
  });

  it('a recalculation adds a newly flagged company expense and stores it as a locked row, with the extra and the company cost', async () => {
    const { svc, db, tx, actor } = make([rentMaster]);
    db.costing.findFirst.mockResolvedValue(stored());
    tx.costing.findUniqueOrThrow.mockResolvedValue(stored());
    const r = await svc.recalculate(actor, 'c1', { note: 'Company expense added' });
    expect(r).toMatchObject({ outcome: 'CHANGED', before: { selling: '4568.61' }, after: { selling: '4704.9' } });
    expect(tx.costing.update.mock.calls[0][0].data).toMatchObject({ extraPercent: '5', extraAmount: '203.68', companyExpenseCost: '100', sellingPrice: '4704.9', version: 4 });
    const rows = tx.costingExpense.createMany.mock.calls[0][0].data;
    expect(rows.map((x: any) => [x.expenseId, x.isCompany])).toEqual([[EXP, false], [RENT, true]]);
    expect(rows[1]).toMatchObject({ calculationMethod: 'FIXED', value: '100', overrideFields: [], amount: '100', sortOrder: 1 });
  });

  it('a deactivated company expense disappears from live costings on recalculation', async () => {
    const { svc, db, tx, actor } = make([]); // no active company expenses any more
    const withRent = stored({ companyExpenseCost: D(100), basicCost: D('3452.12'), gstAmount: D('621.38'), totalCostInclGst: D('4073.5'), extraAmount: D('203.68'), sellingPrice: D('4704.9') },
      [{ expenseId: RENT, costingGroup: null, calculationMethod: 'FIXED', value: D('100'), quantity: D(1), applyTiming: 'BEFORE_GST', overrideFields: [], amount: D('100'), isCompany: true, expense: { name: 'Factory rent' } }]);
    db.costing.findFirst.mockResolvedValue(withRent);
    tx.costing.findUniqueOrThrow.mockResolvedValue(withRent);
    const r = await svc.recalculate(actor, 'c1');
    expect(r).toMatchObject({ outcome: 'CHANGED', after: { selling: '4568.61' } });
    expect(tx.costingExpense.createMany.mock.calls[0][0].data.map((x: any) => x.isCompany)).toEqual([false]);
  });

  it('the editor payload never contains company rows, and carries the extra %', async () => {
    const { svc } = make();
    const withRent = stored({}, [{ expenseId: RENT, costingGroup: null, calculationMethod: 'FIXED', value: D('100'), quantity: D(1), applyTiming: 'BEFORE_GST', overrideFields: [], amount: D('100'), isCompany: true, expense: { name: 'Factory rent' } }]);
    const payloadOut = svc.toPayload(withRent as any);
    expect(payloadOut.extraPercent).toBe('5');
    expect(payloadOut.expenses.map((e) => e.expenseId)).toEqual([EXP]);
  });

  it('the costing screen gets the company rows separately, with their names, and row amounts that line up with its own rows', async () => {
    const { svc, db } = make();
    const withRent = stored({}, [{ expenseId: RENT, costingGroup: null, calculationMethod: 'FIXED', value: D('100'), quantity: D(1), applyTiming: 'BEFORE_GST', overrideFields: [], amount: D('100'), isCompany: true, expense: { name: 'Factory rent' } }]);
    db.costing.findFirst.mockResolvedValue({ ...withRent, type: null, preparedBy: null });
    const g: any = await svc.get('c1');
    expect(g.rows.expenses).toEqual([{ amount: '100' }]);
    expect(g.companyExpenses).toEqual([{ expenseId: RENT, name: 'Factory rent', method: 'FIXED', value: '100', timing: 'BEFORE_GST', amount: '100' }]);
    expect(g.totals).toMatchObject({ extraAmount: '197.78', companyExpenseCost: '0' });
  });

  it('a frozen costing reports the figures it was saved with, in the shape of a preview', async () => {
    const { svc, db } = make();
    const saved = stored({
      status: 'APPROVED', materialCost: D('1000'), materialWastage: D('50'), labourCost: D('200'), expenseCost: D('130'), basicCost: D('1300'), gstAmount: D('234'),
      totalCostInclGst: D('1564'), extraPercent: D('5'), extraAmount: D('78.20'), companyExpenseCost: D('100'), markupPercent: D('10'), markupAmount: D('137.82'), sellingPrice: D('1780.02'),
      netBasicRate: D('650'), netSellingPrice: D('890.01'), rules: { decimals: 2 },
    });
    db.costing.findFirst.mockResolvedValue({ ...saved, type: null, preparedBy: null });
    const g: any = await svc.get('c1');
    expect(g.summary).toMatchObject({ basicCost: '1300', sellingPrice: '1780.02', extraAmount: '78.20', netSellingPrice: '890.01' });
    const step = (key: string) => g.summary.breakdown.find((b: any) => b.key === key);
    expect(step('expenseAfter').amount).toBe('30'); // 1564 - 1300 - 234
    expect(step('expenseBefore').amount).toBe('100'); // 130 - 30
    expect(step('extra').label).toBe('Extra 5%');
    expect(Object.keys(g.summary.rows.materials)).toContain('m0.0.0');
  });

  it('a costing still being edited has no saved summary: it is always previewed live', async () => {
    const { svc, db } = make();
    db.costing.findFirst.mockResolvedValue({ ...stored({ status: 'DRAFT' }), type: null, preparedBy: null });
    expect(((await svc.get('c1')) as any).summary).toBeNull();
  });
});
