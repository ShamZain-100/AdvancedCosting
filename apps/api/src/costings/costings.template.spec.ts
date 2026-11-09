import { BadRequestException } from '@nestjs/common';
import { CostingsService } from './costings.service';
import { RateImpactService } from '../purchase-rates/rate-impact.service';
import { testSettings } from '../settings/test-helpers';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const D = (v: string | number) => ({ toString: () => String(v) });
const TYPE = u(1), GROUP = u(2), CAT = u(3), ITEM = u(4), KG = u(10), LAB = u(20), EXP = u(30);

/** A stored costing: 20.94 kg of an item at 98 with 5 % wastage, labour at 1200, a packing expense of 100. */
const stored = () => ({
  id: 'c1', costingNumber: 'COST-2026-0001', productName: 'Chair', productCode: null, typeId: TYPE, templateId: null, description: 'Steel chair', length: null, width: null, height: null, dimensionUnitId: null,
  quantity: D(1), unitId: null, costingDate: new Date('2026-02-01'), notes: null, wastagePercent: D(2), gstPercent: D(18), markupPercent: D(10), status: 'APPROVED', pricingMode: 'SNAPSHOT', version: 3,
  groups: [{
    groupId: GROUP, wastagePercent: null,
    categories: [{ categoryId: CAT, wastagePercent: null, materials: [{ itemId: ITEM, notes: 'frame', quantity: D('20.94'), unitId: KG, wastageMode: 'PERCENT', wastagePercent: D(5), wastageQuantity: null, rateBasis: 'STANDARD', supplierId: null, rate: D('98'), total: D('2052.12'), effectiveQuantity: D('21.987') }] }],
    labour: [{ labourId: LAB, quantity: D(1), unitId: null, customRate: true, rate: D('1200'), total: D('1200') }],
  }],
  expenses: [{ expenseId: EXP, costingGroup: null, calculationMethod: 'FIXED', value: D('100'), quantity: D(1), applyTiming: 'BEFORE_GST', overrideFields: [], amount: D('100') }],
});

function make() {
  const created = { id: 'tpl1' };
  const templates: any = { validateTree: jest.fn(), create: jest.fn().mockResolvedValue(created) };
  const images: any = { mainImages: async () => new Map(), copyLinks: jest.fn() };
  const db: any = { costing: { findFirst: jest.fn().mockResolvedValue(stored()) } };
  const svc = new CostingsService(db, { log: jest.fn() } as any, {} as any, templates, new RateImpactService(), images, testSettings().numbering, testSettings().appSettings);
  return { svc, templates, images, actor: { id: 'u1', permissions: new Set<string>() } as any };
}

describe('CostingsService.saveAsTemplate', () => {
  it('creates an active template with the costing structure and defaults', async () => {
    const { svc, templates, actor } = make();
    const r = await svc.saveAsTemplate(actor, 'c1', { name: 'Steel chair', code: 'CHAIR-STD' });
    expect(r).toEqual({ id: 'tpl1' });
    const body = templates.create.mock.calls[0][1];
    expect(body).toMatchObject({ name: 'Steel chair', code: 'CHAIR-STD', typeId: TYPE, status: 'ACTIVE', description: 'Steel chair', gstPercent: '18', markupPercent: '10', wastagePercent: '2' });
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].categories[0].items[0]).toMatchObject({ itemId: ITEM, quantity: '20.94', unitId: KG, wastagePercent: '5', notes: 'frame' });
    expect(body.groups[0].labour[0]).toMatchObject({ labourId: LAB, quantity: '1' });
    expect(body.expenses).toHaveLength(1);
    // an expense the user did not override follows the expense master, so the template keeps only the reference
    expect(body.expenses[0]).toMatchObject({ expenseId: EXP, calculationMethod: '', value: '' });
  });

  it('copies no prices: a template always picks up current rates when it is used', async () => {
    const { svc, templates, actor } = make();
    await svc.saveAsTemplate(actor, 'c1', { name: 'Steel chair', code: 'CHAIR-STD' });
    const body = templates.create.mock.calls[0][1];
    expect(body.groups[0].labour[0].rate).toBe('');
    const items = JSON.stringify(body.groups[0].categories);
    expect(items).not.toContain('98');
    expect(items).not.toContain('2052');
  });

  it('works from an approved (frozen) costing and leaves it untouched', async () => {
    const { svc, templates, actor } = make();
    await expect(svc.saveAsTemplate(actor, 'c1', { name: 'N', code: 'N1' })).resolves.toBeDefined();
    expect(templates.create).toHaveBeenCalledTimes(1);
  });

  it('carries the product photos over to the template', async () => {
    const { svc, images, actor } = make();
    await svc.saveAsTemplate(actor, 'c1', { name: 'N', code: 'N1' });
    expect(images.copyLinks).toHaveBeenCalledWith({ kind: 'costing', id: 'c1' }, { kind: 'template', id: 'tpl1' });
  });

  it.each([[{}], [{ name: '', code: 'X' }], [{ name: 'N', code: 'has space' }]])('rejects an invalid name or code %j', async (body) => {
    const { svc, templates, actor } = make();
    await expect(svc.saveAsTemplate(actor, 'c1', body)).rejects.toBeInstanceOf(BadRequestException);
    expect(templates.create).not.toHaveBeenCalled();
  });
});
