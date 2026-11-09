import { customerGroupSchema, customerSchema, priceListDealerSchema } from '@costing/validators';
import { MasterService } from './master.service';
import { MASTERS } from './masters.config';
import { grantsFor, MODULES_ADDED_LATER, ROLES } from '../seed/seed';

const cfg = (path: string) => MASTERS.find((m) => m.path === path)!;
const actor: any = { id: 'u1' };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function make(delegates: Record<string, any> = {}) {
  const prisma: any = { ...delegates, $transaction: jest.fn(async (fn: any) => fn({})) };
  return { svc: new MasterService(prisma, { log: jest.fn() } as any), prisma };
}

describe('price list dealer rules', () => {
  const ok = { name: 'Dealer', code: 'DLR' };

  it('a margin is a non-negative decimal string with no upper limit, defaulting to 0', () => {
    expect(priceListDealerSchema.parse(ok).marginPercent).toBe('0');
    expect(priceListDealerSchema.parse({ ...ok, marginPercent: '12.5' }).marginPercent).toBe('12.5');
    expect(priceListDealerSchema.safeParse({ ...ok, marginPercent: '250' }).success).toBe(true);
    expect(priceListDealerSchema.safeParse({ ...ok, marginPercent: '-1' }).success).toBe(false);
    expect(priceListDealerSchema.safeParse({ ...ok, marginPercent: 12.5 }).success).toBe(false);
    expect(priceListDealerSchema.safeParse({ ...ok, marginPercent: 'abc' }).success).toBe(false);
  });

  it('name and code are required and the code is restricted like other masters', () => {
    expect(priceListDealerSchema.safeParse({ name: '', code: 'X' }).success).toBe(false);
    expect(priceListDealerSchema.safeParse({ name: 'A', code: 'has space' }).success).toBe(false);
  });

  it('a customer may name a plain customer group, or none; a customer group has no margin', () => {
    const base = { name: 'Acme', code: 'ACM' };
    expect(customerSchema.safeParse(base).success).toBe(true);
    expect(customerSchema.safeParse({ ...base, customerGroupId: '' }).success).toBe(true);
    expect(customerSchema.safeParse({ ...base, customerGroupId: uuid(1) }).success).toBe(true);
    expect(customerSchema.safeParse({ ...base, customerGroupId: 'not-a-uuid' }).success).toBe(false);
    expect(customerGroupSchema.parse({ name: 'Retail', code: 'RTL', marginPercent: '10' })).not.toHaveProperty('marginPercent');
  });
});

describe('price list dealer and customer group masters', () => {
  it('dealers are their own permission module and sortable by margin; customer groups stay a separate plain master', () => {
    const c = cfg('price-list-dealers');
    expect(c.module).toBe('price_list_dealers');
    expect(c.sortable).toContain('marginPercent');
    expect(cfg('customer-groups').module).toBe('customer_groups');
    expect(cfg('customer-groups').sortable).not.toContain('marginPercent');
  });

  it('a customer cannot be saved into a group that does not exist (or was deleted)', async () => {
    const { svc } = make({ customerGroup: { findFirst: jest.fn().mockResolvedValue(null) }, customer: { findFirst: jest.fn(), create: jest.fn() } });
    await expect(svc.create(cfg('customers'), actor, { name: 'Acme', code: 'ACM', customerGroupId: uuid(5) })).rejects.toThrow(/customer group does not exist/);
  });

  it('in use cannot be deleted: a customer group by customers, a dealer by user assignments', async () => {
    const row = { id: uuid(1), name: 'Dealer', code: 'DLR' };
    const byCustomers = make({ customerGroup: { findFirst: jest.fn().mockResolvedValue(row), update: jest.fn() }, customer: { count: jest.fn().mockResolvedValue(3) } });
    await expect(byCustomers.svc.remove(cfg('customer-groups'), actor, uuid(1))).rejects.toThrow(/used by 3 customer/);
    const byUsers = make({ priceListDealer: { findFirst: jest.fn().mockResolvedValue(row), update: jest.fn() }, userPriceListDealer: { count: jest.fn().mockResolvedValue(2) } });
    await expect(byUsers.svc.remove(cfg('price-list-dealers'), actor, uuid(1))).rejects.toThrow(/used by 2 user assignment/);
  });

  it('an unused dealer is soft deleted and its code freed', async () => {
    const update = jest.fn();
    const { svc } = make({ priceListDealer: { findFirst: jest.fn().mockResolvedValue({ id: uuid(1), name: 'Dealer', code: 'DLR' }), update }, userPriceListDealer: { count: jest.fn().mockResolvedValue(0) } });
    await svc.remove(cfg('price-list-dealers'), actor, uuid(1));
    expect(update.mock.calls[0][0].data).toMatchObject({ isActive: false, code: expect.stringMatching(/^DLR~deleted~/) });
  });
});

describe('starter roles and the new module', () => {
  it('Admin manages them; Accountant may view dealers and their price list; Staff sees customer groups only', () => {
    expect(grantsFor('Admin', MODULES_ADDED_LATER)).toEqual(expect.arrayContaining(['customer_groups:edit', 'price_list_dealers:edit', 'dealer_price_list:view', 'images:edit']));
    expect(grantsFor('Accountant', MODULES_ADDED_LATER).sort()).toEqual(['customer_groups:view', 'dealer_price_list:export', 'dealer_price_list:print', 'dealer_price_list:view', 'price_list_dealers:view']);
    expect(grantsFor('Staff', MODULES_ADDED_LATER)).toEqual(['customer_groups:view']);
  });

  it('the catch-up list only names modules that exist', () => {
    for (const m of MODULES_ADDED_LATER) expect(Object.values(ROLES).some((r) => m in r.grants)).toBe(true);
  });
});
