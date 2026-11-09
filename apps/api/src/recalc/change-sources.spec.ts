import { MASTERS } from '../masters/masters.config';
import { MasterService } from '../masters/master.service';
import { PurchaseRatesService } from '../purchase-rates/purchase-rates.service';
import { RateImpactService } from '../purchase-rates/rate-impact.service';
import { CostingSettingsService } from '../costings/costing-settings.service';
import { ChangeBus, MasterChange } from './change-bus';

const D = (v: string | number) => ({ toString: () => String(v) });
const cfg = (path: string) => MASTERS.find((m) => m.path === path)!;
const item = (over: Record<string, any> = {}) => ({
  id: 'i1', name: 'Pipe', unitId: 'kg', defaultPurchaseRate: D('98'), gstPercent: D('18'), hasRateRange: false, minRate: null, maxRate: null, avgRate: null,
  unitConversions: [{ unitId: 'm', conversionValue: D('3.15') }], suppliers: [{ supplierId: 's1', rate: D('95'), isDefault: true }], ...over,
});

describe('which master edits are announced', () => {
  const watch = cfg('items').watch!;

  it('nothing changes, nothing is announced (decimal formatting does not count as a change)', () => {
    expect(watch(item(), item({ defaultPurchaseRate: D('98.0000'), gstPercent: D('18.00'), unitConversions: [{ unitId: 'm', conversionValue: D('3.150') }] }))).toEqual([]);
  });

  it('a new rate is announced with old and new value and written to the rate history', () => {
    expect(watch(item(), item({ defaultPurchaseRate: D('105') }))).toEqual([expect.objectContaining({ kind: 'ITEM_RATE', sourceId: 'i1', before: '98', after: '105', logHistory: true })]);
  });

  it('min / max / average and supplier rate edits are announced without a rate history row', () => {
    const range = watch(item({ hasRateRange: true, minRate: D('90') }), item({ hasRateRange: true, minRate: D('92') }));
    expect(range).toEqual([expect.objectContaining({ kind: 'ITEM_RATE', logHistory: false, before: null })]);
    const supplier = watch(item(), item({ suppliers: [{ supplierId: 's1', rate: D('99'), isDefault: true }] }));
    expect(supplier).toEqual([expect.objectContaining({ kind: 'ITEM_RATE', logHistory: false })]);
  });

  it('GST % and unit conversions are separate announcements', () => {
    expect(watch(item(), item({ gstPercent: D('12') }))).toEqual([expect.objectContaining({ kind: 'ITEM_GST', before: '18', after: '12' })]);
    expect(watch(item(), item({ unitConversions: [{ unitId: 'm', conversionValue: D('3.2') }] }))).toEqual([expect.objectContaining({ kind: 'ITEM_UNITS' })]);
    expect(watch(item(), item({ unitId: 'g' }))).toEqual([expect.objectContaining({ kind: 'ITEM_UNITS' })]);
    expect(watch(item(), item({ defaultPurchaseRate: D('105'), gstPercent: D('12') })).map((c) => c.kind)).toEqual(['ITEM_RATE', 'ITEM_GST']);
  });

  it('labour rate and expense default edits', () => {
    expect(cfg('labour').watch!({ id: 'l1', name: 'Metal', defaultRate: D('1200') }, { id: 'l1', name: 'Metal', defaultRate: D('1300') })).toEqual([expect.objectContaining({ kind: 'LABOUR_RATE', before: '1200', after: '1300' })]);
    expect(cfg('labour').watch!({ id: 'l1', name: 'Metal', defaultRate: D('1200') }, { id: 'l1', name: 'Renamed', defaultRate: D('1200.00') })).toEqual([]);
    const e = (over: Record<string, any>) => ({ id: 'e1', name: 'Packing', defaultValue: D('100'), calculationMethod: 'FIXED', applyTiming: 'BEFORE_GST', ...over });
    expect(cfg('expenses').watch!(e({}), e({ defaultValue: D('120') }))).toEqual([expect.objectContaining({ kind: 'EXPENSE_DEFAULT' })]);
    expect(cfg('expenses').watch!(e({}), e({ applyTiming: 'AFTER_GST' }))).toEqual([expect.objectContaining({ kind: 'EXPENSE_DEFAULT' })]);
    expect(cfg('expenses').watch!(e({}), e({ name: 'Renamed' }))).toEqual([]);
  });
});

describe('MasterService emits after the edit is saved', () => {
  function make() {
    const before = { id: 'l1', name: 'Metal', code: 'LAB', defaultRate: D('1200'), deletedAt: null };
    const after = { ...before, defaultRate: D('1300') };
    let reads = 0;
    const prisma: any = {
      labour: { findFirst: jest.fn(async () => (reads++ === 0 ? before : after)), update: jest.fn() },
      areaConversion: { findMany: jest.fn().mockResolvedValue([]) },
      unit: { findFirst: jest.fn() }, type: { findFirst: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn({ labour: { update: prisma.labour.update } })),
    };
    const bus = new ChangeBus();
    const events: MasterChange[] = [];
    bus.subscribe(async (c) => { events.push(c); });
    return { svc: new MasterService(prisma, { log: jest.fn() } as any, bus), events, prisma };
  }

  it('announces a labour rate edit with the editor as actor, after the commit', async () => {
    const { svc, events, prisma } = make();
    await svc.update(cfg('labour'), { id: 'u1' } as any, 'l1', { name: 'Metal', code: 'LAB', defaultRate: '1300' });
    expect(prisma.labour.update).toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({ kind: 'LABOUR_RATE', sourceId: 'l1', before: '1200', after: '1300', actorId: 'u1' })]);
  });

  it('works without a bus (other modules construct the service without one)', async () => {
    const { prisma } = make();
    const svc = new MasterService(prisma, { log: jest.fn() } as any);
    await expect(svc.update(cfg('labour'), { id: 'u1' } as any, 'l1', { name: 'Metal', code: 'LAB', defaultRate: '1300' })).resolves.toBeDefined();
  });
});

describe('purchase rates announce what actually changed', () => {
  const ITEM = '00000000-0000-4000-8000-000000000001', KG = '00000000-0000-4000-8000-00000000000a', SUP = '00000000-0000-4000-8000-000000000020';
  function make(opts: { current: string; supplierRate?: string }) {
    const events: MasterChange[] = [];
    const bus = new ChangeBus(); bus.subscribe(async (c) => { events.push(c); });
    const itemRow = { id: ITEM, name: 'Pipe', unitId: KG, unit: { id: KG, symbol: 'KG', unitType: 'WEIGHT', baseFactor: null }, unitConversions: [], defaultPurchaseRate: D(opts.current), hasRateRange: false, rateMethod: 'LAST_PURCHASE', minRate: null, maxRate: null, avgRate: null };
    const tx: any = {
      purchaseRate: { create: jest.fn().mockResolvedValue({ id: 'pr1' }), findMany: jest.fn().mockResolvedValue([{ baseRate: D('105'), baseQuantity: D('1'), purchaseDate: new Date('2026-02-01') }]), findFirst: jest.fn().mockResolvedValue({ baseRate: D('105') }) },
      item: { findUniqueOrThrow: jest.fn().mockResolvedValue(itemRow), update: jest.fn() },
      itemSupplier: { findUnique: jest.fn().mockResolvedValue(opts.supplierRate ? { rate: D(opts.supplierRate) } : null), upsert: jest.fn() },
      purchaseRateHistory: { create: jest.fn() },
    };
    const prisma: any = {
      areaConversion: { findMany: jest.fn().mockResolvedValue([]) },
      item: { findFirst: jest.fn().mockResolvedValue(itemRow) }, unit: { findFirst: jest.fn() }, supplier: { findFirst: jest.fn().mockResolvedValue({ id: SUP }) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    return { svc: new PurchaseRatesService(prisma, { log: jest.fn() } as any, new RateImpactService(), bus), events };
  }
  const actor: any = { id: 'u1' };
  const body = (supplier = false) => ({ itemId: ITEM, unitId: KG, rate: '105', purchaseDate: '2026-02-01', ...(supplier ? { supplierId: SUP } : {}) });

  it('a purchase that moves the item rate emits an ITEM_RATE change after the transaction', async () => {
    const { svc, events } = make({ current: '98' });
    await svc.create(actor, body());
    expect(events).toEqual([expect.objectContaining({ kind: 'ITEM_RATE', sourceId: ITEM, sourceName: 'Pipe', before: '98', after: '105', actorId: 'u1', note: 'Purchase rate changed' })]);
  });

  it('a purchase at the current rate announces nothing', async () => {
    const { svc, events } = make({ current: '105' });
    await svc.create(actor, body());
    expect(events).toEqual([]);
  });

  it('a changed supplier rate is announced even when the item rate did not move', async () => {
    const { svc, events } = make({ current: '105', supplierRate: '95' });
    await svc.create(actor, body(true));
    expect(events).toEqual([expect.objectContaining({ kind: 'ITEM_RATE', before: null, after: null, note: 'Supplier rate changed' })]);
  });

  it('a manual rate change is announced with the reason', async () => {
    const { svc, events } = make({ current: '98' });
    await svc.setManualRate(actor, ITEM, { newRate: '110', reason: 'Supplier quote' });
    expect(events).toEqual([expect.objectContaining({ kind: 'ITEM_RATE', before: '98', after: '110', note: 'Manual rate change: Supplier quote' })]);
  });
});

describe('calculation rules', () => {
  const rules = { decimals: 2, rounding: 'HALF_UP', roundLines: true, materialRatesIncludeGst: false, labourRatesIncludeGst: false, expenseRatesIncludeGst: false, gstMode: 'COSTING', wastageMode: 'MOST_SPECIFIC', markupBase: 'TOTAL_COST', profitBase: 'BASIC_COST' };
  function make() {
    const events: MasterChange[] = [];
    const bus = new ChangeBus(); bus.subscribe(async (c) => { events.push(c); });
    const prisma: any = { costingSettings: { findUnique: jest.fn().mockResolvedValue({ rules }), upsert: jest.fn() } };
    return { svc: new CostingSettingsService(prisma, { log: jest.fn() } as any, bus), events };
  }

  it('changing a rule announces it; saving the same rules does not', async () => {
    const { svc, events } = make();
    await svc.setRules({ id: 'u1' } as any, { decimals: 1 });
    expect(events).toEqual([expect.objectContaining({ kind: 'RULES', sourceId: null, actorId: 'u1' })]);
    events.length = 0;
    await svc.setRules({ id: 'u1' } as any, { decimals: 2 });
    expect(events).toEqual([]);
  });
});

describe('ChangeBus', () => {
  it('delivers to every subscriber and survives a failing one', async () => {
    const bus = new ChangeBus();
    const seen: string[] = [];
    bus.subscribe(async () => { throw new Error('boom'); });
    bus.subscribe(async (c) => { seen.push(c.sourceName); });
    await bus.emit({ kind: 'ITEM_RATE', sourceId: 'x', sourceName: 'A' }, { kind: 'ITEM_GST', sourceId: 'x', sourceName: 'B' });
    expect(seen).toEqual(['A', 'B']);
  });
});
