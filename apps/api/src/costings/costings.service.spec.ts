import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CostingsService } from './costings.service';
import { RateImpactService } from '../purchase-rates/rate-impact.service';
import { testSettings } from '../settings/test-helpers';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TYPE = u(1), GROUP = u(2), CAT = u(3), ITEM = u(4), KG = u(10), M = u(11), LAB = u(20), EXP = u(30), SUP = u(40);

const unitKg = { id: KG, symbol: 'KG', unitType: 'WEIGHT', baseFactor: null };
const unitM = { id: M, symbol: 'M', unitType: 'LENGTH', baseFactor: null };

const item = (over: Record<string, any> = {}) => ({
  id: ITEM, name: 'Metal Pipe MAX', unitId: KG, unit: unitKg, gstPercent: '18', defaultPurchaseRate: '98', hasRateRange: true,
  minRate: '90', maxRate: '110', avgRate: '100',
  unitConversions: [{ unitId: M, conversionValue: '3.15' }], suppliers: [{ supplierId: SUP, rate: '95' }], ...over,
});

const payload = (over: Record<string, any> = {}, mat: Record<string, any> = {}) => ({
  productName: 'Chair', typeId: TYPE, quantity: '1', costingDate: '2026-01-15', wastagePercent: '0', gstPercent: '18', markupPercent: '10',
  groups: [{ groupId: GROUP, categories: [{ categoryId: CAT, materials: [{ itemId: ITEM, quantity: '20.94', unitId: KG, wastageMode: 'PERCENT', rateBasis: 'STANDARD', ...mat }] }], labour: [{ labourId: LAB, quantity: '1' }] }],
  expenses: [{ expenseId: EXP }],
  ...over,
});

function make(perms: string[] = ['costing:view', 'costing:create', 'costing:edit']) {
  const db: any = {
    item: { findMany: jest.fn().mockResolvedValue([item()]) },
    areaConversion: { findMany: jest.fn().mockResolvedValue([]) },
    unit: { findMany: jest.fn().mockResolvedValue([unitKg, unitM]) },
    labour: { findMany: jest.fn().mockResolvedValue([{ id: LAB, defaultRate: '1200' }]) },
    // the first lookup is the company expenses (none here), the second the expenses the costing names
    expense: { findMany: jest.fn(async (a: any) => (a?.where?.isCompanyExpense ? [] : [{ id: EXP, calculationMethod: 'FIXED', defaultValue: '100', applyTiming: 'BEFORE_GST' }])) },
    supplier: { findMany: jest.fn().mockResolvedValue([{ id: SUP }]) },
  };
  const templates: any = { validateTree: jest.fn(), get: jest.fn() };
  const settings: any = { getRules: jest.fn().mockResolvedValue({ decimals: 2, rounding: 'HALF_UP', roundLines: true, materialRatesIncludeGst: false, labourRatesIncludeGst: false, expenseRatesIncludeGst: false, gstMode: 'COSTING', wastageMode: 'MOST_SPECIFIC', markupBase: 'TOTAL_COST', profitBase: 'BASIC_COST' }) };
  const impact = new RateImpactService();
  const svc = new CostingsService(db, { log: jest.fn() } as any, settings, templates, impact, { mainImages: async () => new Map(), copyLinks: jest.fn() } as any, testSettings().numbering, testSettings().appSettings);
  const actor: any = { id: 'u1', permissions: new Set(perms) };
  const parse = (v: unknown) => require('@costing/validators').costingSchema.parse(v);
  return { svc, db, templates, impact, actor, parse };
}

describe('CostingsService.prepare', () => {
  it('takes rates from the masters, ignoring any client-supplied rate', async () => {
    const { svc, db, actor, parse } = make();
    const p = await svc.prepare(db, parse(payload({}, { rate: '1' })), actor);
    expect(p.materialRows.get('m0.0.0')!.rate).toBe('98');
    expect(p.result.materials['m0.0.0'].total.toString()).toBe('2052.12'); // 20.94 × 98
    expect(p.labourRows.get('l0.0')).toEqual({ rate: '1200', custom: false });
    expect(p.result.expenses.e0.amount.toString()).toBe('100');
  });

  it('applies the chosen rate basis and scales to the row unit (per metre = 3.15 kg)', async () => {
    const { svc, db, actor, parse } = make();
    const min = await svc.prepare(db, parse(payload({}, { rateBasis: 'MIN' })), actor);
    expect(min.materialRows.get('m0.0.0')!.rate).toBe('90');
    const perMetre = await svc.prepare(db, parse(payload({}, { unitId: M, quantity: '2', rateBasis: 'AVERAGE' })), actor);
    expect(perMetre.materialRows.get('m0.0.0')!.rate).toBe('315');
    const sup = await svc.prepare(db, parse(payload({}, { rateBasis: 'SUPPLIER', supplierId: SUP })), actor);
    expect(sup.materialRows.get('m0.0.0')!.rate).toBe('95');
  });

  it('falls back to the standard rate with a warning when min/max/average is unavailable', async () => {
    const { svc, db, actor, parse } = make();
    db.item.findMany.mockResolvedValue([item({ hasRateRange: false })]);
    const p = await svc.prepare(db, parse(payload({}, { rateBasis: 'MAX' })), actor);
    expect(p.materialRows.get('m0.0.0')).toMatchObject({ rate: '98', basis: 'STANDARD' });
    expect(p.warnings[0]).toMatch(/standard rate was used/);
  });

  it('refuses custom rates without costing:manage_rates', async () => {
    const { svc, db, actor, parse } = make();
    await expect(svc.prepare(db, parse(payload({}, { rateBasis: 'CUSTOM', rate: '50' })), actor)).rejects.toBeInstanceOf(ForbiddenException);
    const labour = payload();
    labour.groups[0].labour[0] = { labourId: LAB, quantity: '1', rate: '999' } as never;
    await expect(svc.prepare(db, parse(labour), actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows custom rates for users with the permission and keeps previously stored ones', async () => {
    const withPerm = make(['costing:manage_rates']);
    const ok = await withPerm.svc.prepare(withPerm.db, withPerm.parse(payload({}, { rateBasis: 'CUSTOM', rate: '50' })), withPerm.actor);
    expect(ok.materialRows.get('m0.0.0')!.rate).toBe('50');

    const { svc, db, actor, parse } = make();
    const existing: any = { groups: [{ categories: [{ materials: [{ rateBasis: 'CUSTOM', itemId: ITEM, rate: { toString: () => '50' } }] }], labour: [] }] };
    const kept = await svc.prepare(db, parse(payload({}, { rateBasis: 'CUSTOM', rate: '50' })), actor, existing);
    expect(kept.materialRows.get('m0.0.0')!.rate).toBe('50');
  });

  it('computes the full chain: materials + labour + expense, GST, markup', async () => {
    const { svc, db, actor, parse } = make();
    const r = (await svc.prepare(db, parse(payload()), actor)).result;
    // 2052.12 + 1200 + 100 = 3352.12 basic; GST 18% = 603.38; total 3955.5; markup 10% = 395.55; selling 4351.05
    expect(r.basicCost.toString()).toBe('3352.12');
    expect(r.gstAmount.toString()).toBe('603.38');
    expect(r.totalCostInclGst.toString()).toBe('3955.5');
    expect(r.sellingPrice.toString()).toBe('4351.05');
  });

  it('rejects percentage expenses over 100', async () => {
    const { svc, db, actor, parse } = make();
    await expect(svc.prepare(db, parse(payload({ expenses: [{ expenseId: EXP, calculationMethod: 'PERCENTAGE', value: '150' }] })), actor)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('reference sheet through the server path', () => {
  it('reproduces the hand-checked totals used by the demo seed', async () => {
    const { svc, db, actor, parse } = make();
    const PC = u(13), BMP = u(5), BUSH = u(6), ADDL = u(7), LAB2 = u(21);
    const unitPc = { id: PC, symbol: 'PC', unitType: 'COUNT', baseFactor: null };
    const mk = (id: string, unit: any, rate: string) => ({ id, name: id, unitId: unit.id, unit, gstPercent: '18', defaultPurchaseRate: rate, hasRateRange: false, unitConversions: [], suppliers: [] });
    db.item.findMany.mockResolvedValue([item(), mk(BMP, unitKg, '270'), mk(BUSH, unitPc, '4'), mk(ADDL, unitPc, '3')]);
    db.unit.findMany.mockResolvedValue([unitKg, unitM, unitPc]);
    db.labour.findMany.mockResolvedValue([{ id: LAB, defaultRate: '1200' }, { id: LAB2, defaultRate: '600' }]);
    const body = {
      productName: 'Demo', typeId: TYPE, quantity: '1', costingDate: '2026-01-15', gstPercent: '0', markupPercent: '0', wastagePercent: '0', expenses: [],
      groups: [
        { groupId: GROUP, categories: [
          { categoryId: CAT, materials: [{ itemId: ITEM, quantity: '20.94', unitId: KG }] },
          { categoryId: u(8), materials: [{ itemId: BUSH, quantity: '4', unitId: PC }, { itemId: ADDL, quantity: '14', unitId: PC }] },
        ], labour: [{ labourId: LAB, quantity: '1' }] },
        { groupId: u(9), categories: [{ categoryId: u(14), materials: [{ itemId: BMP, quantity: '0.8', unitId: KG }] }], labour: [{ labourId: LAB2, quantity: '1' }] },
      ],
    };
    const r = (await svc.prepare(db, parse(body), actor)).result;
    expect([r.materialCost, r.labourCost, r.basicCost, r.sellingPrice].map(String)).toEqual(['2326.12', '1800', '4126.12', '4126.12']);
  });
});

describe('engine errors', () => {
  it('surface as 400 rather than 500', async () => {
    const { svc, db, actor, parse } = make();
    const body = parse(payload({ gstPercent: '18' }));
    body.groups[0].categories[0].materials[0].wastagePercent = '5';
    // a percentage expense above 100 reaches the engine only if validation upstream is bypassed
    body.expenses = [{ expenseId: EXP, calculationMethod: 'PERCENTAGE', value: '120' }];
    await expect(svc.prepare(db, body, actor)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('preview', () => {
  it('returns per-row working, the rules used and the summary', async () => {
    const { svc, db, actor } = make();
    db.costing = { findFirst: jest.fn() };
    const r = await svc.preview(actor, payload());
    expect(r.rows.materials['m0.0.0']).toMatchObject({ rate: '98', total: '2052.12', formula: '20.94 × 98 = 2052.12' });
    expect(r.rules.markupBase).toBe('TOTAL_COST');
    expect(r.sellingPrice).toBe('4351.05');
    expect(r.breakdown.map((b: any) => b.key)).toEqual(['material', 'labour', 'expenseBefore', 'basic', 'gst', 'expenseAfter', 'total', 'markup', 'selling']);
  });
});

describe('costing validation (schema)', () => {
  it('requires a custom rate, supplier for supplier basis and quantity for quantity wastage', () => {
    const { parse } = make();
    expect(() => parse(payload({}, { rateBasis: 'CUSTOM' }))).toThrow();
    expect(() => parse(payload({}, { rateBasis: 'SUPPLIER' }))).toThrow();
    expect(() => parse(payload({}, { wastageMode: 'QUANTITY' }))).toThrow();
  });
});

describe('status workflow', () => {
  function withStatus(status: string, perms?: string[]) {
    const ctx = make(perms);
    const tx: any = { costing: { update: jest.fn(), findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'APPROVED', costingDate: new Date('2026-01-15'), groups: [], expenses: [] }) }, costingRevision: { create: jest.fn() } };
    Object.assign(ctx.db, {
      costing: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', status, version: 2, costingNumber: 'COST-2026-0001' }), update: jest.fn(), count: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    });
    return { ...ctx, tx };
  }

  it('submits a draft for approval', async () => {
    const { svc, actor, tx } = withStatus('DRAFT');
    expect(await svc.setStatus(actor, 'c1', 'submit', {})).toEqual({ id: 'c1', status: 'PENDING_APPROVAL' });
    expect(tx.costing.update).toHaveBeenCalled();
  });

  it('approval freezes the costing (snapshot pricing) and records the approver', async () => {
    const { svc, actor, tx } = withStatus('PENDING_APPROVAL');
    await svc.setStatus(actor, 'c1', 'approve', {});
    expect(tx.costing.update.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED', pricingMode: 'SNAPSHOT', approvedById: 'u1', version: 3 });
    expect(tx.costingRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ costingId: 'c1', version: 3, note: 'Approved: rates frozen' }) });
  });

  it('rejects invalid transitions and requires reasons for reject / reopen', async () => {
    const draft = withStatus('DRAFT');
    await expect(draft.svc.setStatus(draft.actor, 'c1', 'approve', {})).rejects.toBeInstanceOf(BadRequestException);
    const pending = withStatus('PENDING_APPROVAL');
    await expect(pending.svc.setStatus(pending.actor, 'c1', 'reject', {})).rejects.toThrow(/reason/);
    const approved = withStatus('APPROVED');
    await expect(approved.svc.setStatus(approved.actor, 'c1', 'reopen', {})).rejects.toThrow(/reason/);
  });

  it('locks approved costings against edits, refresh and deletion', async () => {
    const { svc, actor, db } = withStatus('APPROVED');
    db.costing.findFirst.mockResolvedValue({ id: 'c1', status: 'APPROVED', pricingMode: 'SNAPSHOT', version: 2, groups: [], expenses: [] });
    await expect(svc.update(actor, 'c1', payload())).rejects.toThrow(/locked/);
    await expect(svc.refreshRates(actor, 'c1')).rejects.toThrow(/snapshot/);
    await expect(svc.remove(actor, 'c1')).rejects.toThrow(/draft or rejected/);
  });

  it('reopening returns the costing to live pricing for editing', async () => {
    const { svc, actor, tx } = withStatus('APPROVED');
    await svc.setStatus(actor, 'c1', 'reopen', { reason: 'Supplier price revision' });
    expect(tx.costing.update.mock.calls[0][0].data).toMatchObject({ status: 'DRAFT', pricingMode: 'LIVE', approvedById: null });
  });
});

describe('rate impact provider', () => {
  it('registers a provider that counts live, non-approved costings using the item', async () => {
    const { svc, db, impact } = make();
    db.costing = { count: jest.fn().mockResolvedValue(18) };
    svc.onModuleInit();
    expect(await impact.measure(ITEM)).toEqual({ affected: [{ label: 'live costing record(s)', count: 18 }], total: 18 });
    const where = db.costing.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ pricingMode: 'LIVE', status: { not: 'APPROVED' }, deletedAt: null });
  });
});
