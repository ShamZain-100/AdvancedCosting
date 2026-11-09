import { calculateCosting, CostingInput, CostingInputError, assertValidCostingInput } from './costing';

const mat = (id: string, quantity: string | number, rate: string | number, extra: object = {}) => ({ id, quantity, rate, ...extra });
const build = (materials: any[], over: Partial<CostingInput> = {}): CostingInput => ({
  quantity: 1, gstPercent: 0, markupPercent: 0, expenses: [],
  groups: [{ id: 'g', labour: [], categories: [{ id: 'c', materials }] }], ...over,
});

describe('costing edge cases: empty and zero', () => {
  it('a costing with no rows is all zeros, not an error', () => {
    const r = calculateCosting({ quantity: 1, gstPercent: 18, markupPercent: 10, groups: [], expenses: [] });
    expect(r.basicCost.toString()).toBe('0');
    expect(r.sellingPrice.toString()).toBe('0');
  });

  it('zero quantity and zero rate give zero cost', () => {
    expect(calculateCosting(build([mat('a', 0, 100), mat('b', 5, 0)])).basicCost.toString()).toBe('0');
  });

  it('zero product quantity does not divide by zero in the per-unit figures', () => {
    expect(() => calculateCosting(build([mat('a', 1, 10)], { quantity: 0 }))).not.toThrow();
  });

  it('GST 0 and markup 0 leave the basic cost as the selling price', () => {
    expect(calculateCosting(build([mat('a', 3, 7)])).sellingPrice.toString()).toBe('21');
  });
});

describe('costing edge cases: decimal precision', () => {
  it('0.1 × 3 is exactly 0.3 (no binary floating point drift)', () => {
    expect(calculateCosting(build([mat('a', '0.1', 3)]), { decimals: 10 }).basicCost.toString()).toBe('0.3');
  });

  it('ten additions of 0.1 total exactly 1', () => {
    const materials = Array.from({ length: 10 }, (_, i) => mat(`m${i}`, '0.1', 1));
    expect(calculateCosting(build(materials)).basicCost.toString()).toBe('1');
  });

  it('very small quantities keep their value when the rule allows enough decimals', () => {
    const r = calculateCosting(build([mat('a', '0.000001', '1000000')]), { decimals: 6 });
    expect(r.basicCost.toString()).toBe('1');
  });

  it('very large amounts stay exact', () => {
    const r = calculateCosting(build([mat('a', '999999999.999', '999999999.99')]), { decimals: 2, roundLines: false });
    // 999999999.999 × 999999999.99 = 999999999989000000.00001 (exact), shown to 2 places
    expect(r.basicCost.toFixed(2)).toBe('999999999989000000.00');
    expect(r.basicCost.toString()).not.toMatch(/e\+/i);
  });

  it('accepts numeric strings and plain numbers alike; padded text is rejected (inputs are trimmed by the validators first)', () => {
    expect(calculateCosting(build([mat('a', '2', '3.50')])).basicCost.toString()).toBe('7');
    expect(calculateCosting(build([mat('a', 2, 3.5)])).basicCost.toString()).toBe('7');
    expect(() => calculateCosting(build([mat('a', ' 2 ', '3.50')]))).toThrow(CostingInputError);
  });
});

describe('costing edge cases: rounding rules', () => {
  const line = (rounding: any) => calculateCosting(build([mat('a', '1', '2.675')]), { rounding, decimals: 2 }).basicCost.toString();

  it('the four rounding modes disagree exactly where they should', () => {
    expect(line('HALF_UP')).toBe('2.68');
    expect(line('HALF_DOWN')).toBe('2.67');
    expect(line('UP')).toBe('2.68');
    expect(line('DOWN')).toBe('2.67');
  });

  it('rounding lines versus rounding only totals can differ by a rounding unit and never more', () => {
    const materials = Array.from({ length: 7 }, (_, i) => mat(`m${i}`, '1', '0.335'));
    const lines = calculateCosting(build(materials), { roundLines: true });
    const totals = calculateCosting(build(materials), { roundLines: false });
    expect(totals.basicCost.toString()).toBe('2.35');
    expect(lines.basicCost.minus(totals.basicCost).abs().lte('0.07')).toBe(true);
  });

  it('zero decimals rounds money to whole units', () => {
    expect(calculateCosting(build([mat('a', '1', '10.5')]), { decimals: 0 }).basicCost.toString()).toBe('11');
  });
});

describe('costing edge cases: GST inclusive rates', () => {
  it('a GST-inclusive material rate is converted to ex-GST at the item rate', () => {
    const r = calculateCosting(build([mat('a', 1, '118', { itemGstPercent: 18 })]), { materialRatesIncludeGst: true, gstMode: 'ITEM' });
    expect(r.basicCost.toString()).toBe('100');
  });

  it('a GST-inclusive rate at 0 % GST is unchanged', () => {
    const r = calculateCosting(build([mat('a', 1, '50', { itemGstPercent: 0 })]), { materialRatesIncludeGst: true, gstMode: 'ITEM' });
    expect(r.basicCost.toString()).toBe('50');
  });
});

describe('costing edge cases: wastage extremes', () => {
  it('100 % wastage doubles the quantity', () => {
    expect(calculateCosting(build([mat('a', 10, 1, { wastagePercent: 100 })])).basicCost.toString()).toBe('20');
  });

  it('wastage by quantity is added as given and ignores percentages', () => {
    const r = calculateCosting(build([mat('a', 10, 1, { wastageMode: 'QUANTITY', wastageQuantity: '2.5', wastagePercent: 50 })]));
    expect(r.basicCost.toString()).toBe('12.5');
  });

  it('an explicit item wastage of 0 overrides a non-zero group wastage', () => {
    const input = build([mat('a', 10, 1, { wastagePercent: 0 })]);
    input.groups[0].wastagePercent = 20;
    expect(calculateCosting(input).basicCost.toString()).toBe('10');
  });
});

describe('costing input validation', () => {
  const bad = (materials: any[], over: Partial<CostingInput> = {}) => () => assertValidCostingInput(build(materials, over));

  it.each([
    ['negative quantity', bad([mat('a', -1, 1)])],
    ['negative rate', bad([mat('a', 1, -1)])],
    ['not a number', bad([mat('a', 'abc', 1)])],
    ['empty string quantity', bad([mat('a', '', 1)])],
    ['infinity', bad([mat('a', 'Infinity', 1)])],
    ['wastage above 100', bad([mat('a', 1, 1, { wastagePercent: 101 })])],
    ['GST above 100', bad([mat('a', 1, 1)], { gstPercent: 101 })],
    ['negative markup', bad([mat('a', 1, 1)], { markupPercent: -5 })],
    ['duplicate material ids', bad([mat('a', 1, 1), mat('a', 2, 2)])],
    ['expense for an unknown group', bad([mat('a', 1, 1)], { expenses: [{ id: 'e', groupId: 'nope', method: 'FIXED', value: 1, timing: 'BEFORE_GST' }] })],
    ['percentage expense above 100', bad([mat('a', 1, 1)], { expenses: [{ id: 'e', method: 'PERCENTAGE', value: 150, timing: 'BEFORE_GST' }] })],
  ])('rejects %s', (_name, fn) => {
    expect(fn).toThrow(CostingInputError);
  });

  it('markup above 100 % is allowed (it is a markup, not a share)', () => {
    expect(bad([mat('a', 1, 1)], { markupPercent: 250 })).not.toThrow();
  });
});

describe('costing determinism', () => {
  it('the same input gives byte-identical results and does not mutate the input', () => {
    const input = build([mat('a', '3.333', '12.345', { wastagePercent: 4 })], { gstPercent: 18, markupPercent: 12.5 });
    const snapshot = JSON.stringify(input);
    const a = calculateCosting(input);
    const b = calculateCosting(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(a.sellingPrice.toString()).toBe(b.sellingPrice.toString());
    expect(a.totalCostInclGst.toString()).toBe(b.totalCostInclGst.toString());
  });

  it('row order does not change the totals', () => {
    const rows = [mat('a', '1.1', '2.2'), mat('b', '3.3', '4.4'), mat('c', '5.5', '6.6')];
    const fwd = calculateCosting(build(rows), { roundLines: false });
    const rev = calculateCosting(build([...rows].reverse()), { roundLines: false });
    expect(fwd.basicCost.toString()).toBe(rev.basicCost.toString());
  });
});
