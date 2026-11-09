import { calculateCosting, CostingInput } from './costing';
import { calculatePrice } from './pricing';
import { calculateQuotation } from './quotation';

/**
 * The business chain end to end, on the reference sheet:
 * material and labour rates → costing → price list price → quotation.
 * Each step consumes only the previous step's stored output, the way the documents do.
 */
const sheet = (itemRate: string, labourRate = 1200): CostingInput => ({
  quantity: 1, gstPercent: 18, markupPercent: 10,
  groups: [
    { id: 'metal', categories: [{ id: 'frame', materials: [{ id: 'm1', quantity: '20.94', rate: itemRate }, { id: 'm3', quantity: '4', rate: '4' }] }], labour: [{ id: 'l1', quantity: 1, rate: labourRate }] },
    { id: 'powder', categories: [{ id: 'coat', materials: [{ id: 'm2', quantity: '0.8', rate: '270' }] }], labour: [{ id: 'l2', quantity: 1, rate: 600 }] },
  ],
  expenses: [{ id: 'pack', method: 'FIXED', value: 100, timing: 'BEFORE_GST' }],
});

const priceFrom = (c: ReturnType<typeof calculateCosting>, over: object = {}) => calculatePrice({
  basicCost: c.basicCost, totalCostInclGst: c.totalCostInclGst, gstPercent: 18,
  costBase: 'BASIC_COST', profitMethod: 'PERCENT', profitValue: 25, gstTreatment: 'EXCLUSIVE', ...over,
});

describe('costing → price → quotation', () => {
  const costing = calculateCosting(sheet('98'));
  const price = priceFrom(costing);

  it('profit is added to the stored basic cost and GST is on top', () => {
    expect(price.costBaseAmount.toString()).toBe(costing.basicCost.toString());
    expect(price.profitAmount.toString()).toBe(costing.basicCost.times('0.25').toDecimalPlaces(2).toString());
    expect(price.listPriceExGst.toString()).toBe(costing.basicCost.plus(price.profitAmount).toString());
    expect(price.listPriceInclGst.minus(price.listPriceExGst).toString()).toBe(price.gstAmount.toString());
  });

  it('a quotation line at the list price reconciles to the penny', () => {
    const q = calculateQuotation({ lines: [{ quantity: 3, unitPrice: price.listPriceExGst, gstPercent: 18 }, { quantity: 1, unitPrice: '500', gstPercent: 18 }] });
    const sumLines = q.lines.reduce((a, l) => a.plus(l.total), q.subtotal.minus(q.subtotal));
    expect(q.grandTotal.toString()).toBe(sumLines.plus(q.roundOff).toString());
    expect(q.taxableAmount.plus(q.gstAmount).plus(q.roundOff).toString()).toBe(q.grandTotal.toString());
    expect(q.gstBreakdown.reduce((a, g) => a.plus(g.gst), sumLines.minus(sumLines)).toString()).toBe(q.gstAmount.toString());
  });

  it('selling a quotation at the price list price earns the planned margin', () => {
    expect(price.marginPercent.toDecimalPlaces(2).toString()).toBe('20');
    expect(price.markupPercent.toDecimalPlaces(2).toString()).toBe('25');
  });
});

describe('a rate change flows downstream; frozen documents do not move', () => {
  const approved = calculateCosting(sheet('98'));
  const approvedPrice = priceFrom(approved);
  const frozen = JSON.stringify({ approved, approvedPrice });

  const live = calculateCosting(sheet('120'));
  const livePrice = priceFrom(live);

  it('a dearer item raises cost, price and the quotation total', () => {
    expect(live.basicCost.gt(approved.basicCost)).toBe(true);
    expect(livePrice.listPriceExGst.gt(approvedPrice.listPriceExGst)).toBe(true);
    const total = (p: typeof approvedPrice) => calculateQuotation({ lines: [{ quantity: 2, unitPrice: p.listPriceExGst, gstPercent: 18 }] }).grandTotal;
    expect(total(livePrice).gt(total(approvedPrice))).toBe(true);
  });

  it('the cost increase equals exactly quantity × the rate difference (22 × 20.94)', () => {
    expect(live.basicCost.minus(approved.basicCost).toString()).toBe('460.68');
  });

  it('recalculating never alters the approved figures', () => {
    expect(JSON.stringify({ approved, approvedPrice })).toBe(frozen);
    expect(calculateCosting(sheet('98')).sellingPrice.toString()).toBe(approved.sellingPrice.toString());
  });

  it('a labour change moves the cost by exactly the difference', () => {
    expect(calculateCosting(sheet('98', 1500)).basicCost.minus(approved.basicCost).toString()).toBe('300');
  });
});

describe('price list guard rails in the chain', () => {
  const c = calculateCosting(sheet('98'));

  it('a minimum price holds even when a big discount is given', () => {
    const p = priceFrom(c, { discountPercent: 90, minPrice: c.basicCost.plus(50) });
    expect(p.effectivePrice.gte(c.basicCost.plus(50))).toBe(true);
    expect(p.flags).toContain('DISCOUNT_LIMITED');
  });

  it('selling under cost is flagged', () => {
    const p = priceFrom(c, { profitValue: 0, discountPercent: 20 });
    expect(p.flags).toContain('BELOW_COST');
  });

  it('GST-inclusive quoting returns the same money both ways', () => {
    const ex = priceFrom(c);
    const inc = priceFrom(c, { gstTreatment: 'INCLUSIVE' });
    expect(inc.effectiveExGst.toString()).toBe(ex.effectiveExGst.toString());
    expect(inc.effectiveInclGst.toString()).toBe(ex.effectiveInclGst.toString());
  });
});
