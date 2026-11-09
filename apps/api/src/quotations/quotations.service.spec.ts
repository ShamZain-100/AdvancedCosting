import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { QuotationsService } from './quotations.service';
import { testSettings } from '../settings/test-helpers';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const Q = u(1), C1 = u(2), PLI = u(3), CUST = u(4), UNIT = u(5);
const sha = (x: string) => createHash('sha256').update(x).digest('hex');

const costing = (over: Record<string, any> = {}) => ({
  id: C1, costingNumber: 'COST-2026-0001', productName: 'Metal Chair', productCode: 'MC1', version: 3, status: 'APPROVED', quantity: '2', unitId: UNIT,
  basicCost: '8252.24', totalCostInclGst: '9737.64', gstAmount: '1485.40', extraAmount: '0', markupPercent: '10', gstPercent: '18', ...over,
});
const manual = (over: Record<string, any> = {}) => ({ source: 'MANUAL', productName: 'Delivery', quantity: '1', unitPrice: '500', gstPercent: '18', ...over });
const body = (items: any[] = [manual()], over: Record<string, any> = {}) => ({ customerName: 'Acme Traders', quotationDate: '2026-02-01', validityDays: 30, items, ...over });

function make(over: { costings?: any[]; plItems?: any[] } = {}) {
  const tx: any = {
    numberSequence: { upsert: jest.fn().mockResolvedValue({ value: 12 }) },
    quotation: { create: jest.fn().mockResolvedValue({ id: Q }), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    quotationItem: { createMany: jest.fn(), deleteMany: jest.fn() },
    quotationShare: { updateMany: jest.fn() },
    reviewFlag: { updateMany: jest.fn() },
  };
  const db: any = {
    costing: { findMany: jest.fn().mockResolvedValue(over.costings ?? [costing()]) },
    priceListItem: { findMany: jest.fn().mockResolvedValue(over.plItems ?? []) },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: CUST }) },
    unit: { findFirst: jest.fn().mockResolvedValue({ id: UNIT, symbol: 'PC' }) },
    quotation: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    quotationItem: { findMany: jest.fn().mockResolvedValue([]) },
    reviewFlag: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    quotationShare: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(async (fn: any) => (typeof fn === 'function' ? fn(tx) : Promise.all(fn))),
  };
  const settings: any = { getRules: jest.fn().mockResolvedValue({ decimals: 2, rounding: 'HALF_UP' }) };
  const svc = new QuotationsService(db, { log: jest.fn() } as any, settings, { mainImages: async () => new Map() } as any, { get: async () => ({ name: 'Acme', address: null, phone: null, email: null, gstin: null, logoUrl: null }) } as any, testSettings().numbering, testSettings().appSettings);
  const actor = (perms: string[] = ['quotations:edit', 'quotations:create']) => ({ id: 'u1', permissions: new Set(perms) }) as any;
  return { svc, db, tx, actor };
}

const stored = (status: string, over: Record<string, any> = {}) => ({
  id: Q, number: 'QTN-2026-0012', status, version: 2, quotationDate: new Date('2026-02-01'), validUntil: new Date('2099-03-03'), deletedAt: null, ...over,
});

describe('QuotationsService pricing', () => {
  it('totals manual lines with line discount, quotation discount and GST', async () => {
    const { svc } = make();
    const r = await svc.preview(body([manual({ quantity: '2', unitPrice: '1000', discountPercent: '10' }), manual({ productName: 'Fitting', unitPrice: '3000', gstPercent: '5' })], { discountPercent: '5' }));
    expect(r.subtotal).toBe('5000');
    expect(r.lineDiscountTotal).toBe('200');
    expect(r.headerDiscount).toBe('240'); // 5% of 4800
    expect(r.taxableAmount).toBe('4560');
    expect(r.grandTotal).toBe(String(Number(r.taxableAmount) + Number(r.gstAmount)));
    expect(r.gstBreakdown.map((b: any) => b.percent)).toEqual(['5', '18']);
  });

  it('prices a costing line from the approved costing per unit (cost before GST + profit %)', async () => {
    const { svc } = make();
    const r = await svc.preview(body([{ source: 'COSTING', costingId: C1, quantity: '3' }]));
    // 8252.24 for 2 pieces → 4126.12 each; 10% markup → 4538.73 ex-GST
    expect(r.lines[0]).toMatchObject({ productName: 'Metal Chair', unitPrice: '4538.73', gstPercent: '18', costingVersion: 3, unitLabel: 'PC', profitPercent: '10' });
    expect(r.lines[0].gross).toBe('13616.19');
  });

  it('lets the user choose the profit % and GST for a costing line', async () => {
    const { svc } = make();
    const r = await svc.preview(body([{ source: 'COSTING', costingId: C1, quantity: '1', profitPercent: '20', gstPercent: '12' }]));
    expect(r.lines[0]).toMatchObject({ unitPrice: '4951.34', gstPercent: '12' });
  });

  it('refuses costings that are not approved', async () => {
    const { svc } = make({ costings: [costing({ status: 'DRAFT' })] });
    await expect(svc.preview(body([{ source: 'COSTING', costingId: C1, quantity: '1' }]))).rejects.toThrow(/not approved/);
  });

  it('quotes a costing line with its extra % and after-GST expenses included', async () => {
    const { svc } = make({ costings: [costing({ basicCost: '1000', gstAmount: '180', totalCostInclGst: '1280', extraAmount: '64', quantity: '2', markupPercent: '0' })] });
    const r = await svc.preview(body([{ source: 'COSTING', costingId: C1, quantity: '1' }]));
    expect(r.lines[0].unitPrice).toBe('569.49'); // (1000 + 164 / 1.18) / 2; with 18% GST the customer pays the 672 the unit really costs
  });

  it('never charges GST on a line from a list marked as having no GST', async () => {
    const pli = { id: PLI, costingId: C1, costingVersion: 3, pricedPerUnit: true, productName: 'Metal Chair', productCode: 'MC1', effectiveExGst: '100', gstPercent: '18', priceList: { status: 'ACTIVE', number: 'PL-1', deletedAt: null, gstTreatment: 'NONE' }, costing: costing() };
    const { svc } = make({ plItems: [pli] });
    const r = await svc.preview(body([{ source: 'PRICE_LIST', priceListItemId: PLI, quantity: '1', gstPercent: '18' }]));
    expect(r.lines[0].gstPercent).toBe('0');
    expect(r.grandTotal).toBe('100');
  });

  it('refuses a line from a list still priced for the whole batch', async () => {
    const pli = { id: PLI, costingId: C1, costingVersion: 3, pricedPerUnit: false, productName: 'Metal Chair', productCode: 'MC1', effectiveExGst: '9000', gstPercent: '18', priceList: { status: 'ACTIVE', number: 'PL-1', deletedAt: null }, costing: costing() };
    const { svc } = make({ plItems: [pli] });
    await expect(svc.preview(body([{ source: 'PRICE_LIST', priceListItemId: PLI, quantity: '1' }]))).rejects.toThrow(/whole batch/);
  });

  it('prices a price-list line from the list\'s effective ex-GST price for one unit', async () => {
    const pli = { id: PLI, costingId: C1, costingVersion: 3, pricedPerUnit: true, productName: 'Metal Chair', productCode: 'MC1', effectiveExGst: '4500', gstPercent: '18', priceList: { status: 'ACTIVE', number: 'PL-2026-0001', deletedAt: null }, costing: costing() };
    const { svc } = make({ plItems: [pli] });
    const r = await svc.preview(body([{ source: 'PRICE_LIST', priceListItemId: PLI, quantity: '1' }]));
    expect(r.lines[0].unitPrice).toBe('4500');
  });

  it('refuses price-list lines from inactive lists or out-of-date items', async () => {
    const base = { id: PLI, costingId: C1, costingVersion: 3, productName: 'X', productCode: null, effectiveExGst: '10', gstPercent: '18' };
    const inactive = make({ plItems: [{ ...base, priceList: { status: 'DRAFT', number: 'PL-1', deletedAt: null }, costing: costing() }] });
    await expect(inactive.svc.preview(body([{ source: 'PRICE_LIST', priceListItemId: PLI, quantity: '1' }]))).rejects.toThrow(/not active/);
    const stale = make({ plItems: [{ ...base, priceList: { status: 'ACTIVE', number: 'PL-1', deletedAt: null }, costing: costing({ version: 4 }) }] });
    await expect(stale.svc.preview(body([{ source: 'PRICE_LIST', priceListItemId: PLI, quantity: '1' }]))).rejects.toThrow(/out of date/);
  });

  it('validates the payload: manual lines need name, price and GST; at least one line', async () => {
    const { svc } = make();
    await expect(svc.preview(body([]))).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.preview(body([{ source: 'MANUAL', quantity: '1' }]))).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.preview(body([manual({ discountPercent: '5', discountAmount: '5' })]))).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.preview(body([manual()], { discountPercent: '5', discountAmount: '5' }))).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('QuotationsService persistence', () => {
  it('creates a numbered draft with computed totals and line rows', async () => {
    const { svc, tx, actor } = make();
    jest.spyOn(svc, 'get').mockResolvedValue({ id: Q } as any);
    await svc.create(actor(), body([manual({ quantity: '2', unitPrice: '1000' })]));
    expect(tx.quotation.create.mock.calls[0][0].data).toMatchObject({ number: `QTN-${new Date().getUTCFullYear()}-0012`, customerName: 'Acme Traders', grandTotal: '2360', preparedById: 'u1' });
    expect(tx.quotation.create.mock.calls[0][0].data.validUntil).toEqual(new Date('2026-03-03T00:00:00.000Z'));
    expect(tx.quotationItem.createMany.mock.calls[0][0].data[0]).toMatchObject({ quotationId: Q, gross: '2000', gstAmount: '360', lineTotal: '2360' });
  });

  it('only drafts can be edited', async () => {
    const { svc, db, actor } = make();
    db.quotation.findFirst.mockResolvedValue(stored('SENT'));
    await expect(svc.update(actor(), Q, body())).rejects.toThrow(/Only draft/);
    await expect(svc.reprice(actor(), Q)).rejects.toThrow(/Only draft/);
  });

  it('open review flags (a rate the frozen prices used changed) mark the quotation for review without changing it', async () => {
    const { svc, db } = make();
    const record = (status: string) => ({ ...stored(status), customerName: 'Acme', discountPercent: null, discountAmount: null, preparedBy: { id: 'u1', name: 'A' }, items: [{ id: 'i1', source: 'COSTING', costingId: C1, costingVersion: 3, productName: 'Chair', quantity: '1', unitPrice: '1', gstPercent: '18', profitPercent: null, discountPercent: null, discountAmount: null, costing: { costingNumber: 'C', version: 3, status: 'APPROVED', deletedAt: null } }] });
    db.quotation.findFirst.mockResolvedValue(record('SENT'));
    db.reviewFlag.findMany.mockResolvedValue([{ id: 'f1', reason: 'Pipe: rate 98 → 105 (frozen prices on this document were not changed)', createdAt: new Date() }]);
    const q = await svc.get(Q);
    expect(q.reviewFlags).toHaveLength(1);
    expect(q.needsReview).toBe(true);
    expect(q.items[0].stale).toBe(false); // the costing itself did not change, so the lines are not out of date
    db.reviewFlag.findMany.mockResolvedValue([]);
    expect((await svc.get(Q)).needsReview).toBe(false);
    db.quotation.findFirst.mockResolvedValue(record('CONVERTED'));
    db.reviewFlag.findMany.mockResolvedValue([{ id: 'f1', reason: 'r', createdAt: new Date() }]);
    expect((await svc.get(Q)).needsReview).toBe(false); // finished quotations are history
  });

  it('repricing a draft clears its review flags', async () => {
    const { svc, db, actor } = make();
    db.quotation.findFirst.mockResolvedValue(stored('DRAFT'));
    jest.spyOn(svc, 'get').mockResolvedValue({ id: Q, payload: body() } as any);
    jest.spyOn(svc as any, 'write').mockResolvedValue(undefined);
    await svc.reprice(actor(), Q);
    expect(db.reviewFlag.updateMany).toHaveBeenCalledWith({ where: { quotationId: Q, resolvedAt: null }, data: { resolvedAt: expect.any(Date), resolvedBy: 'u1' } });
  });

  it('404s for a missing quotation', async () => {
    const { svc, db } = make();
    db.quotation.findFirst.mockResolvedValue(null);
    await expect(svc.get(Q)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('duplicate makes a new draft with identical figures and no status history', async () => {
    const { svc, db, tx, actor } = make();
    db.quotation.findFirst.mockResolvedValue({
      ...stored('SENT'), customerId: CUST, customerName: 'Acme', customerMobile: null, customerEmail: null, customerAddress: null, customerGstin: null, customerState: null,
      subject: 's', terms: 't', notes: null, discountPercent: null, discountAmount: null, roundGrandTotal: false, rules: {}, subtotal: '100', lineDiscountTotal: '0', headerDiscount: '0',
      taxableAmount: '100', gstAmount: '18', roundOff: '0', grandTotal: '118', sentAt: new Date(),
      items: [{ sortOrder: 0, source: 'MANUAL', costingId: null, costingVersion: null, priceListItemId: null, profitPercent: null, productName: 'P', productCode: null, description: null, quantity: '1', unitId: null, unitLabel: null, unitPrice: '100', discountPercent: null, discountAmount: null, gstPercent: '18', gross: '100', lineDiscount: '0', headerDiscountShare: '0', taxableNet: '100', gstAmount: '18', lineTotal: '118' }],
    });
    jest.spyOn(svc, 'get').mockResolvedValue({ id: Q } as any);
    await svc.duplicate(actor(), Q);
    const data = tx.quotation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'DRAFT', grandTotal: '118', customerName: 'Acme', preparedById: 'u1' });
    expect(data.sentAt).toBeUndefined();
    expect(tx.quotationItem.createMany.mock.calls[0][0].data[0]).toMatchObject({ lineTotal: '118', productName: 'P' });
  });
});

describe('QuotationsService workflow', () => {
  const withStatus = (status: string, extra: Record<string, any> = {}, items: any[] = []) => {
    const ctx = make();
    ctx.db.quotation.findFirst.mockImplementation(async ({ include }: any) => (include ? { ...stored(status, extra), items, customer: null, preparedBy: { id: 'u1', name: 'A' }, customerName: 'x', discountPercent: null, discountAmount: null } : stored(status, extra)));
    return ctx;
  };

  it('moves draft → pending → approved → sent → converted', async () => {
    const draft = withStatus('DRAFT');
    expect(await draft.svc.transition(draft.actor(), Q, 'submit', {})).toEqual({ id: Q, status: 'PENDING' });
    const pending = withStatus('PENDING');
    expect(await pending.svc.transition(pending.actor(['quotations:approve']), Q, 'approve', {})).toEqual({ id: Q, status: 'APPROVED' });
    const approved = withStatus('APPROVED');
    const sent = await approved.svc.transition(approved.actor(), Q, 'send', {});
    expect(sent.status).toBe('SENT');
    expect(approved.tx.quotation.update.mock.calls[0][0].data.sentAt).toBeInstanceOf(Date);
    const conv = withStatus('SENT');
    await expect(conv.svc.transition(conv.actor(), Q, 'convert', {})).rejects.toThrow(/reference/);
    expect(await conv.svc.transition(conv.actor(), Q, 'convert', { reference: 'SO-77' })).toEqual({ id: Q, status: 'CONVERTED' });
  });

  it('rejects invalid transitions', async () => {
    const { svc, actor } = withStatus('CONVERTED');
    await expect(svc.transition(actor(), Q, 'send', {})).rejects.toThrow(/Cannot send/);
    await expect(svc.transition(actor(), Q, 'nonsense' as never, {})).rejects.toThrow(/Unknown action/);
  });

  it('internal approval / rejection needs quotations:approve, and rejection needs a reason', async () => {
    const { svc, actor } = withStatus('PENDING');
    await expect(svc.transition(actor(), Q, 'approve', {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.transition(actor(['quotations:approve']), Q, 'reject', {})).rejects.toThrow(/reason/);
  });

  it('reopening a sent or approved quotation needs the approver permission and a reason, and revokes share links', async () => {
    const { svc, actor, tx } = withStatus('SENT');
    await expect(svc.transition(actor(), Q, 'revise', { reason: 'price change' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.transition(actor(['quotations:approve']), Q, 'revise', {})).rejects.toThrow(/reason/);
    await svc.transition(actor(['quotations:approve']), Q, 'revise', { reason: 'price change' });
    expect(tx.quotation.update.mock.calls[0][0].data).toMatchObject({ status: 'DRAFT', version: 3 });
    expect(tx.quotationShare.updateMany).toHaveBeenCalledWith({ where: { quotationId: Q, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });

  it('rejected quotations can be revised by an editor', async () => {
    const { svc, actor } = withStatus('REJECTED');
    expect(await svc.transition(actor(), Q, 'revise', {})).toEqual({ id: Q, status: 'DRAFT' });
  });

  it('will not send or approve while a linked costing has changed', async () => {
    const staleItem = { id: 'i', source: 'COSTING', costingVersion: 2, productName: 'Chair', quantity: '1', unitPrice: '1', gstPercent: '18', costing: { costingNumber: 'C', version: 3, status: 'APPROVED', deletedAt: null } };
    const { svc, actor } = withStatus('DRAFT', {}, [staleItem]);
    await expect(svc.transition(actor(), Q, 'send', {})).rejects.toThrow(/Reprice the quotation/);
  });

  it('marks overdue sent / pending quotations as expired', async () => {
    const { svc, db } = make();
    await svc.expireOverdue();
    expect(db.quotation.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ status: { in: ['SENT', 'PENDING'] }, validUntil: { lt: expect.any(Date) } }), data: { status: 'EXPIRED' } });
  });

  it('throttles the expiry sweep on reads but forces it for actions', async () => {
    const { svc, db } = make();
    await svc.expireOverdue();
    await svc.expireOverdue();
    expect(db.quotation.updateMany).toHaveBeenCalledTimes(1);
    await svc.expireOverdue(true);
    expect(db.quotation.updateMany).toHaveBeenCalledTimes(2);
  });

  it('only drafts, rejected or expired quotations can be deleted', async () => {
    const { svc, actor } = withStatus('SENT');
    await expect(svc.remove(actor(), Q)).rejects.toThrow(/Only draft, rejected or expired/);
  });
});

describe('QuotationsService sharing', () => {
  it('creates a share link only for sent / approved quotations and stores just the hash', async () => {
    const draft = make();
    draft.db.quotation.findFirst.mockResolvedValue(stored('DRAFT'));
    await expect(draft.svc.createShare(draft.actor(), Q, {})).rejects.toThrow(/Only sent or approved/);

    const { svc, db, actor } = make();
    db.quotation.findFirst.mockResolvedValue(stored('SENT'));
    db.quotationShare.create.mockImplementation(async ({ data }: any) => ({ id: 's1', ...data }));
    const r = await svc.createShare(actor(), Q, {});
    expect(r.token.length).toBeGreaterThan(40);
    expect(db.quotationShare.create.mock.calls[0][0].data.tokenHash).toBe(sha(r.token));
    expect(JSON.stringify(db.quotationShare.create.mock.calls[0][0].data)).not.toContain(r.token);
  });

  it('the public view hides internal data and rejects bad, revoked and expired tokens', async () => {
    const { svc, db } = make();
    db.quotationShare.findUnique.mockResolvedValue(null);
    await expect(svc.publicView('nope')).rejects.toBeInstanceOf(NotFoundException);
    db.quotationShare.findUnique.mockResolvedValue({ quotationId: Q, revokedAt: new Date(), expiresAt: new Date(Date.now() + 1e6) });
    await expect(svc.publicView('t')).rejects.toBeInstanceOf(NotFoundException);
    db.quotationShare.findUnique.mockResolvedValue({ quotationId: Q, revokedAt: null, expiresAt: new Date(Date.now() - 1e3) });
    await expect(svc.publicView('t')).rejects.toBeInstanceOf(NotFoundException);

    db.quotationShare.findUnique.mockResolvedValue({ quotationId: Q, revokedAt: null, expiresAt: new Date(Date.now() + 1e6) });
    db.quotation.findFirst.mockResolvedValue({
      ...stored('SENT'), customerName: 'Acme', customerAddress: 'Pune', customerGstin: null, customerState: null, subject: null, terms: 'Pay in 30 days', notes: 'secret internal note?',
      discountPercent: null, discountAmount: null, roundGrandTotal: false, rules: { decimals: 2, rounding: 'HALF_UP' }, subtotal: '1000', lineDiscountTotal: '0', headerDiscount: '0',
      taxableAmount: '1000', gstAmount: '180', roundOff: '0', grandTotal: '1180', preparedBy: { name: 'Sales Person' },
      items: [{ productName: 'Chair', productCode: 'C', description: null, quantity: '1', unitLabel: 'PC', unitPrice: '1000', lineDiscount: '0', gstPercent: '18', gstAmount: '180', lineTotal: '1180', discountPercent: null, discountAmount: null, costingId: C1, profitPercent: '10' }],
    });
    const view = await svc.publicView('t');
    expect(view.totals.grandTotal).toBe('1180');
    expect(view.gstBreakdown).toEqual([{ percent: '18', taxable: '1000', gst: '180' }]);
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/costingId|profitPercent|preparedById|createdBy|rules/);
  });
});
