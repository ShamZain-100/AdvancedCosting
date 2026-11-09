import { CostingsService } from './costings.service';
import { RateImpactService } from '../purchase-rates/rate-impact.service';
import { testSettings } from '../settings/test-helpers';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const D = (v: string | number) => ({ toString: () => String(v) });
const TYPE = u(1), GROUP = u(2), CAT = u(3), ITEM = u(4), KG = u(10), LAB = u(20), EXP = u(30);
const unitKg = { id: KG, symbol: 'KG', unitType: 'WEIGHT', baseFactor: null };

/** A stored LIVE draft: 20.94 kg × 98 + labour 1200 + packing 100, GST 18 %, markup 10 % → selling 4351.05. */
const costing = (over: Record<string, any> = {}, expense: Record<string, any> = {}) => ({
  id: 'c1', costingNumber: 'COST-2026-0001', productName: 'Chair', productCode: null, typeId: TYPE, templateId: null, description: null, length: null, width: null, height: null, dimensionUnitId: null,
  quantity: D(1), unitId: null, costingDate: new Date('2026-02-01'), notes: null, wastagePercent: D(0), gstPercent: D(18), markupPercent: D(10), status: 'DRAFT', pricingMode: 'LIVE', version: 3,
  basicCost: D('3352.12'), gstAmount: D('603.38'), totalCostInclGst: D('3955.5'), sellingPrice: D('4351.05'),
  groups: [{
    groupId: GROUP, wastagePercent: null,
    categories: [{ categoryId: CAT, wastagePercent: null, materials: [{ itemId: ITEM, notes: null, quantity: D('20.94'), unitId: KG, wastageMode: 'PERCENT', wastagePercent: null, wastageQuantity: null, rateBasis: 'STANDARD', supplierId: null, rate: D('98'), total: D('2052.12'), effectiveQuantity: D('20.94') }] }],
    labour: [{ labourId: LAB, quantity: D(1), unitId: null, customRate: false, rate: D('1200'), total: D('1200') }],
  }],
  expenses: [{ expenseId: EXP, costingGroup: null, calculationMethod: 'FIXED', value: D('100'), quantity: D(1), applyTiming: 'BEFORE_GST', overrideFields: [], amount: D('100'), ...expense }],
  ...over,
});

function make(stored: any, masters: { itemRate?: string; labourRate?: string; expenseValue?: string } = {}) {
  const tx: any = {
    costing: { update: jest.fn(), findUniqueOrThrow: jest.fn().mockResolvedValue(stored) },
    costingGroup: { deleteMany: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'tg1' }) },
    costingExpense: { deleteMany: jest.fn(), createMany: jest.fn() },
    costingRevision: { create: jest.fn() },
  };
  const db: any = {
    costing: { findFirst: jest.fn().mockResolvedValue(stored) },
    item: { findMany: jest.fn().mockResolvedValue([{ id: ITEM, name: 'Pipe', unitId: KG, unit: unitKg, gstPercent: '18', defaultPurchaseRate: masters.itemRate ?? '98', hasRateRange: false, unitConversions: [], suppliers: [] }]) },
    areaConversion: { findMany: jest.fn().mockResolvedValue([]) },
    unit: { findMany: jest.fn().mockResolvedValue([unitKg]) },
    labour: { findMany: jest.fn().mockResolvedValue([{ id: LAB, defaultRate: masters.labourRate ?? '1200' }]) },
    // the first lookup is the company expenses (none here), the second the expenses the costing names
    expense: { findMany: jest.fn(async (a: any) => (a?.where?.isCompanyExpense ? [] : [{ id: EXP, calculationMethod: 'FIXED', defaultValue: masters.expenseValue ?? '100', applyTiming: 'BEFORE_GST' }])) },
    supplier: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const templates: any = { validateTree: jest.fn() };
  const settings: any = { getRules: jest.fn().mockResolvedValue({ decimals: 2, rounding: 'HALF_UP', roundLines: true, materialRatesIncludeGst: false, labourRatesIncludeGst: false, expenseRatesIncludeGst: false, gstMode: 'COSTING', wastageMode: 'MOST_SPECIFIC', markupBase: 'TOTAL_COST', profitBase: 'BASIC_COST' }) };
  const audit: any = { log: jest.fn() };
  const svc = new CostingsService(db, audit, settings, templates, new RateImpactService(), { mainImages: async () => new Map(), copyLinks: jest.fn() } as any, testSettings().numbering, testSettings().appSettings);
  return { svc, db, tx, audit, actor: { id: 'u1', permissions: new Set<string>() } as any };
}

describe('CostingsService.recalculate', () => {
  it('reports UNCHANGED and writes nothing when the masters still give the same figures', async () => {
    const { svc, tx, actor } = make(costing());
    const r = await svc.recalculate(actor, 'c1');
    expect(r.outcome).toBe('UNCHANGED');
    expect(r.after.selling).toBe('4351.05');
    expect(tx.costing.update).not.toHaveBeenCalled();
  });

  it('picks up a new item rate, saves a new version and records why', async () => {
    const { svc, tx, audit, actor } = make(costing(), { itemRate: '105' });
    const r = await svc.recalculate(actor, 'c1', { note: 'Pipe: rate 98 → 105 (recalculation)' });
    // 20.94 × 105 = 2198.70; basic 3498.70; GST 629.77; total 4128.47; markup 412.85; selling 4541.32
    expect(r).toMatchObject({ outcome: 'CHANGED', before: { selling: '4351.05' }, after: { basic: '3498.7', selling: '4541.32' } });
    expect(tx.costing.update.mock.calls[0][0].data).toMatchObject({ version: 4, sellingPrice: '4541.32', basicCost: '3498.7' });
    expect(tx.costingRevision.create.mock.calls[0][0].data).toMatchObject({ version: 4, note: 'Pipe: rate 98 → 105 (recalculation)' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'recalculate', metadata: expect.objectContaining({ sellingPriceBefore: '4351.05', sellingPriceAfter: '4541.32' }) }));
  });

  it('dry run shows the new figures but writes nothing', async () => {
    const { svc, db, tx, audit, actor } = make(costing(), { itemRate: '105' });
    const r = await svc.recalculate(actor, 'c1', { dryRun: true });
    expect(r.outcome).toBe('CHANGED');
    expect(r.after.selling).toBe('4541.32');
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.costing.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('follows a changed labour rate unless the costing carries a custom labour rate', async () => {
    const live = make(costing(), { labourRate: '1300' });
    expect((await live.svc.recalculate(live.actor, 'c1', { dryRun: true })).after.basic).toBe('3452.12');
    const custom = costing();
    custom.groups[0].labour[0].customRate = true;
    const kept = make(custom, { labourRate: '1300' });
    // a stored custom rate is kept (and allowed for the background actor because it already exists on the costing)
    expect((await kept.svc.recalculate(kept.actor, 'c1', { dryRun: true })).outcome).toBe('UNCHANGED');
  });

  it('expense fields that follow the master change with it; overridden ones do not', async () => {
    const follows = make(costing(), { expenseValue: '150' });
    expect((await follows.svc.recalculate(follows.actor, 'c1', { dryRun: true })).after.basic).toBe('3402.12');
    const overridden = make(costing({}, { overrideFields: ['value'] }), { expenseValue: '150' });
    expect((await overridden.svc.recalculate(overridden.actor, 'c1', { dryRun: true })).outcome).toBe('UNCHANGED');
  });

  it('never touches approved (frozen) costings', async () => {
    const approved = make(costing({ status: 'APPROVED', pricingMode: 'SNAPSHOT' }), { itemRate: '999' });
    const r = await approved.svc.recalculate(approved.actor, 'c1');
    expect(r).toMatchObject({ outcome: 'SKIPPED' });
    expect(r.reason).toMatch(/snapshot/);
    expect(approved.db.item.findMany).not.toHaveBeenCalled();
    expect(approved.db.$transaction).not.toHaveBeenCalled();
  });

  it('leaves a costing that is waiting for approval alone', async () => {
    const pending = make(costing({ status: 'PENDING_APPROVAL' }), { itemRate: '999' });
    const r = await pending.svc.recalculate(pending.actor, 'c1');
    expect(r).toMatchObject({ outcome: 'SKIPPED' });
    expect(r.reason).toMatch(/Waiting for approval/);
    expect(pending.db.$transaction).not.toHaveBeenCalled();
  });

  it('a rejected costing is recalculated and goes back to draft', async () => {
    const { svc, tx, actor } = make(costing({ status: 'REJECTED' }), { itemRate: '105' });
    await svc.recalculate(actor, 'c1');
    expect(tx.costing.update.mock.calls[0][0].data.status).toBe('DRAFT');
  });

  it('the Refresh rates button says when nothing changed and refuses frozen costings', async () => {
    const same = make(costing());
    jest.spyOn(same.svc, 'get').mockResolvedValue({ id: 'c1' } as any);
    expect(await same.svc.refreshRates(same.actor, 'c1')).toMatchObject({ unchanged: true });
    const frozen = make(costing({ status: 'APPROVED', pricingMode: 'SNAPSHOT' }));
    await expect(frozen.svc.refreshRates(frozen.actor, 'c1')).rejects.toThrow(/snapshot/);
  });
});
