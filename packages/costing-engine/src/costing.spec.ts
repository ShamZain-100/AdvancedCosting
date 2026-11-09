import { calculateCosting, CostingInput, resolveMaterialRate, resolveWastagePercent } from './costing';

/** Reference sheet lines: metal frame 20.94×98, black matt powder 0.8×270, bush 4×4, extra 14×3, metal labour 1200, powder labour 600. */
const reference = (over: Partial<CostingInput> = {}): CostingInput => ({
  quantity: 1, gstPercent: 0, markupPercent: 0, wastagePercent: null,
  groups: [
    { id: 'metal', categories: [{ id: 'frame', materials: [{ id: 'm1', quantity: '20.94', rate: '98' }, { id: 'm3', quantity: '4', rate: '4' }, { id: 'm4', quantity: '14', rate: '3' }] }], labour: [{ id: 'l1', quantity: 1, rate: 1200 }] },
    { id: 'powder', categories: [{ id: 'coat', materials: [{ id: 'm2', quantity: '0.8', rate: '270' }] }], labour: [{ id: 'l2', quantity: 1, rate: 600 }] },
  ],
  expenses: [],
  ...over,
});

describe('calculateCosting – reference sheet', () => {
  it('computes each line exactly', () => {
    const r = calculateCosting(reference());
    expect(r.materials.m1.total.toString()).toBe('2052.12');
    expect(r.materials.m2.total.toString()).toBe('216');
    expect(r.materials.m3.total.toString()).toBe('16');
    expect(r.materials.m4.total.toString()).toBe('42');
    expect(r.labour.l1.toString()).toBe('1200');
    expect(r.labour.l2.toString()).toBe('600');
  });

  it('totals material, labour and basic cost', () => {
    const r = calculateCosting(reference());
    expect(r.materialCost.toString()).toBe('2326.12');
    expect(r.labourCost.toString()).toBe('1800');
    expect(r.basicCost.toString()).toBe('4126.12');
    expect(r.gstAmount.toString()).toBe('0');
  });

  it('applies GST and markup on total cost by default', () => {
    const r = calculateCosting(reference({ gstPercent: 18, markupPercent: 10 }));
    expect(r.gstAmount.toString()).toBe('742.7'); // 4126.12 × 18%
    expect(r.totalCostInclGst.toString()).toBe('4868.82');
    expect(r.markupAmount.toString()).toBe('486.88');
    expect(r.sellingPrice.toString()).toBe('5355.7');
    expect(r.profitAmount.toString()).toBe('486.88');
  });

  it('can base markup on basic cost instead', () => {
    const r = calculateCosting(reference({ gstPercent: 18, markupPercent: 10 }), { markupBase: 'BASIC_COST' });
    expect(r.markupAmount.toString()).toBe('412.61');
    expect(r.sellingPrice.toString()).toBe('5281.43');
  });

  it('reports per-unit rates using the product quantity', () => {
    const r = calculateCosting(reference({ quantity: 4 }));
    expect(r.netBasicRate.toString()).toBe('1031.53');
  });
});

describe('wastage', () => {
  const one = (m: object, extra: Partial<CostingInput> = {}, cat = {}, grp = {}): CostingInput => ({
    quantity: 1, gstPercent: 0, markupPercent: 0, expenses: [], ...extra,
    groups: [{ id: 'g', ...grp, labour: [], categories: [{ id: 'c', ...cat, materials: [{ id: 'm', quantity: '100', rate: '10', ...m }] }] }],
  });

  it('most specific level wins and levels are never stacked', () => {
    expect(resolveWastagePercent({ item: '5', category: '3', group: '2', overall: '1' }, 'MOST_SPECIFIC').toString()).toBe('5');
    expect(resolveWastagePercent({ category: '3', group: '2', overall: '1' }, 'MOST_SPECIFIC').toString()).toBe('3');
    expect(resolveWastagePercent({ overall: '1' }, 'MOST_SPECIFIC').toString()).toBe('1');
    expect(resolveWastagePercent({}, 'MOST_SPECIFIC').toString()).toBe('0');
  });
  it('an explicit 0% at item level overrides inherited wastage', () => {
    expect(resolveWastagePercent({ item: '0', group: '5' }, 'MOST_SPECIFIC').toString()).toBe('0');
  });
  it('cumulative mode adds all defined levels', () => {
    expect(resolveWastagePercent({ item: '5', category: '3', group: '2', overall: '1' }, 'CUMULATIVE').toString()).toBe('11');
  });
  it('percentage wastage increases the effective quantity once', () => {
    const r = calculateCosting(one({}, { wastagePercent: 2 }, {}, { wastagePercent: 5 }));
    // group 5% wins over overall 2%
    expect(r.materials.m.effectiveQuantity.toString()).toBe('105');
    expect(r.materials.m.total.toString()).toBe('1050');
    expect(r.materialWastage.toString()).toBe('50');
  });
  it('quantity-based wastage is added as-is', () => {
    const r = calculateCosting(one({ wastageMode: 'QUANTITY', wastageQuantity: '2.5' }, { wastagePercent: 10 }));
    expect(r.materials.m.effectiveQuantity.toString()).toBe('102.5');
    expect(r.materials.m.appliedWastagePercent.toString()).toBe('0');
  });
});

describe('GST handling', () => {
  it('converts GST-inclusive rates to ex-GST so GST is never counted twice', () => {
    const input: CostingInput = { quantity: 1, gstPercent: 18, markupPercent: 0, expenses: [], groups: [{ id: 'g', labour: [], categories: [{ id: 'c', materials: [{ id: 'm', quantity: 1, rate: '118' }] }] }] };
    const r = calculateCosting(input, { materialRatesIncludeGst: true });
    expect(r.materialCost.toString()).toBe('100');
    expect(r.gstAmount.toString()).toBe('18');
    expect(r.totalCostInclGst.toString()).toBe('118');
  });
  it('uses item GST % on materials in ITEM mode', () => {
    const input: CostingInput = { quantity: 1, gstPercent: 5, markupPercent: 0, expenses: [], groups: [{ id: 'g', categories: [{ id: 'c', materials: [{ id: 'm', quantity: 1, rate: '100', itemGstPercent: 18 }] }], labour: [{ id: 'l', quantity: 1, rate: 100 }] }] };
    const r = calculateCosting(input, { gstMode: 'ITEM' });
    expect(r.gstAmount.toString()).toBe('23'); // 100×18% + 100×5%
  });
});

describe('expenses', () => {
  const base = (expenses: CostingInput['expenses']): CostingInput => ({ ...reference(), gstPercent: 10, expenses });
  it('supports fixed, percentage and quantity-based expenses', () => {
    const r = calculateCosting(base([
      { id: 'e1', method: 'FIXED', value: 100, timing: 'BEFORE_GST' },
      { id: 'e2', method: 'PERCENTAGE', value: 10, timing: 'BEFORE_GST' }, // 10% of 4126.12 = 412.61
      { id: 'e3', method: 'QUANTITY_BASED', value: 5, quantity: 3, timing: 'BEFORE_GST' },
    ]));
    expect(r.expenses.e2.amount.toString()).toBe('412.61');
    expect(r.expenses.e3.amount.toString()).toBe('15');
    expect(r.expenseCost.toString()).toBe('527.61');
  });
  it('group-scoped percentage uses only that group', () => {
    const r = calculateCosting(base([{ id: 'e', groupId: 'powder', method: 'PERCENTAGE', value: 10, timing: 'BEFORE_GST' }]));
    expect(r.expenses.e.amount.toString()).toBe('81.6'); // 10% of (216 + 600)
  });
  it('after-GST expenses are not taxed and not part of basic cost', () => {
    const r = calculateCosting(base([{ id: 'e', method: 'FIXED', value: 100, timing: 'AFTER_GST' }]));
    expect(r.basicCost.toString()).toBe('4126.12');
    expect(r.gstAmount.toString()).toBe('412.61');
    expect(r.totalCostInclGst.toString()).toBe('4638.73');
  });
});

describe('rounding', () => {
  it('rounds lines half-up by default and honours the configured mode and decimals', () => {
    const input: CostingInput = { quantity: 1, gstPercent: 0, markupPercent: 0, expenses: [], groups: [{ id: 'g', labour: [], categories: [{ id: 'c', materials: [{ id: 'm', quantity: '1', rate: '1.005' }] }] }] };
    expect(calculateCosting(input).materials.m.total.toString()).toBe('1.01');
    expect(calculateCosting(input, { rounding: 'DOWN' }).materials.m.total.toString()).toBe('1');
    expect(calculateCosting(input, { decimals: 3 }).materials.m.total.toString()).toBe('1.005');
  });
  it('avoids float error: 0.1 + 0.2 style sums', () => {
    const input: CostingInput = { quantity: 1, gstPercent: 0, markupPercent: 0, expenses: [], groups: [{ id: 'g', labour: [], categories: [{ id: 'c', materials: [{ id: 'a', quantity: 1, rate: '0.1' }, { id: 'b', quantity: 1, rate: '0.2' }] }] }] };
    expect(calculateCosting(input).materialCost.toString()).toBe('0.3');
  });
  it('handles an empty costing without NaN', () => {
    const r = calculateCosting({ quantity: 0, gstPercent: 18, markupPercent: 20, groups: [], expenses: [] });
    expect(r.sellingPrice.toString()).toBe('0');
    expect(r.profitPercent.toString()).toBe('0');
  });
});

describe('resolveMaterialRate', () => {
  const item = { baseUnitId: 'kg', defaultPurchaseRate: '98', hasRateRange: true, minRate: '90', maxRate: '110', avgRate: '100', suppliers: [{ supplierId: 's1', rate: '95' }] };
  it('picks the requested basis and scales to the row unit', () => {
    expect(resolveMaterialRate(item, 'STANDARD', 1).rate.toString()).toBe('98');
    expect(resolveMaterialRate(item, 'MIN', 1).rate.toString()).toBe('90');
    expect(resolveMaterialRate(item, 'AVERAGE', '3.15').rate.toString()).toBe('315'); // 100 per kg × 3.15 kg per metre
    expect(resolveMaterialRate(item, 'SUPPLIER', 1, { supplierId: 's1' }).rate.toString()).toBe('95');
  });
  it('falls back to the standard rate when the item has no range / supplier rate', () => {
    const plain = { ...item, hasRateRange: false };
    const r = resolveMaterialRate(plain, 'MAX', 1);
    expect(r).toMatchObject({ basis: 'STANDARD', fellBack: true });
    expect(r.rate.toString()).toBe('98');
    expect(resolveMaterialRate(item, 'SUPPLIER', 1, { supplierId: 'nope' }).fellBack).toBe(true);
  });
  it('uses the custom rate untouched', () => {
    expect(resolveMaterialRate(item, 'CUSTOM', '3.15', { customRate: '120' }).rate.toString()).toBe('120');
  });
});
