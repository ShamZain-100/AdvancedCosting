import { calculatePrice, PriceInput, PriceInputError, costForPricing } from './pricing';

/** Reference costing at 18% GST: basic 4126.12, GST 742.70, total 4868.82. */
const base = (over: Partial<PriceInput> = {}): PriceInput => ({
  basicCost: '4126.12', totalCostInclGst: '4868.82', gstPercent: 18, costBase: 'BASIC_COST', profitMethod: 'PERCENT', profitValue: 20, gstTreatment: 'EXCLUSIVE', ...over,
});
const s = (v: { toString(): string }) => v.toString();

describe('profit methods', () => {
  it('Method A: percentage profit on the basic cost', () => {
    const r = calculatePrice(base());
    expect(s(r.profitAmount)).toBe('825.22');
    expect(s(r.sellingPrice)).toBe('4951.34');
    expect(s(r.gstAmount)).toBe('891.24');
    expect(s(r.listPriceInclGst)).toBe('5842.58');
    expect(s(r.marginPercent)).toBe('16.67');
    expect(s(r.markupPercent)).toBe('20');
  });

  it('Method B: fixed profit amount', () => {
    const r = calculatePrice(base({ profitMethod: 'FIXED', profitValue: 500 }));
    expect(s(r.sellingPrice)).toBe('4626.12');
    expect(s(r.profitAmount)).toBe('500');
  });

  it('profit on total cost incl. GST, quoted inclusive, reproduces the costing selling price', () => {
    const r = calculatePrice(base({ costBase: 'TOTAL_COST', profitValue: 10, gstTreatment: 'INCLUSIVE' }));
    expect(s(r.sellingPrice)).toBe('5355.7');
    expect(s(r.listPriceExGst)).toBe('4538.73');
  });

  it('the cost base choice is independent of how the price is quoted', () => {
    // 20% on basic, quoted inclusive == 20% on basic then GST on top
    const incl = calculatePrice(base({ gstTreatment: 'INCLUSIVE' }));
    const excl = calculatePrice(base({ gstTreatment: 'EXCLUSIVE' }));
    // rounding happens at different points (quoted basis vs ex-GST), so allow one unit in the last place
    expect(incl.sellingPrice.minus(excl.listPriceInclGst).abs().lte(0.01)).toBe(true);
    expect(incl.listPriceExGst.minus(excl.listPriceExGst).abs().lte(0.01)).toBe(true);
  });

  it('zero profit sells at cost', () => {
    const r = calculatePrice(base({ profitValue: 0 }));
    expect(s(r.sellingPrice)).toBe('4126.12');
    expect(s(r.marginPercent)).toBe('0');
  });
});

describe('effective price in both bases', () => {
  it('converts the discounted price for display without caller maths', () => {
    const ex = calculatePrice(base({ discountPercent: 10 }));
    expect(s(ex.effectivePrice)).toBe('4456.21');
    expect(s(ex.effectiveExGst)).toBe('4456.21');
    expect(s(ex.effectiveInclGst)).toBe('5258.33');
    const incl = calculatePrice(base({ gstTreatment: 'INCLUSIVE', discountPercent: 10 }));
    expect(s(incl.effectiveInclGst)).toBe(s(incl.effectivePrice));
    expect(incl.effectiveExGst.times(1.18).minus(incl.effectiveInclGst).abs().lte(0.01)).toBe(true);
  });
});

describe('GST treatment', () => {
  it('NONE ignores GST completely', () => {
    const r = calculatePrice(base({ gstTreatment: 'NONE' }));
    expect(s(r.gstAmount)).toBe('0');
    expect(s(r.listPriceInclGst)).toBe(s(r.listPriceExGst));
  });
});

describe('caps, discounts and minimum price', () => {
  it('caps the list price at the maximum', () => {
    const r = calculatePrice(base({ maxPrice: 4500 }));
    expect(s(r.sellingPrice)).toBe('4500');
    expect(r.flags).toContain('MAX_APPLIED');
    expect(s(r.profitAmount)).toBe('373.88');
  });

  it('percentage discount reduces the effective price', () => {
    const r = calculatePrice(base({ discountPercent: 10 }));
    expect(s(r.discountAmount)).toBe('495.13');
    expect(s(r.effectivePrice)).toBe('4456.21');
    expect(s(r.effectiveProfit)).toBe('330.09');
  });

  it('fixed discount amount, never more than the list price', () => {
    expect(s(calculatePrice(base({ discountAmount: 100 })).effectivePrice)).toBe('4851.34');
    expect(s(calculatePrice(base({ discountAmount: 999999 })).effectivePrice)).toBe('0');
  });

  it('minimum price limits how far a discount can go', () => {
    const r = calculatePrice(base({ discountPercent: 50, minPrice: 4500 }));
    expect(s(r.effectivePrice)).toBe('4500');
    expect(s(r.discountAmount)).toBe('451.34');
    expect(r.flags).toContain('DISCOUNT_LIMITED');
  });

  it('minimum price raises a list price that is below it', () => {
    const r = calculatePrice(base({ profitValue: 0, minPrice: 5000 }));
    expect(s(r.effectivePrice)).toBe('5000');
    expect(r.flags).toContain('MIN_APPLIED');
  });

  it('flags prices below cost', () => {
    const r = calculatePrice(base({ discountPercent: 40 }));
    expect(r.flags).toContain('BELOW_COST');
    expect(r.effectiveProfit.isNegative()).toBe(true);
  });

  it('rounds the list price to the nearest step without breaking the cap', () => {
    expect(s(calculatePrice(base({ roundTo: 10 })).sellingPrice)).toBe('4950');
    expect(s(calculatePrice(base({ roundTo: 100, maxPrice: 4960 })).sellingPrice)).toBe('4960');
  });
});

describe('input validation', () => {
  it.each([
    ['negative cost', { basicCost: -1 }, /cannot be negative/],
    ['non-numeric profit', { profitValue: 'x' }, /not a number/],
    ['min above max', { minPrice: 10, maxPrice: 5 }, /cannot exceed maximum/],
    ['both discount kinds', { discountPercent: 5, discountAmount: 5 }, /either a discount percentage or a discount amount/],
    ['discount over 100%', { discountPercent: 150 }, /cannot exceed 100/],
    ['GST over 100', { gstPercent: 150 }, /cannot exceed 100/],
  ])('rejects %s', (_n, over, msg) => {
    expect(() => calculatePrice(base(over as Partial<PriceInput>))).toThrow(PriceInputError);
    expect(() => calculatePrice(base(over as Partial<PriceInput>))).toThrow(msg);
  });

  it('honours the configured decimals and rounding mode', () => {
    expect(s(calculatePrice(base(), { decimals: 0 }).sellingPrice)).toBe('4951');
    expect(s(calculatePrice(base(), { decimals: 0, rounding: 'UP' }).sellingPrice)).toBe('4952');
  });
});

describe('invariants', () => {
  it('ex-GST + GST = incl-GST and effective ≤ list for random inputs', () => {
    let seed = 42;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let i = 0; i < 300; i++) {
      const basic = (rnd() * 20000).toFixed(2);
      const gst = [0, 5, 12, 18][Math.floor(rnd() * 4)];
      const r = calculatePrice({
        basicCost: basic, totalCostInclGst: (Number(basic) * (1 + gst / 100)).toFixed(2), gstPercent: gst,
        costBase: rnd() < 0.5 ? 'BASIC_COST' : 'TOTAL_COST', profitMethod: rnd() < 0.5 ? 'PERCENT' : 'FIXED', profitValue: (rnd() * 60).toFixed(2),
        gstTreatment: (['EXCLUSIVE', 'INCLUSIVE', 'NONE'] as const)[Math.floor(rnd() * 3)], discountPercent: rnd() < 0.5 ? (rnd() * 30).toFixed(1) : null,
      });
      expect(r.listPriceExGst.plus(r.gstAmount).minus(r.listPriceInclGst).abs().lte(0.01)).toBe(true);
      expect(r.effectivePrice.lte(r.sellingPrice)).toBe(true);
      expect(r.effectivePrice.isNegative()).toBe(false);
    }
  });
});

describe('costForPricing', () => {
  // basic 1000 + GST 180 + after-GST expense 100 = total 1280; extra 5% = 64; 2 pieces
  const c = { basicCost: '1000', totalCostInclGst: '1280', gstAmount: '180', extraAmount: '64', quantity: '2' };

  it('gives the cost of one unit, with the extra and after-GST expenses carried net of GST', () => {
    const r = costForPricing(c, '18');
    expect(r.basicCost.toString()).toBe('569.491525'); // (1000 + 164 / 1.18) / 2
    expect(r.totalCostInclGst.toString()).toBe('672'); // (1280 + 64) / 2
  });

  it('adding GST back recovers exactly what the costing spent', () => {
    const r = calculatePrice({ ...costForPricing(c, '18'), gstPercent: '18', costBase: 'BASIC_COST', profitMethod: 'PERCENT', profitValue: '0', gstTreatment: 'EXCLUSIVE' });
    expect(r.listPriceInclGst.toString()).toBe('672');
  });

  it('changes nothing when a costing has no extra and no after-GST expense', () => {
    const r = costForPricing({ basicCost: '4126.12', totalCostInclGst: '4868.82', gstAmount: '742.70', extraAmount: '0', quantity: '1' }, '18');
    expect(r.basicCost.toString()).toBe('4126.12');
    expect(r.totalCostInclGst.toString()).toBe('4868.82');
  });

  it('adds them as they stand when no GST applies', () => {
    expect(costForPricing(c, '18', false).basicCost.toString()).toBe('582'); // (1000 + 164) / 2
  });

  it('flags a price below the true cost, not just below basic cost', () => {
    const r = calculatePrice({ ...costForPricing(c, '18'), gstPercent: '18', costBase: 'BASIC_COST', profitMethod: 'FIXED', profitValue: '0', gstTreatment: 'EXCLUSIVE', maxPrice: '520' });
    expect(r.flags).toContain('BELOW_COST'); // 520 is above basic per unit (500) but below the true 569.49
  });

  it('treats a zero quantity as one', () => {
    expect(costForPricing({ ...c, extraAmount: '0', totalCostInclGst: '1180', quantity: '0' }, '18').basicCost.toString()).toBe('1000');
  });
});
