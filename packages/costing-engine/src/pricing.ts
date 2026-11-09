import { Decimal, d, Numeric } from './money';
import { CalcRules, DEFAULT_RULES } from './costing';

export type ProfitMethod = 'PERCENT' | 'FIXED';
/** Which cost the profit is added to: cost before GST, or cost including GST. */
export type PriceCostBase = 'BASIC_COST' | 'TOTAL_COST';
/**
 * How the headline price is quoted:
 * EXCLUSIVE – price excludes GST (GST is added on the invoice)
 * INCLUSIVE – price includes GST
 * NONE      – GST is not applicable; the price is quoted as is
 */
export type GstTreatment = 'EXCLUSIVE' | 'INCLUSIVE' | 'NONE';

export interface PriceInput {
  /** cost before GST taken from the approved costing */
  basicCost: Numeric;
  /** cost including GST taken from the approved costing */
  totalCostInclGst: Numeric;
  /** GST % used to move between ex-GST and incl-GST prices */
  gstPercent: Numeric;
  costBase: PriceCostBase;
  profitMethod: ProfitMethod;
  /** percent (PERCENT) or amount (FIXED) */
  profitValue: Numeric;
  gstTreatment: GstTreatment;
  /** list price is capped here (before discount) */
  maxPrice?: Numeric | null;
  /** the price the customer pays never goes below this, even after discount */
  minPrice?: Numeric | null;
  discountPercent?: Numeric | null;
  discountAmount?: Numeric | null;
  /** round the list price to the nearest multiple of this (e.g. 5 or 10) */
  roundTo?: Numeric | null;
}

export interface PriceResult {
  costBaseAmount: Decimal;
  profitAmount: Decimal;
  listPriceExGst: Decimal;
  gstAmount: Decimal;
  listPriceInclGst: Decimal;
  /** list price in the quoted basis (per gstTreatment), after cap and rounding, before discount */
  sellingPrice: Decimal;
  discountAmount: Decimal;
  /** what the customer pays in the quoted basis, after discount and minimum price */
  effectivePrice: Decimal;
  /** effective price expressed both ways, so callers never convert GST themselves */
  effectiveExGst: Decimal;
  effectiveInclGst: Decimal;
  /** profit actually earned on the effective price, against the cost in the same basis */
  effectiveProfit: Decimal;
  /** effectiveProfit / effectivePrice × 100 */
  marginPercent: Decimal;
  /** effectiveProfit / cost × 100 */
  markupPercent: Decimal;
  flags: ('MAX_APPLIED' | 'MIN_APPLIED' | 'DISCOUNT_LIMITED' | 'BELOW_COST')[];
}

export class PriceInputError extends Error {}

const R = { HALF_UP: Decimal.ROUND_HALF_UP, HALF_DOWN: Decimal.ROUND_HALF_DOWN, UP: Decimal.ROUND_UP, DOWN: Decimal.ROUND_DOWN } as const;
const set = (v: Numeric | null | undefined): v is Numeric => v !== null && v !== undefined && v !== '';
function nonNeg(label: string, v: Numeric): Decimal {
  let x: Decimal;
  try { x = d(v); } catch { throw new PriceInputError(`${label} is not a number`); }
  if (!x.isFinite()) throw new PriceInputError(`${label} is not a finite number`);
  if (x.isNegative()) throw new PriceInputError(`${label} cannot be negative`);
  return x;
}

/**
 * Selling price from an approved costing plus configured profit.
 *   list price  = cost base + profit            (profit = base × % or a fixed amount)
 *   list price  = min(list price, maxPrice)     (cap), rounded to `roundTo` if given
 *   effective   = list price − discount         (never below minPrice, never below 0)
 * Works in ex-GST terms internally so the cost base can be either cost before or including GST.
 */
export function calculatePrice(input: PriceInput, partialRules: Partial<CalcRules> = {}): PriceResult {
  const rules = { ...DEFAULT_RULES, ...partialRules };
  const mode = R[rules.rounding];
  const rnd = (v: Decimal) => v.toDecimalPlaces(rules.decimals, mode);
  const gstPct = input.gstTreatment === 'NONE' ? d(0) : nonNeg('GST %', input.gstPercent);
  if (gstPct.gt(100)) throw new PriceInputError('GST % cannot exceed 100');
  const factor = d(1).plus(gstPct.div(100));

  const basic = nonNeg('Basic cost', input.basicCost);
  const total = input.gstTreatment === 'NONE' ? basic : nonNeg('Total cost', input.totalCostInclGst);
  const base = input.costBase === 'BASIC_COST' ? basic : total;
  const value = nonNeg('Profit value', input.profitValue);
  if (input.profitMethod === 'PERCENT' && value.gt(1000)) throw new PriceInputError('Profit % is unrealistically large');
  const min = set(input.minPrice) ? nonNeg('Minimum price', input.minPrice) : null;
  const max = set(input.maxPrice) ? nonNeg('Maximum price', input.maxPrice) : null;
  if (min && max && min.gt(max)) throw new PriceInputError('Minimum price cannot exceed maximum price');
  if (set(input.discountPercent) && set(input.discountAmount)) throw new PriceInputError('Use either a discount percentage or a discount amount, not both');
  const discPct = set(input.discountPercent) ? nonNeg('Discount %', input.discountPercent) : null;
  if (discPct && discPct.gt(100)) throw new PriceInputError('Discount % cannot exceed 100');
  const discAmt = set(input.discountAmount) ? nonNeg('Discount amount', input.discountAmount) : null;
  const step = set(input.roundTo) ? nonNeg('Round to', input.roundTo) : null;

  // everything below is expressed in the quoted basis (incl-GST for INCLUSIVE, otherwise ex-GST)
  const inclusive = input.gstTreatment === 'INCLUSIVE';
  const baseInBasis = (() => {
    const baseIsIncl = input.costBase === 'TOTAL_COST';
    if (baseIsIncl === inclusive) return base;
    return baseIsIncl ? base.div(factor) : base.times(factor);
  })();
  // a % profit scales with the quoted basis (20% on cost = 20% on cost-plus-GST); a fixed profit is an amount in the quoted basis
  const profitInBasis = input.profitMethod === 'PERCENT' ? baseInBasis.times(value).div(100) : value;

  const flags: PriceResult['flags'] = [];
  let list = baseInBasis.plus(profitInBasis);
  if (max && list.gt(max)) { list = max; flags.push('MAX_APPLIED'); }
  if (step && step.gt(0)) {
    list = list.div(step).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(step);
    if (max && list.gt(max)) list = max; // rounding must not break the cap
  }
  list = rnd(list);

  let discount = discPct ? list.times(discPct).div(100) : (discAmt ?? d(0));
  if (discount.gt(list)) discount = list;
  discount = rnd(discount);
  let effective = list.minus(discount);
  if (min && effective.lt(min)) {
    effective = min;
    discount = rnd(list.minus(min).lt(0) ? d(0) : list.minus(min));
    flags.push(discount.isZero() && list.lt(min) ? 'MIN_APPLIED' : 'DISCOUNT_LIMITED');
  }
  effective = rnd(effective);

  const costInBasis = rnd(inclusive ? (input.costBase === 'TOTAL_COST' ? base : base.times(factor)) : (input.costBase === 'BASIC_COST' ? base : base.div(factor)));
  const effectiveProfit = rnd(effective.minus(costInBasis));
  if (effective.lt(costInBasis)) flags.push('BELOW_COST');

  const exGst = inclusive ? list.div(factor) : list;
  const listEx = rnd(exGst);
  const listIncl = rnd(inclusive ? list : list.times(factor));
  const pct = (n: Decimal, dn: Decimal) => (dn.isZero() ? d(0) : n.div(dn).times(100).toDecimalPlaces(2, mode));

  return {
    costBaseAmount: rnd(base),
    profitAmount: rnd(list.minus(baseInBasis)),
    listPriceExGst: listEx,
    gstAmount: rnd(listIncl.minus(listEx)),
    listPriceInclGst: listIncl,
    sellingPrice: list,
    discountAmount: discount,
    effectivePrice: effective,
    effectiveExGst: rnd(inclusive ? effective.div(factor) : effective),
    effectiveInclGst: rnd(inclusive ? effective : effective.times(factor)),
    effectiveProfit,
    marginPercent: pct(effectiveProfit, effective),
    markupPercent: pct(effectiveProfit, costInBasis),
    flags,
  };
}

/** The stored figures of a costing that a selling price is built on. */
export interface CostingPriceFigures { basicCost: Numeric; totalCostInclGst: Numeric; gstAmount: Numeric; extraAmount: Numeric; quantity: Numeric }

/**
 * The cost of ONE unit of a costing's product, ready for `calculatePrice`. The one place price lists and quotations read a
 * costing's cost, so neither can leave anything out.
 * Basic cost alone misses the extra % and the after-GST expenses. Both are costs the business really carries but neither takes
 * GST on the costing, so they are carried into the ex-GST figure net of GST: once GST is added back to a price, the amount
 * recovered is exactly what the costing spent. When a list has no GST at all, they are added as they stand.
 */
export function costForPricing(c: CostingPriceFigures, gstPercent: Numeric, gstApplies = true): { basicCost: Decimal; totalCostInclGst: Decimal } {
  const qty = d(c.quantity).lte(0) ? d(1) : d(c.quantity);
  const basic = d(c.basicCost), total = d(c.totalCostInclGst), extra = d(c.extraAmount);
  const untaxed = extra.plus(total.minus(basic).minus(d(c.gstAmount)));
  const factor = gstApplies ? d(1).plus(d(gstPercent).div(100)) : d(1);
  const perUnit = (v: Decimal) => v.div(qty).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  return { basicCost: perUnit(basic.plus(untaxed.div(factor))), totalCostInclGst: perUnit(total.plus(extra)) };
}
