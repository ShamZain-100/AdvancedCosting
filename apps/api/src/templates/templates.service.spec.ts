import { BadRequestException, NotFoundException } from '@nestjs/common';
import { templateSchema } from '@costing/validators';
import { TemplatesService } from './templates.service';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TYPE = u(1), GROUP = u(2), CAT = u(3), ITEM = u(4), KG = u(10), M = u(11), PC = u(12), LAB = u(20), EXP = u(30);

const unitKg = { id: KG, symbol: 'KG', unitType: 'WEIGHT', baseFactor: null };
const unitM = { id: M, symbol: 'M', unitType: 'LENGTH', baseFactor: null };
const unitPc = { id: PC, symbol: 'PC', unitType: 'COUNT', baseFactor: null };

const valid = () => ({
  name: 'Metal Chair General', code: 'MCG', typeId: TYPE, wastagePercent: '2', gstPercent: '18', markupPercent: '25',
  groups: [{
    groupId: GROUP, wastagePercent: '3',
    categories: [{ categoryId: CAT, items: [{ itemId: ITEM, quantity: '20.94', unitId: KG }] }],
    labour: [{ labourId: LAB, quantity: '1' }],
  }],
  expenses: [{ expenseId: EXP, groupId: GROUP }, { expenseId: EXP }],
});

function make(over: Record<string, any> = {}) {
  const db: any = {
    type: { findFirst: jest.fn().mockResolvedValue({ id: TYPE }) },
    itemGroup: { findMany: jest.fn().mockResolvedValue([{ id: GROUP, name: 'Metal', typeId: over.groupType ?? TYPE }]) },
    itemCategory: { findMany: jest.fn().mockResolvedValue([{ id: CAT, name: 'Frame', groupId: over.catGroup ?? GROUP }]) },
    item: { findMany: jest.fn().mockResolvedValue([{ id: ITEM, name: 'Metal Pipe MAX', categoryId: over.itemCat ?? CAT, unitId: KG, unit: unitKg, unitConversions: [{ unitId: M, unit: unitM, conversionValue: '3.15' }] }]) },
    labour: { findMany: jest.fn().mockResolvedValue([{ id: LAB }]) },
    expense: { findMany: jest.fn().mockResolvedValue([{ id: EXP }]) },
    areaConversion: { findMany: jest.fn().mockResolvedValue([]) },
    unit: { findMany: jest.fn().mockResolvedValue([unitKg, unitM, unitPc]) },
  };
  return { svc: new TemplatesService(db, { log: jest.fn() } as any), db };
}
const parsed = (v: unknown) => { const r = templateSchema.safeParse(v); if (!r.success) throw new Error(JSON.stringify(r.error.issues)); return r.data; };

describe('templateSchema', () => {
  it('accepts a full template and defaults blank optionals', () => {
    const t = parsed({ ...valid(), description: '' });
    expect(t.description).toBeUndefined();
    expect(t.groups[0].categories[0].items[0].wastagePercent).toBeUndefined();
  });
  it('rejects duplicate groups / categories / items', () => {
    const v = valid();
    expect(templateSchema.safeParse({ ...v, groups: [v.groups[0], v.groups[0]] }).success).toBe(false);
    const c = v.groups[0].categories[0];
    expect(templateSchema.safeParse({ ...v, groups: [{ ...v.groups[0], categories: [c, c] }] }).success).toBe(false);
    expect(templateSchema.safeParse({ ...v, groups: [{ ...v.groups[0], categories: [{ ...c, items: [c.items[0], c.items[0]] }] }] }).success).toBe(false);
  });
  it('rejects wastage > 100, non-positive quantity and expenses for groups outside the template', () => {
    const v = valid();
    expect(templateSchema.safeParse({ ...v, wastagePercent: '101' }).success).toBe(false);
    expect(templateSchema.safeParse({ ...v, groups: [{ ...v.groups[0], categories: [{ categoryId: CAT, items: [{ itemId: ITEM, quantity: '0', unitId: KG }] }] }] }).success).toBe(false);
    expect(templateSchema.safeParse({ ...v, expenses: [{ expenseId: EXP, groupId: u(99) }] }).success).toBe(false);
  });
  it('allows markup above 100%', () => {
    expect(templateSchema.safeParse({ ...valid(), markupPercent: '150' }).success).toBe(true);
  });
});

describe('TemplatesService.validateTree', () => {
  it('accepts a consistent hierarchy with a convertible unit', async () => {
    const { svc, db } = make();
    const t = parsed(valid());
    t.groups[0].categories[0].items[0].unitId = M; // metre → kg via item conversion
    await expect(svc.validateTree(db, t)).resolves.toBeUndefined();
  });
  it('rejects a group from another type', async () => {
    const { svc, db } = make({ groupType: u(99) });
    await expect(svc.validateTree(db, parsed(valid()))).rejects.toThrow(/does not belong to the template's type/);
  });
  it('rejects a category from another group', async () => {
    const { svc, db } = make({ catGroup: u(98) });
    await expect(svc.validateTree(db, parsed(valid()))).rejects.toThrow(/does not belong to group/);
  });
  it('rejects an item that is not in the chosen category', async () => {
    const { svc, db } = make({ itemCat: u(97) });
    await expect(svc.validateTree(db, parsed(valid()))).rejects.toThrow(/does not belong to category/);
  });
  it('rejects a unit that cannot convert to the item base unit', async () => {
    const { svc, db } = make();
    const t = parsed(valid());
    t.groups[0].categories[0].items[0].unitId = PC;
    await expect(svc.validateTree(db, t)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TemplatesService persistence', () => {
  function persistent(version = 1, status = 'ACTIVE') {
    const { svc, db } = make();
    const tx: any = {
      template: { create: jest.fn().mockResolvedValue({ id: 't1' }), update: jest.fn(), findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'x', code: 'x', typeId: TYPE, description: null, wastagePercent: 0, gstPercent: 0, markupPercent: 0, status: 'ACTIVE', groups: [], expenses: [] }) },
      templateGroup: { create: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: 'tg1', groupId: GROUP }]) },
      templateExpense: { createMany: jest.fn(), deleteMany: jest.fn() },
      templateVersion: { create: jest.fn() },
    };
    Object.assign(db, {
      template: { findFirst: jest.fn().mockResolvedValue({ id: 't1', code: 'MCG', name: 'N', version, status }), ...tx.template },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    });
    jest.spyOn(svc, 'get').mockResolvedValue({ id: 't1' } as any);
    return { svc, tx, db };
  }
  const actor: any = { id: 'u1' };

  it('create stores version 1 snapshot and links group-scoped expenses to their template group', async () => {
    const { svc, tx } = persistent();
    await svc.create(actor, valid());
    expect(tx.templateVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ templateId: 't1', version: 1 }) });
    const rows = tx.templateExpense.createMany.mock.calls[0][0].data;
    expect(rows[0].templateGroupId).toBe('tg1');
    expect(rows[1].templateGroupId).toBeNull();
  });

  it('update replaces the tree and bumps the version with a new snapshot', async () => {
    const { svc, tx } = persistent(3);
    await svc.update(actor, 't1', valid());
    expect(tx.templateGroup.deleteMany).toHaveBeenCalledWith({ where: { templateId: 't1' } });
    expect(tx.template.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 4 }) }));
    expect(tx.templateVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ version: 4 }) });
  });

  it('refuses to edit an archived template', async () => {
    const { svc } = persistent(1, 'ARCHIVED');
    await expect(svc.update(actor, 't1', valid())).rejects.toThrow(/read-only/);
  });

  it('returns 404 for a missing template', async () => {
    const { svc, db } = make();
    db.template = { findFirst: jest.fn().mockResolvedValue(null) };
    await expect(svc.update(actor, u(5), valid())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('soft deletes and frees the code', async () => {
    const { svc, db } = persistent();
    await svc.remove(actor, 't1');
    expect(db.template.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: expect.objectContaining({ status: 'ARCHIVED', code: expect.stringMatching(/^MCG~deleted~/), deletedAt: expect.any(Date) }) });
  });
});
