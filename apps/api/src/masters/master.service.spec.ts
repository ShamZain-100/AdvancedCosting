import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MasterService } from './master.service';
import { MASTERS } from './masters.config';

const cfg = (path: string) => MASTERS.find((m) => m.path === path)!;
const actor: any = { id: 'u1' };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function make(delegates: Record<string, any> = {}) {
  const tx: any = {};
  const prisma: any = {
    ...delegates,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    __tx: tx,
  };
  const audit: any = { log: jest.fn() };
  return { svc: new MasterService(prisma, audit), prisma, audit, tx };
}

describe('MasterService', () => {
  it('clears an optional field the user emptied, and never touches anything the form does not own', async () => {
    const update = jest.fn();
    const stored = { id: uuid(1), name: 'Acme', code: 'AC', customerGroupId: uuid(5), contactPerson: 'Sam', email: 'a@x.com' };
    const { svc, tx } = make({ customer: { findFirst: jest.fn().mockResolvedValue(stored), update } });
    tx.customer = { update };
    await svc.update(cfg('customers'), actor, uuid(1), { name: 'Acme', code: 'AC', customerGroupId: '', contactPerson: '', deletedAt: '', createdBy: '' });
    const data = update.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: 'Acme', customerGroupId: null, contactPerson: null });
    expect(data).not.toHaveProperty('deletedAt');
    expect(data).not.toHaveProperty('createdBy');
    expect(data).not.toHaveProperty('email'); // not sent, so left alone
  });

  it('rejects invalid payloads with field messages', async () => {
    const { svc } = make();
    await expect(svc.create(cfg('types'), actor, { name: '', code: 'bad code!' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks deleting a record that is still referenced', async () => {
    const { svc } = make({
      type: { findFirst: jest.fn().mockResolvedValue({ id: uuid(1), name: 'Chairs', code: 'CH' }), update: jest.fn() },
      itemGroup: { count: jest.fn().mockResolvedValue(2) },
      item: { count: jest.fn().mockResolvedValue(0) },
      labour: { count: jest.fn().mockResolvedValue(0) },
      template: { count: jest.fn().mockResolvedValue(0) },
      costing: { count: jest.fn().mockResolvedValue(0) },
    });
    await expect(svc.remove(cfg('types'), actor, uuid(1))).rejects.toThrow(/used by 2 item group/);
  });

  it('soft deletes unreferenced records and frees the code', async () => {
    const update = jest.fn();
    const { svc } = make({
      type: { findFirst: jest.fn().mockResolvedValue({ id: uuid(1), name: 'Chairs', code: 'CH' }), update },
      itemGroup: { count: jest.fn().mockResolvedValue(0) },
      item: { count: jest.fn().mockResolvedValue(0) },
      labour: { count: jest.fn().mockResolvedValue(0) },
      template: { count: jest.fn().mockResolvedValue(0) },
      costing: { count: jest.fn().mockResolvedValue(0) },
    });
    await svc.remove(cfg('types'), actor, uuid(1));
    const data = update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.isActive).toBe(false);
    expect(data.code).toMatch(/^CH~deleted~/);
  });

  it('returns 404 for a missing or soft-deleted record', async () => {
    const { svc } = make({ type: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(svc.get(cfg('types'), uuid(9))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps duplicate codes to 409', async () => {
    const create = jest.fn().mockRejectedValue({ code: 'P2002', meta: { target: ['code'] } });
    const { svc, tx } = make({});
    tx.type = { create };
    await expect(svc.create(cfg('types'), actor, { name: 'A', code: 'A1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('list only returns non-deleted rows and applies search + filters', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { svc } = make({ itemGroup: { findMany, count: jest.fn().mockResolvedValue(0) } });
    await svc.list(cfg('item-groups'), { search: 'wood', typeId: uuid(2), status: 'active' });
    const where = findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.typeId).toBe(uuid(2));
    expect(where.isActive).toBe(true);
    expect(where.OR).toHaveLength(2);
  });
});

describe('master validation rules', () => {
  const group = { id: uuid(2), typeId: uuid(1) };
  const base = {
    name: 'Metal Pipe MAX', code: 'MPM', typeId: uuid(1), groupId: uuid(2), categoryId: uuid(3), unitId: uuid(4),
    defaultPurchaseRate: '98', gstPercent: '18', unitConversions: [{ unitId: uuid(5), conversionValue: '3.15' }], suppliers: [],
  };
  const prismaFor = (over: any = {}) => ({
    type: { findFirst: jest.fn().mockResolvedValue({ id: uuid(1) }) },
    itemGroup: { findFirst: jest.fn().mockResolvedValue(over.group ?? group) },
    itemCategory: { findFirst: jest.fn().mockResolvedValue(over.category ?? { id: uuid(3), groupId: uuid(2) }) },
    unit: { findFirst: jest.fn().mockResolvedValue({ id: uuid(4) }), count: jest.fn().mockResolvedValue(1) },
    supplier: { count: jest.fn().mockResolvedValue(0) },
  }) as any;
  const item = cfg('items');
  const parse = (v: any) => item.schema.safeParse(v);

  it('accepts a valid item with a Meter→KG conversion', async () => {
    const r = parse(base);
    expect(r.success).toBe(true);
    await expect(item.validate!((r as any).data, { prisma: prismaFor() })).resolves.toBeUndefined();
  });

  it('rejects a group that does not belong to the type', async () => {
    const r = parse(base) as any;
    await expect(item.validate!(r.data, { prisma: prismaFor({ group: { id: uuid(2), typeId: uuid(99) } }) })).rejects.toThrow(/does not belong to the selected type/);
  });

  it('rejects a category that does not belong to the group', async () => {
    const r = parse(base) as any;
    await expect(item.validate!(r.data, { prisma: prismaFor({ category: { id: uuid(3), groupId: uuid(98) } }) })).rejects.toThrow(/does not belong to the selected group/);
  });

  it('rejects min > max and duplicate units / multiple default suppliers', () => {
    expect(parse({ ...base, hasRateRange: true, minRate: '10', maxRate: '5' }).success).toBe(false);
    expect(parse({ ...base, unitConversions: [base.unitConversions[0], base.unitConversions[0]] }).success).toBe(false);
    const s = { supplierId: uuid(7), rate: '1', isDefault: true };
    expect(parse({ ...base, suppliers: [s, { ...s, supplierId: uuid(8) }] }).success).toBe(false);
  });

  it('clears min/max/avg when the item is not rate-range capable', () => {
    const out = item.normalize!({ ...base, hasRateRange: false, minRate: '1', maxRate: '2', avgRate: '1.5', suppliers: [] });
    expect([out.minRate, out.maxRate, out.avgRate]).toEqual([null, null, null]);
  });

  it('prevents incompatible generic unit conversions', async () => {
    const conv = cfg('conversions');
    const prisma: any = { unit: { findFirst: jest.fn().mockResolvedValueOnce({ id: 'a', unitType: 'LENGTH', symbol: 'm' }).mockResolvedValueOnce({ id: 'b', unitType: 'WEIGHT', symbol: 'kg' }) } };
    const data = { name: 'x', fromUnitId: uuid(1), toUnitId: uuid(2), conversionValue: '3.15', formulaType: 'FIXED_FACTOR', isActive: true };
    await expect(conv.validate!(data, { prisma })).rejects.toThrow(/Incompatible units/);
  });
});
