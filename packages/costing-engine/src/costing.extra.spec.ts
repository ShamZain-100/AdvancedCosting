import { calculateCosting, CostingInput, CostingInputError, calculateDealerPrice, applyMargin } from './costing';

/** Reference sheet (basic 4126.12, GST 18 % = 742.70, total 4868.82) with an extra % and company expenses. */
const sheet = (over: Partial<CostingInput> = {}): CostingInput => ({
  quantity: 1, gstPercent: 18, markupPercent: 10,
  groups: [
    { id: 'metal', categories: [{ id: 'frame', materials: [{ id: 'm1', quantity: '20.94', rate: '98' }, { id: 'm3', quantity: '4', rate: '4' }, { id: 'm4', quantity: '14', rate: '3' }] }], labour: [{ id: 'l1', quantity: 1, rate: 1200 }] },
    { id: 'powder', categories: [{ id: 'coat', materials: [{ id: 'm2', quantity: '0.8', rate: '270' }] }], labour: [{ id: 'l2', quantity: 1, rate: 600 }] },
  ],
  expenses: [],
  ...over,
});
const s = (v: { toString(): string }) => v.toString();

describe('extra percentage', () => {
  it('is added to the total cost before markup, and the markup is calculated on the uplifted cost', () => {
    const r = calculateCosting(sheet({ extraPercent: 5 }));
    expect(s(r.totalCostInclGst)).toBe('4868.82');
    expect(s(r.extraAmount)).toBe('243.44'); // 4868.82 x 5 % = 243.441
    expect(s(r.markupAmount)).toBe('511.23'); // (4868.82 + 243.44) x 10 % = 511.226
    expect(s(r.sellingPrice)).toBe('5623.49'); // 4868.82 + 243.44 + 511.23
  });

  it('with the markup based on basic cost, the extra is added to that base too', () => {
    const r = calculateCosting(sheet({ extraPercent: 5 }), { markupBase: 'BASIC_COST' });
    expect(s(r.markupAmount)).toBe('436.96'); // (4126.12 + 243.44) x 10 % = 436.956
    expect(s(r.sellingPrice)).toBe('5549.22'); // 4868.82 + 243.44 + 436.96
  });

  it('profit % is measured against the uplifted cost', () => {
    const r = calculateCosting(sheet({ extraPercent: 5 }));
    expect(s(r.profitAmount)).toBe('511.23');
    expect(s(r.profitPercent)).toBe('11.7'); // 511.23 / (4126.12 + 243.44) = 11.6998 %
  });

  it.each([[undefined], [null], ['' as unknown as string], [0], ['0']])('an extra of %j changes nothing', (extra) => {
    const r = calculateCosting(sheet({ extraPercent: extra as any }));
    expect(s(r.extraAmount)).toBe('0');
    expect(s(r.sellingPrice)).toBe('5355.7');
    expect(r.breakdown.map((b) => b.key)).not.toContain('extra');
  });

  it('is shown as its own breakdown line, between total cost and markup', () => {
    const keys = calculateCosting(sheet({ extraPercent: 5 })).breakdown.map((b) => b.key);
    expect(keys.slice(keys.indexOf('total'))).toEqual(['total', 'extra', 'markup', 'selling']);
  });

  it('must be between 0 and 100 and a number', () => {
    expect(() => calculateCosting(sheet({ extraPercent: -1 }))).toThrow(CostingInputError);
    expect(() => calculateCosting(sheet({ extraPercent: 101 }))).toThrow(/Extra %/);
    expect(() => calculateCosting(sheet({ extraPercent: 'abc' }))).toThrow(CostingInputError);
    expect(() => calculateCosting(sheet({ extraPercent: 100 }))).not.toThrow();
  });

  it('always reconciles exactly: selling = total + extra + markup (seeded random check)', () => {
    let seed = 12345;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let i = 0; i < 300; i++) {
      const input = sheet({ extraPercent: (rnd() * 40).toFixed(2), markupPercent: (rnd() * 60).toFixed(2), gstPercent: [0, 5, 12, 18][Math.floor(rnd() * 4)] });
      input.groups[0].categories[0].materials[0].quantity = (rnd() * 50).toFixed(3);
      for (const markupBase of ['TOTAL_COST', 'BASIC_COST'] as const) {
        const r = calculateCosting(input, { markupBase });
        expect(s(r.sellingPrice)).toBe(r.totalCostInclGst.plus(r.extraAmount).plus(r.markupAmount).toString());
        expect(r.extraAmount.isNegative()).toBe(false);
      }
    }
  });
});

describe('company expenses', () => {
  const fixed = (id: string, value: number, isCompany: boolean) => ({ id, method: 'FIXED' as const, value, timing: 'BEFORE_GST' as const, isCompany });

  it('are counted in the expenses and the cost, and also reported separately', () => {
    const r = calculateCosting(sheet({ expenses: [fixed('own', 50, false), fixed('rent', 100, true)] }));
    expect(s(r.expenseCost)).toBe('150');
    expect(s(r.companyExpenseCost)).toBe('100');
    expect(s(r.basicCost)).toBe('4276.12'); // 4126.12 + 150
  });

  it('a percentage company expense is taken on material + labour (product base)', () => {
    const r = calculateCosting(sheet({ expenses: [{ id: 'oh', method: 'PERCENTAGE', value: 10, timing: 'BEFORE_GST', isCompany: true }] }));
    // product base = material 2326.12 + labour 1800 = 4126.12; 10 % = 412.612
    expect(s(r.companyExpenseCost)).toBe('412.61');
    expect(s(r.basicCost)).toBe('4538.73');
  });

  it('an after-GST company expense is in the total but not in the GST base', () => {
    const r = calculateCosting(sheet({ expenses: [{ id: 'rent', method: 'FIXED', value: 100, timing: 'AFTER_GST', isCompany: true }] }));
    expect(s(r.companyExpenseCost)).toBe('100');
    expect(s(r.gstAmount)).toBe('742.7');
    expect(s(r.totalCostInclGst)).toBe('4968.82');
  });

  it('none flagged means zero', () => {
    expect(s(calculateCosting(sheet({ expenses: [fixed('own', 50, false)] })).companyExpenseCost)).toBe('0');
  });
});

describe('calculateDealerPrice', () => {
  // saved figures: basic 2110, total incl. GST 2489.80, extra 124.49, 2 pieces; markup on total cost (default rules)
  const c = { basicCost: '2110', totalCostInclGst: '2489.8', extraAmount: '124.49', quantity: '2' };

  it('adds the dealer margin like the costing markup and gives the price of one unit', () => {
    const r = calculateDealerPrice(c, '20');
    expect(r.markupAmount.toString()).toBe('522.86'); // (2489.80 + 124.49) x 20%
    expect(r.sellingPrice.toString()).toBe('3137.15'); // 2489.80 + 124.49 + 522.86
    expect(r.unitPrice.toString()).toBe('1568.58'); // 3137.15 / 2, rounded half up
  });

  it('matches the costing\'s own selling price when the margin equals its markup', () => {
    expect(calculateDealerPrice(c, '10').sellingPrice.toString()).toBe(applyMargin(c, '10').sellingPrice.toString());
  });

  it('a zero margin sells at cost plus extra, and a zero quantity counts as one', () => {
    expect(calculateDealerPrice(c, '0').sellingPrice.toString()).toBe('2614.29');
    expect(calculateDealerPrice({ ...c, quantity: '0' }, '0').unitPrice.toString()).toBe('2614.29');
  });

  it('refuses a negative margin', () => {
    expect(() => calculateDealerPrice(c, '-1')).toThrow(/negative/);
  });
});
