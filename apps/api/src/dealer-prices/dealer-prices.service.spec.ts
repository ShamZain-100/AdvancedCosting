import { BadRequestException } from '@nestjs/common';
import { columnKey } from '@costing/config';
import { DealerPricesService, money } from './dealer-prices.service';
import { NotificationsService } from '../notifications/notifications.service';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C1 = u(1), D1 = u(11), D2 = u(12), DEALER_USER = u(21);
const D = (v: string | number) => ({ toString: () => String(v) });

// basic 2110, total 2489.80, extra 124.49, 2 pieces (hand-checked in the engine tests)
const costing = (over: Record<string, any> = {}) => ({
  id: C1, costingNumber: 'COST-1', productName: 'Chair', productCode: 'CH', quantity: D(2), unitId: null, status: 'APPROVED', approvedAt: new Date('2026-11-08'), rules: { decimals: 2, rounding: 'HALF_UP' },
  published: false, basicCost: D(2110), totalCostInclGst: D('2489.8'), extraAmount: D('124.49'), companyExpenseCost: D(100), markupAmount: D('261.43'), sellingPrice: D('2875.72'), ...over,
});
const dealer = (id: string, margin: string, over: Record<string, any> = {}) => ({ id, name: id === D1 ? 'Dealer' : 'Branch', code: id === D1 ? 'DLR' : 'BR', marginPercent: D(margin), isActive: true, deletedAt: null, ...over });

function make(o: { costings?: any[]; dealers?: any[]; rows?: any[]; links?: any[] } = {}) {
  const rows: any[] = o.rows ?? [];
  const list = o.costings ?? [costing()];
  const prisma: any = {
    costing: {
      findMany: jest.fn(async ({ where, select }: any) => list.filter((c) => (!where.id || where.id.in.includes(c.id)) && (where.published === undefined || c.published === where.published))
        .map((c) => (select?.dealerPrices ? { ...c, dealerPrices: rows.filter((r) => r.costingId === c.id && select.dealerPrices.where.dealerId.in.includes(r.dealerId)) } : c))),
      findFirst: jest.fn(async () => list[0]), findUnique: jest.fn(async () => list[0]), update: jest.fn(async ({ data }: any) => Object.assign(list[0], data)),
    },
    priceListDealer: { findMany: jest.fn(async ({ where }: any) => (o.dealers ?? [dealer(D1, '20'), dealer(D2, '0')]).filter((x) => !where?.id?.in || where.id.in.includes(x.id))) },
    costingDealerPrice: {
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => (!where.costingId || (where.costingId.in ?? [where.costingId]).includes(r.costingId)) && (!where.dealerId?.in || where.dealerId.in.includes(r.dealerId)) && (!where.announcedUnitPrice || r.announcedUnitPrice !== null))),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = where.costingId_dealerId; const ex = rows.find((r) => r.costingId === k.costingId && r.dealerId === k.dealerId);
        if (ex) Object.assign(ex, Object.fromEntries(Object.entries(update).map(([a, b]) => [a, D(b as string)])));
        else rows.push({ id: `${k.costingId}|${k.dealerId}`, announcedUnitPrice: null, ...Object.fromEntries(Object.entries(create).map(([a, b]) => [a, a.endsWith('Id') ? b : D(b as string)])) });
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), { announcedUnitPrice: D(data.announcedUnitPrice) })),
      updateMany: jest.fn(async ({ data }: any) => rows.forEach((r) => Object.assign(r, data))),
      deleteMany: jest.fn(),
    },
    userPriceListDealer: { findMany: jest.fn(async ({ where }: any) => (o.links ?? []).filter((l: any) => (!where.dealerId || where.dealerId.in.includes(l.dealerId)) && (!where.userId || l.userId === where.userId))) },
    notification: { createMany: jest.fn() },
    pushSubscription: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    unit: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const notifications = new NotificationsService(prisma, { get: () => undefined } as any);
  const svc = new DealerPricesService(prisma, { log: jest.fn() } as any, { mainImages: async () => new Map() } as any, notifications);
  return { svc, prisma, rows };
}
const admin: any = { id: 'a', isSuperAdmin: true, permissions: new Set() };

describe('dealer prices', () => {
  it('prices an approved costing for every active dealer from its saved figures, per unit', async () => {
    const { svc, rows } = make();
    const changes = await svc.refresh({ costingIds: [C1] });
    expect(changes.map((c) => [c.dealerId, c.before, c.after])).toEqual([[D1, null, '1568.58'], [D2, null, '1307.15']]);
    expect(rows.find((r) => r.dealerId === D1).sellingPrice.toString()).toBe('3137.15');
  });

  it('reports only prices that really changed', async () => {
    const { svc } = make();
    await svc.refresh({ costingIds: [C1] });
    expect(await svc.refresh({ costingIds: [C1] })).toEqual([]);
  });

  it('removes the rows of a dealer that was switched off', async () => {
    const { svc, prisma } = make({ dealers: [dealer(D1, '20', { isActive: false })] });
    await svc.refresh({ dealerIds: [D1] });
    expect(prisma.costingDealerPrice.deleteMany).toHaveBeenCalledWith({ where: { dealerId: { in: [D1] } } });
  });
});

describe('publishing', () => {
  it('only an approved costing can be published', async () => {
    const { svc } = make({ costings: [costing({ status: 'DRAFT' })] });
    await expect(svc.setPublished(admin, C1, { published: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setPublished(admin, C1, { published: 'yes' })).rejects.toThrow(/true or false/);
  });

  it('publishing tells each dealer\'s users the new product and price; a later margin change says was and now', async () => {
    const c = costing();
    const { svc, prisma, rows } = make({ costings: [c], links: [{ userId: DEALER_USER, dealerId: D1 }] });
    await svc.setPublished(admin, C1, { published: true });
    expect(prisma.notification.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ userId: DEALER_USER, kind: 'PRICE_NEW', title: 'New on your price list: Chair', body: 'Price 1,568.58 per unit.' })]);
    // the dealer's margin goes from 20% to 30%
    prisma.priceListDealer.findMany.mockResolvedValue([dealer(D1, '30')]);
    const changes = await svc.refresh({ dealerIds: [D1] });
    await svc.announce(changes, 'changed');
    expect(prisma.notification.createMany.mock.calls[1][0].data[0]).toMatchObject({ kind: 'PRICE_CHANGED', title: 'Price increased: Chair', body: 'Was 1,568.58, now 1,699.29 per unit.' });
    expect(rows.find((r) => r.dealerId === D1).announcedUnitPrice.toString()).toBe('1699.29');
  });

  it('an unpublished costing\'s price changes tell nobody', async () => {
    const { svc, prisma } = make({ links: [{ userId: DEALER_USER, dealerId: D1 }] });
    const changes = await svc.refresh({ costingIds: [C1] });
    expect(await svc.announce(changes, 'changed')).toBe(0);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('a failing push never fails the publish', async () => {
    const { svc, prisma } = make({ links: [{ userId: DEALER_USER, dealerId: D1 }] });
    prisma.pushSubscription.findMany.mockResolvedValue([{ id: 's1', userId: DEALER_USER, endpoint: 'https://push.example/1', p256dh: 'x'.repeat(30), auth: 'y'.repeat(16) }]);
    (svc as any).notifications.useSender(async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); });
    await expect(svc.setPublished(admin, C1, { published: true })).resolves.toEqual({ id: C1, published: true });
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['s1'] } } }); // dead device forgotten
  });
});

describe('the price list and the cost report', () => {
  const rowsFor = async (svc: DealerPricesService) => { await svc.refresh({ costingIds: [C1] }); };

  it('a dealer user sees only their own dealer\'s column and the allowed columns', async () => {
    const { svc } = make({ costings: [costing({ published: true })], links: [{ userId: DEALER_USER, dealerId: D1 }] });
    await rowsFor(svc);
    const user: any = { id: DEALER_USER, isSuperAdmin: false, permissions: new Set(['dealer_price_list:view', columnKey('price_list', 'productName'), columnKey('price_list', 'dealerPrices')]) };
    const r = await svc.priceList(user, {});
    expect(r.columns.map((c) => c.key)).toEqual(['productName', `dealer_${D1}`]);
    expect(r.items).toEqual([{ id: C1, productName: 'Chair', [`dealer_${D1}`]: '1568.58' }]);
  });

  it('a dealer login without a dealer sees nothing; staff with dealer access see every dealer', async () => {
    const { svc } = make({ costings: [costing({ published: true })] });
    await rowsFor(svc);
    const lonely: any = { id: u(30), isSuperAdmin: false, permissions: new Set(['dealer_price_list:view', columnKey('price_list', 'productName'), columnKey('price_list', 'dealerPrices')]) };
    expect((await svc.priceList(lonely, {})).items).toEqual([]);
    const staff: any = { ...lonely, permissions: new Set([...lonely.permissions, 'price_list_dealers:view']) };
    expect((await svc.priceList(staff, {})).columns.map((c) => c.key)).toEqual(['productName', `dealer_${D1}`, `dealer_${D2}`]);
  });

  it('hidden cost columns never leave the server, and cannot be filtered or sorted on', async () => {
    const { svc } = make();
    const user: any = { id: 'x', isSuperAdmin: false, permissions: new Set([columnKey('cost_report', 'productName'), columnKey('cost_report', 'sellingPrice')]) };
    const r = await svc.costReport(user, {});
    expect(r.items).toEqual([{ id: C1, productName: 'Chair', sellingPrice: '2875.72' }]);
    await expect(svc.costReport(user, { sort: 'basicCost' })).rejects.toThrow(/unknown column/);
    await expect(svc.costReport(user, { 'min.markupAmount': '1' })).rejects.toThrow(/unknown column/);
  });

  it('filters money as decimals and pages the result', async () => {
    const { svc } = make({ costings: [costing(), costing({ id: u(2), productName: 'Table', sellingPrice: D('999.99') })] });
    const r = await svc.costReport(admin, { 'min.sellingPrice': '1000', sort: 'productName' });
    expect(r.items.map((i: any) => i.productName)).toEqual(['Chair']);
    expect((await svc.costReport(admin, { 'f.productName': 'tab' })).items.map((i: any) => i.productName)).toEqual(['Table']);
    expect((await svc.costReport(admin, { 'max.sellingPrice': 'x' as any }).catch((e) => e.message))).toMatch(/number/);
  });
});

describe('money for messages', () => {
  it('groups digits the Indian way without floating point', () => {
    expect(money('1568.58')).toBe('1,568.58');
    expect(money('12345678.5')).toBe('1,23,45,678.50');
    expect(money('99')).toBe('99.00');
  });
});
