import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChangeBus, MasterChange } from './change-bus';
import { AUTO_APPLY_LIMIT, RecalcService } from './recalc.service';

const ITEM = '00000000-0000-4000-8000-000000000001';
const change = (over: Partial<MasterChange> = {}): MasterChange => ({ kind: 'ITEM_RATE', sourceId: ITEM, sourceName: 'Metal Pipe MAX', before: '98', after: '105', note: 'Purchase rate changed', actorId: 'u1', ...over });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

function make(opts: { mode?: 'AUTO' | 'CONFIRM' | 'MANUAL'; threshold?: number; affected?: string[]; existingBatch?: any; quotations?: string[]; lists?: string[] } = {}) {
  const recalc = jest.fn(async (_a: any, id: string, o: any) => ({ id, number: `N-${id}`, product: 'P', status: 'DRAFT', outcome: 'CHANGED' as const, reason: null, before: { basic: '100', selling: '120', total: '118', gst: '18' }, after: { basic: '110', selling: '132', total: '129.8', gst: '19.8' }, warnings: [], o }));
  const prisma: any = {
    costingSettings: { findUnique: jest.fn().mockResolvedValue({ recalcMode: opts.mode ?? 'CONFIRM', flagThresholdPercent: String(opts.threshold ?? 0) }), upsert: jest.fn() },
    costing: { findMany: jest.fn(async ({ where }: any) => (where.pricingMode ? (opts.affected ?? ids(3)).map((id) => ({ id })) : [{ id: 'frozen1' }, { id: 'frozen2' }])) },
    quotation: { findMany: jest.fn().mockResolvedValue((opts.quotations ?? ['q1', 'q2']).map((id) => ({ id }))) },
    priceList: { findMany: jest.fn().mockResolvedValue((opts.lists ?? ['p1']).map((id) => ({ id }))) },
    reviewFlag: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 0 }), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn() },
    recalculationBatch: {
      findFirst: jest.fn().mockResolvedValue(opts.existingBatch ?? null), findUnique: jest.fn(), create: jest.fn(async ({ data }: any) => ({ id: 'b1', status: 'PENDING', ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, status: 'PENDING', ...data })), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn(), count: jest.fn(),
    },
    recalculationItem: { createMany: jest.fn() },
    purchaseRateHistory: { create: jest.fn() },
  };
  const costings: any = { recalculate: recalc };
  const bus = new ChangeBus();
  const audit: any = { log: jest.fn() };
  const svc = new RecalcService(prisma, audit, bus, costings, { getRules: jest.fn().mockResolvedValue({}) } as any, { measure: jest.fn().mockResolvedValue({ affected: [], total: 4 }) } as any);
  svc.onModuleInit();
  const manager: any = { id: 'u1', permissions: new Set(['purchase_rates:manage_rates', 'costing:edit', 'purchase_rates:view', 'costing:view', 'quotations:view', 'quotations:edit', 'price_lists:view', 'price_lists:edit']) };
  return { svc, prisma, recalc, bus, audit, manager };
}

describe('reacting to a change', () => {
  it('queues a batch of the live costings that use the changed item (CONFIRM policy)', async () => {
    const { svc, prisma, recalc } = make();
    await svc.onChange(change());
    expect(prisma.recalculationBatch.create).toHaveBeenCalledTimes(1);
    expect(prisma.recalculationBatch.create.mock.calls[0][0].data).toMatchObject({ kind: 'ITEM_RATE', sourceId: ITEM, sourceName: 'Metal Pipe MAX', summary: 'Metal Pipe MAX: rate 98 → 105', costingCount: 3, flaggedCount: 3, changePercent: 7.14, createdBy: 'u1' });
    expect(recalc).not.toHaveBeenCalled(); // waits for an admin
  });

  it('only considers live, non-approved costings', async () => {
    const { svc, prisma } = make();
    await svc.affectedCostings({ kind: 'ITEM_RATE', sourceId: ITEM });
    expect(prisma.costing.findMany.mock.calls[0][0].where).toMatchObject({ deletedAt: null, pricingMode: 'LIVE', status: { in: ['DRAFT', 'REJECTED', 'PENDING_APPROVAL'] } });
    await svc.affectedCostings({ kind: 'LABOUR_RATE', sourceId: 'lab' });
    expect(prisma.costing.findMany.mock.calls[1][0].where.groups.some.labour.some).toEqual({ labourId: 'lab', customRate: false }); // custom labour rates are not affected
  });

  it('updates the existing pending batch for the same source instead of creating another', async () => {
    const { svc, prisma } = make({ existingBatch: { id: 'old', status: 'PENDING' } });
    await svc.onChange(change({ after: '110' }));
    expect(prisma.recalculationBatch.create).not.toHaveBeenCalled();
    expect(prisma.recalculationBatch.update).toHaveBeenCalledWith({ where: { id: 'old' }, data: expect.objectContaining({ summary: 'Metal Pipe MAX: rate 98 → 110' }) });
  });

  it('does nothing for costings when no live costing is affected, and still flags frozen documents', async () => {
    const { svc, prisma } = make({ affected: [] });
    await svc.onChange(change());
    expect(prisma.recalculationBatch.create).not.toHaveBeenCalled();
    expect(prisma.reviewFlag.createMany).toHaveBeenCalled();
  });

  it('MANUAL policy never queues or recalculates, but still raises review flags', async () => {
    const { svc, prisma, recalc } = make({ mode: 'MANUAL' });
    await svc.onChange(change());
    expect(prisma.recalculationBatch.create).not.toHaveBeenCalled();
    expect(recalc).not.toHaveBeenCalled();
    expect(prisma.reviewFlag.createMany).toHaveBeenCalled();
  });

  it('AUTO policy applies the batch straight away with the system actor', async () => {
    const { svc, prisma, recalc } = make({ mode: 'AUTO', affected: ids(2) });
    prisma.recalculationBatch.findUnique.mockResolvedValue({ id: 'b1', kind: 'ITEM_RATE', sourceId: ITEM, summary: 'x', status: 'PENDING' });
    await svc.onChange(change());
    expect(recalc).toHaveBeenCalledTimes(2);
    const actor = recalc.mock.calls[0][0];
    expect(actor.permissions.size).toBe(0); // no permissions: can never introduce custom rates
    expect(prisma.recalculationBatch.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPLIED', appliedCount: { increment: 2 } }) }));
  });

  it('AUTO policy leaves very large batches for confirmation', async () => {
    const { svc, recalc } = make({ mode: 'AUTO', affected: ids(AUTO_APPLY_LIMIT + 1) });
    await svc.onChange(change());
    expect(recalc).not.toHaveBeenCalled();
  });

  it('records a rate history row when an item master edit changed the rate', async () => {
    const { svc, prisma } = make();
    await svc.onChange(change({ logHistory: true, note: 'Rate edited in the item master' }));
    expect(prisma.purchaseRateHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ itemId: ITEM, oldRate: '98', newRate: '105', source: 'MANUAL', changedBy: 'u1', impact: { affected: [], total: 4 } }) });
    const quiet = make();
    await quiet.svc.onChange(change());
    expect(quiet.prisma.purchaseRateHistory.create).not.toHaveBeenCalled();
  });

  it('receives events through the bus, and a failing handler never breaks the emitter', async () => {
    const { bus, prisma } = make();
    await bus.emit(change());
    expect(prisma.recalculationBatch.create).toHaveBeenCalled();
    prisma.costingSettings.findUnique.mockRejectedValue(new Error('db down'));
    await expect(bus.emit(change())).resolves.toBeUndefined();
  });

  it('a calculation-rules change affects every live costing and flags nothing', async () => {
    const { svc, prisma } = make();
    await svc.onChange({ kind: 'RULES', sourceId: null, sourceName: 'Calculation rules', note: 'Calculation rules changed' });
    expect(prisma.recalculationBatch.create.mock.calls[0][0].data).toMatchObject({ kind: 'RULES', summary: 'Calculation rules: Calculation rules changed', flaggedCount: 0 });
    expect(prisma.reviewFlag.createMany).not.toHaveBeenCalled();
  });
});

describe('review flags for frozen documents', () => {
  it('flags open quotations and price lists built on costings that use the item, without changing them', async () => {
    const { svc, prisma } = make();
    await svc.onChange(change());
    const q = await prisma.quotation.findMany.mock.calls[0][0];
    expect(q.where.status).toEqual({ in: ['DRAFT', 'PENDING', 'SENT', 'APPROVED'] }); // converted / rejected / expired are history
    expect(q.where.items.some.costingId.in).toEqual(['frozen1', 'frozen2']);
    expect(prisma.priceList.findMany.mock.calls[0][0].where.status).toEqual({ in: ['DRAFT', 'ACTIVE'] });
    const created = prisma.reviewFlag.createMany.mock.calls.flatMap((c: any) => c[0].data);
    expect(created.map((f: any) => f.quotationId ?? f.priceListId)).toEqual(['q1', 'q2', 'p1']);
    expect(created[0]).toMatchObject({ sourceKey: `ITEM_RATE:${ITEM}`, reason: expect.stringContaining('Metal Pipe MAX: rate 98 → 105') });
    expect(prisma.reviewFlag.createMany.mock.calls[0][0].skipDuplicates).toBe(true); // one open flag per document and source
    expect(prisma.quotation.findMany.mock.calls.length).toBe(1);
  });

  it('respects the percentage threshold for rate changes', async () => {
    const { svc, prisma } = make({ threshold: 10 });
    await svc.onChange(change()); // +7.14 % < 10 %
    expect(prisma.reviewFlag.createMany).not.toHaveBeenCalled();
    await svc.onChange(change({ after: '120' })); // +22 %
    expect(prisma.reviewFlag.createMany).toHaveBeenCalled();
  });

  it('lists open flags only for documents the user may see', async () => {
    const { svc, prisma, manager } = make();
    prisma.reviewFlag.findMany.mockResolvedValue([
      { id: 'f1', reason: 'r', createdAt: new Date(), batchId: 'b1', quotation: { id: 'q1', number: 'QTN-1', customerName: 'Acme', status: 'SENT' }, priceList: null },
      { id: 'f2', reason: 'r', createdAt: new Date(), batchId: null, quotation: null, priceList: { id: 'p1', number: 'PL-1', name: 'Retail', status: 'ACTIVE' } },
    ]);
    const out = await svc.openFlags(manager);
    expect(out.map((f) => [f.document.type, f.document.title])).toEqual([['QUOTATION', 'Acme'], ['PRICE_LIST', 'Retail']]);
    await svc.openFlags({ permissions: new Set(['quotations:view']) } as any);
    expect(prisma.reviewFlag.findMany.mock.calls[1][0].where.OR).toEqual([{ quotationId: { not: null } }]);
  });

  it('resolving a flag needs edit access to that kind of document', async () => {
    const { svc, prisma, manager } = make();
    prisma.reviewFlag.findUnique.mockResolvedValue({ id: 'f1', quotationId: 'q1', priceListId: null, resolvedAt: null });
    await expect(svc.resolveFlag({ id: 'u2', permissions: new Set(['quotations:view']) } as any, 'f1')).rejects.toBeInstanceOf(ForbiddenException);
    await svc.resolveFlag(manager, 'f1');
    expect(prisma.reviewFlag.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { resolvedAt: expect.any(Date), resolvedBy: 'u1' } });
    prisma.reviewFlag.findUnique.mockResolvedValue({ id: 'f1', resolvedAt: new Date() });
    await expect(svc.resolveFlag(manager, 'f1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('preview and apply', () => {
  const batch = { id: 'b1', kind: 'ITEM_RATE', sourceId: ITEM, summary: 'Metal Pipe MAX: rate 98 → 105', status: 'PENDING' };

  it('previews before / after per costing without writing anything', async () => {
    const { svc, prisma, recalc, manager } = make({ affected: ids(2) });
    prisma.recalculationBatch.findUnique.mockResolvedValue(batch);
    const r = await svc.preview(manager, 'b1');
    expect(recalc.mock.calls.every((c) => c[2].dryRun === true)).toBe(true);
    expect(r.totals).toMatchObject({ changed: 2, unchanged: 0, skipped: 0, sellingPriceChange: '24.00' }); // (132 − 120) × 2
    expect(r.rows[0]).toMatchObject({ number: 'N-c0' });
    expect(prisma.recalculationItem.createMany).not.toHaveBeenCalled();
  });

  it('only users who can manage rates and edit costings may apply', async () => {
    const { svc } = make();
    await expect(svc.apply({ id: 'u2', permissions: new Set(['purchase_rates:manage_rates']) } as any, 'b1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.apply({ id: 'u2', permissions: new Set(['costing:edit']) } as any, 'b1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('applies every affected costing, records the result per costing and completes the batch', async () => {
    const { svc, prisma, recalc, manager, audit } = make({ affected: ids(3) });
    prisma.recalculationBatch.findUnique.mockResolvedValue(batch);
    const r = await svc.apply(manager, 'b1');
    expect(recalc).toHaveBeenCalledTimes(3);
    expect(recalc.mock.calls[0][2].note).toContain('Metal Pipe MAX: rate 98 → 105');
    expect(r).toMatchObject({ applied: 3, unchanged: 0, skipped: 0, failed: 0 });
    expect(prisma.recalculationItem.createMany.mock.calls[0][0].data.map((i: any) => [i.costingId, i.status, i.sellingBefore, i.sellingAfter])).toEqual([['c0', 'APPLIED', '120', '132'], ['c1', 'APPLIED', '120', '132'], ['c2', 'APPLIED', '120', '132']]);
    expect(prisma.recalculationBatch.update.mock.calls[0][0].data).toMatchObject({ status: 'APPLIED', appliedBy: 'u1', appliedCount: { increment: 3 } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'apply_recalculation', entityId: 'b1' }));
  });

  it('isolates failures and leaves skipped costings in a PARTIAL batch for a later run', async () => {
    const { svc, prisma, recalc, manager } = make({ affected: ids(3) });
    prisma.recalculationBatch.findUnique.mockResolvedValue(batch);
    recalc.mockImplementationOnce(async () => { throw new Error('Item no longer exists'); });
    recalc.mockImplementationOnce(async (_a: any, id: string) => ({ id, number: '', product: '', status: 'PENDING_APPROVAL', outcome: 'SKIPPED' as const, reason: 'Waiting for approval', before: { basic: '1', selling: '1', total: '1', gst: '0' }, after: { basic: '1', selling: '1', total: '1', gst: '0' }, warnings: [] }) as any);
    const r = await svc.apply(manager, 'b1');
    expect(r).toMatchObject({ applied: 1, skipped: 1, failed: 1 });
    expect(prisma.recalculationItem.createMany.mock.calls[0][0].data.map((i: any) => i.status)).toEqual(['FAILED', 'SKIPPED', 'APPLIED']);
    expect(prisma.recalculationBatch.update.mock.calls[0][0].data.status).toBe('PARTIAL');
  });

  it('counts unchanged costings without rewriting them', async () => {
    const { svc, prisma, recalc, manager } = make({ affected: ids(2) });
    prisma.recalculationBatch.findUnique.mockResolvedValue(batch);
    recalc.mockImplementation(async (_a: any, id: string) => ({ id, number: '', product: '', status: 'DRAFT', outcome: 'UNCHANGED' as const, reason: null, before: { basic: '1', selling: '1', total: '1', gst: '0' }, after: { basic: '1', selling: '1', total: '1', gst: '0' }, warnings: [] }) as any);
    expect(await svc.apply(manager, 'b1')).toMatchObject({ applied: 0, unchanged: 2 });
  });

  it('cannot be applied twice at once or after it was applied or dismissed', async () => {
    const { svc, prisma, manager } = make();
    prisma.recalculationBatch.findUnique.mockResolvedValue({ ...batch, status: 'APPLIED' });
    prisma.recalculationBatch.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.apply(manager, 'b1')).rejects.toBeInstanceOf(ConflictException);
    prisma.recalculationBatch.findUnique.mockResolvedValue(null);
    await expect(svc.apply(manager, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dismisses a pending batch with a reason, and nothing else', async () => {
    const { svc, prisma, manager } = make();
    await expect(svc.dismiss(manager, 'b1', { reason: '' })).rejects.toBeInstanceOf(BadRequestException);
    await svc.dismiss(manager, 'b1', { reason: 'Supplier quote withdrawn' });
    expect(prisma.recalculationBatch.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'b1', status: { in: ['PENDING', 'PARTIAL'] } }, data: { status: 'DISMISSED', dismissReason: 'Supplier quote withdrawn', dismissedBy: 'u1' } });
    prisma.recalculationBatch.updateMany.mockResolvedValue({ count: 0 });
    prisma.recalculationBatch.findUnique.mockResolvedValue({ status: 'APPLIED' });
    await expect(svc.dismiss(manager, 'b1', { reason: 'too late' })).rejects.toThrow(/applied recalculation cannot be dismissed/);
  });
});

describe('policy', () => {
  it('defaults to CONFIRM and validates changes', async () => {
    const { svc, prisma, manager } = make();
    prisma.costingSettings.findUnique.mockResolvedValue(null);
    expect(await svc.getPolicy()).toEqual({ mode: 'CONFIRM', flagThresholdPercent: 0 });
    await expect(svc.setPolicy(manager, { mode: 'SOMETIMES' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setPolicy(manager, { mode: 'AUTO', flagThresholdPercent: 150 })).rejects.toBeInstanceOf(BadRequestException);
    expect(await svc.setPolicy(manager, { mode: 'AUTO', flagThresholdPercent: '5' })).toEqual({ mode: 'AUTO', flagThresholdPercent: 5 });
    expect(prisma.costingSettings.upsert.mock.calls[0][0].update).toMatchObject({ recalcMode: 'AUTO', flagThresholdPercent: 5 });
  });
});
