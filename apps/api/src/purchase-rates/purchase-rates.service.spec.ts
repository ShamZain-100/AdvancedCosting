import { BadRequestException } from '@nestjs/common';
import { PurchaseRatesService } from './purchase-rates.service';
import { RateImpactService } from './rate-impact.service';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const KG = { id: uuid(10), symbol: 'KG', unitType: 'WEIGHT', baseFactor: '1' };
const M = { id: uuid(11), symbol: 'M', unitType: 'LENGTH', baseFactor: '1' };
const PC = { id: uuid(12), symbol: 'PC', unitType: 'COUNT', baseFactor: null };

function item(over: Record<string, any> = {}) {
  return {
    id: uuid(1), name: 'Metal Pipe MAX', code: 'MPM', unitId: KG.id, unit: KG, hasRateRange: false, rateMethod: 'LAST_PURCHASE',
    defaultPurchaseRate: '98', unitConversions: [{ unitId: M.id, unit: M, conversionValue: '3.15' }], ...over,
  };
}

function make(entries: any[] = [], itemOver: Record<string, any> = {}) {
  const history: any[] = [];
  const itemUpdates: any[] = [];
  const tx: any = {
    item: { findUniqueOrThrow: jest.fn().mockResolvedValue(item(itemOver)), update: jest.fn(async (a: any) => itemUpdates.push(a.data)) },
    purchaseRate: { findMany: jest.fn().mockResolvedValue(entries), create: jest.fn().mockResolvedValue({ id: 'pr1' }), findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    purchaseRateHistory: { create: jest.fn(async (a: any) => history.push(a.data)), findMany: jest.fn().mockResolvedValue([]) },
    itemSupplier: { upsert: jest.fn() },
  };
  const prisma: any = {
    ...tx,
    item: { ...tx.item, findFirst: jest.fn().mockResolvedValue(item(itemOver)) },
    areaConversion: { findMany: jest.fn().mockResolvedValue([]) },
    unit: { findFirst: jest.fn(async ({ where }: any) => [KG, M, PC].find((u) => u.id === where.id) ?? null) },
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: uuid(2) }) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const impact = new RateImpactService();
  const audit: any = { log: jest.fn() };
  return { svc: new PurchaseRatesService(prisma, audit, impact), prisma, tx, history, itemUpdates, impact, audit };
}

const entry = (baseRate: string, baseQuantity: string, purchaseDate: string) => ({ baseRate, baseQuantity, purchaseDate: new Date(purchaseDate) });

describe('PurchaseRatesService.normalise', () => {
  it('converts through a rule from the Area / Conversion master, and asks only for fixed, active rules', async () => {
    const { svc, prisma } = make();
    prisma.areaConversion.findMany.mockResolvedValue([{ fromUnitId: PC.id, toUnitId: KG.id, conversionValue: '2.5', itemId: null }]);
    const { row } = await svc.normalise(prisma, { itemId: uuid(1), unitId: PC.id, quantity: '4', rate: '250', purchaseDate: '2026-01-01' });
    expect(row.baseRate).toBe('100'); // 250 per piece / 2.5 kg per piece
    expect(row.baseQuantity).toBe('10');
    expect(prisma.areaConversion.findMany.mock.calls[0][0].where).toMatchObject({ isActive: true, deletedAt: null, formulaType: 'FIXED_FACTOR' });
  });

  it('converts a per-metre rate to the base unit (1 m = 3.15 kg)', async () => {
    const { svc, prisma } = make();
    const { row } = await svc.normalise(prisma, { itemId: uuid(1), unitId: M.id, quantity: '2', rate: '315', purchaseDate: '2026-01-01' });
    expect(row.baseRate).toBe('100'); // 315 per metre / 3.15 kg per metre
    expect(row.baseQuantity).toBe('6.3');
  });

  it('keeps base-unit entries unchanged', async () => {
    const { svc, prisma } = make();
    const { row } = await svc.normalise(prisma, { itemId: uuid(1), unitId: KG.id, rate: '98', purchaseDate: '2026-01-01' });
    expect([row.baseRate, row.baseQuantity]).toEqual(['98', '1']);
  });

  it('rejects units with no conversion to the base unit', async () => {
    const { svc, prisma } = make();
    await expect(svc.normalise(prisma, { itemId: uuid(1), unitId: PC.id, rate: '5', purchaseDate: '2026-01-01' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PurchaseRatesService.recalcItem', () => {
  it('moves a standard item to the latest purchase rate and logs history', async () => {
    const { svc, tx, history } = make([entry('90', '1', '2026-01-01'), entry('105', '1', '2026-02-01')]);
    const r = await svc.recalcItem(tx, uuid(1), 'PURCHASE', 'u1');
    expect(r.moved).toBe(true);
    expect(history[0]).toMatchObject({ oldRate: '98', newRate: '105', source: 'PURCHASE', changedBy: 'u1' });
    expect(tx.item.update).toHaveBeenCalledWith(expect.objectContaining({ data: { defaultPurchaseRate: '105' } }));
  });

  it('does not log history when the rate is unchanged', async () => {
    const { svc, tx, history } = make([entry('98', '1', '2026-01-01')]);
    expect((await svc.recalcItem(tx, uuid(1), 'PURCHASE', 'u1')).moved).toBe(false);
    expect(history).toHaveLength(0);
  });

  it('maintains min/max/avg only for range-capable items', async () => {
    const capable = make([entry('100', '10', '2026-01-01'), entry('120', '30', '2026-02-01')], { hasRateRange: true, rateMethod: 'WEIGHTED_AVERAGE' });
    await capable.svc.recalcItem(capable.tx, uuid(1), 'PURCHASE', 'u1');
    expect(capable.itemUpdates[0]).toMatchObject({ minRate: '100', maxRate: '120', avgRate: '115', defaultPurchaseRate: '115' });

    const plain = make([entry('100', '10', '2026-01-01'), entry('120', '30', '2026-02-01')]);
    await plain.svc.recalcItem(plain.tx, uuid(1), 'PURCHASE', 'u1');
    expect(plain.itemUpdates[0]).toEqual({ defaultPurchaseRate: '120' });
  });

  it('never moves the rate of a MANUAL-method item but still refreshes statistics', async () => {
    const { svc, tx, itemUpdates, history } = make([entry('200', '1', '2026-01-01')], { hasRateRange: true, rateMethod: 'MANUAL' });
    expect((await svc.recalcItem(tx, uuid(1), 'PURCHASE', 'u1')).moved).toBe(false);
    expect(itemUpdates[0].defaultPurchaseRate).toBeUndefined();
    expect(itemUpdates[0].maxRate).toBe('200');
    expect(history).toHaveLength(0);
  });

  it('records the measured impact on the history row', async () => {
    const { svc, tx, history, impact } = make([entry('120', '1', '2026-01-01')]);
    impact.register({ label: 'live costing record(s)', countAffected: async () => 18 });
    await svc.recalcItem(tx, uuid(1), 'PURCHASE', 'u1');
    expect(history[0].impact).toEqual({ affected: [{ label: 'live costing record(s)', count: 18 }], total: 18 });
  });
});

describe('PurchaseRatesService manual rate + impact preview', () => {
  it('requires a reason and a changed rate', async () => {
    const { svc } = make();
    const actor: any = { id: 'u1' };
    await expect(svc.setManualRate(actor, uuid(1), { newRate: '105', reason: '' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setManualRate(actor, uuid(1), { newRate: '98', reason: 'same' })).rejects.toThrow(/unchanged/);
  });

  it('writes a MANUAL history row and warns when later purchases may override it', async () => {
    const { svc, history, audit } = make();
    const r = await svc.setManualRate({ id: 'u1' } as any, uuid(1), { newRate: '105', reason: 'Supplier quote' });
    expect(history[0]).toMatchObject({ oldRate: '98', newRate: '105', source: 'MANUAL', reason: 'Supplier quote' });
    expect(r.warning).toMatch(/next recorded purchase/);
    expect(audit.log).toHaveBeenCalled();
  });

  it('previews the blast radius with the spec wording', async () => {
    const { svc, impact } = make();
    impact.register({ label: 'live costing record(s)', countAffected: async () => 18 });
    const p = await svc.previewImpact(uuid(1), '105');
    expect(p.message).toBe('Changing Metal Pipe MAX rate from 98 to 105 will affect 18 live record(s).');
    expect(p.changePercent).toBe('7.14');
  });
});

describe('PurchaseRatesService: deleting the last purchase', () => {
  const change = (oldRate: string, source: string) => ({ oldRate, source });
  const run = async (changes: any[], over: Record<string, any> = {}) => {
    const m = make([], { defaultPurchaseRate: '140', ...over });
    m.tx.purchaseRateHistory.findMany.mockResolvedValue(changes);
    return { ...m, r: await m.svc.recalcItem(m.tx, uuid(1), 'PURCHASE_DELETED', 'u1') };
  };

  it('goes back to the rate from before the purchases', async () => {
    const { r, history } = await run([change('120', 'PURCHASE'), change('100', 'PURCHASE')]);
    expect(r).toMatchObject({ moved: true, oldRate: '140', newRate: '100' });
    expect(history[0]).toMatchObject({ oldRate: '140', newRate: '100', source: 'PURCHASE_DELETED' });
  });

  it('goes back to a manual rate set before the purchases', async () => {
    const { r } = await run([change('120', 'PURCHASE'), change('130', 'PURCHASE'), change('100', 'MANUAL')]);
    expect(r.newRate).toBe('130');
  });

  it('keeps a manual rate set after the purchases', async () => {
    const { r } = await run([change('120', 'MANUAL'), change('100', 'PURCHASE')]);
    expect(r.moved).toBe(false);
  });

  it('keeps the rate when no history exists', async () => {
    const { r } = await run([]);
    expect(r.moved).toBe(false);
  });
});
