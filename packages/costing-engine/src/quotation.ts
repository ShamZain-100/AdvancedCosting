import { Decimal, d, Numeric } from './money';
import { CalcRules, DEFAULT_RULES } from './costing';

export interface QuotationLineInput {
  quantity: Numeric;
  /** price per unit, excluding GST */
  unitPrice: Numeric;
  discountPercent?: Numeric | null;
  /** fixed discount on the whole line (used when no percentage is given) */
  discountAmount?: Numeric | null;
  gstPercent: Numeric;
}

export interface QuotationInput {
  lines: QuotationLineInput[];
  /** extra discount on the whole quotation, spread over the lines in proportion to their value */
  discountPercent?: Numeric | null;
  discountAmount?: Numeric | null;
  /** round the grand total to a whole number and show the round-off */
  roundGrandTotal?: boolean;
}

export interface QuotationLineResult {
  gross: Decimal;
  lineDiscount: Decimal;
  /** after the line discount, before the quotation-level discount */
  taxable: Decimal;
  headerDiscountShare: Decimal;
  /** value GST is charged on */
  taxableNet: Decimal;
  gstPercent: Decimal;
  gstAmount: Decimal;
  total: Decimal;
}

export interface QuotationResult {
  lines: QuotationLineResult[];
  subtotal: Decimal;
  lineDiscountTotal: Decimal;
  headerDiscount: Decimal;
  taxableAmount: Decimal;
  gstAmount: Decimal;
  gstBreakdown: { percent: Decimal; taxable: Decimal; gst: Decimal }[];
  roundOff: Decimal;
  grandTotal: Decimal;
}

export class QuotationInputError extends Error {}

const R = { HALF_UP: Decimal.ROUND_HALF_UP, HALF_DOWN: Decimal.ROUND_HALF_DOWN, UP: Decimal.ROUND_UP, DOWN: Decimal.ROUND_DOWN } as const;
const isSet = (v: Numeric | null | undefined): v is Numeric => v !== null && v !== undefined && v !== '';

function nonNeg(label: string, v: Numeric): Decimal {
  let x: Decimal;
  try { x = d(v); } catch { throw new QuotationInputError(`${label} is not a number`); }
  if (!x.isFinite()) throw new QuotationInputError(`${label} is not a finite number`);
  if (x.isNegative()) throw new QuotationInputError(`${label} cannot be negative`);
  return x;
}

/**
 * Quotation totals. Every line amount is rounded to the configured decimals and the totals are sums of those
 * rounded amounts, so a printed quotation always adds up exactly.
 *   gross      = quantity × unit price
 *   taxable    = gross − line discount
 *   taxableNet = taxable − its share of the quotation-level discount (shares add up to the discount exactly)
 *   GST        = taxableNet × GST % of that line
 */
export function calculateQuotation(input: QuotationInput, partialRules: Partial<CalcRules> = {}): QuotationResult {
  const rules = { ...DEFAULT_RULES, ...partialRules };
  const places = rules.decimals;
  const mode = R[rules.rounding];
  const rnd = (v: Decimal) => v.toDecimalPlaces(places, mode);
  const unit = d(1).div(d(10).pow(places));

  const draft = input.lines.map((l, i) => {
    const n = `Line ${i + 1}`;
    const qty = nonNeg(`${n} quantity`, l.quantity);
    const price = nonNeg(`${n} unit price`, l.unitPrice);
    const gstPercent = nonNeg(`${n} GST %`, l.gstPercent);
    if (gstPercent.gt(100)) throw new QuotationInputError(`${n} GST % cannot exceed 100`);
    if (isSet(l.discountPercent) && isSet(l.discountAmount)) throw new QuotationInputError(`${n}: use a discount % or an amount, not both`);
    const gross = rnd(qty.times(price));
    let lineDiscount = d(0);
    if (isSet(l.discountPercent)) {
      const p = nonNeg(`${n} discount %`, l.discountPercent);
      if (p.gt(100)) throw new QuotationInputError(`${n} discount % cannot exceed 100`);
      lineDiscount = rnd(gross.times(p).div(100));
    } else if (isSet(l.discountAmount)) {
      lineDiscount = rnd(nonNeg(`${n} discount amount`, l.discountAmount));
      if (lineDiscount.gt(gross)) lineDiscount = gross;
    }
    return { gross, lineDiscount, taxable: gross.minus(lineDiscount), gstPercent };
  });

  const afterLine = draft.reduce((s, l) => s.plus(l.taxable), d(0));
  if (isSet(input.discountPercent) && isSet(input.discountAmount)) throw new QuotationInputError('Use a quotation discount % or an amount, not both');
  let headerDiscount = d(0);
  if (isSet(input.discountPercent)) {
    const p = nonNeg('Discount %', input.discountPercent);
    if (p.gt(100)) throw new QuotationInputError('Discount % cannot exceed 100');
    headerDiscount = rnd(afterLine.times(p).div(100));
  } else if (isSet(input.discountAmount)) {
    headerDiscount = rnd(nonNeg('Discount amount', input.discountAmount));
  }
  if (headerDiscount.gt(afterLine)) headerDiscount = afterLine;

  // spread the discount: floor each share, then hand the leftover units to the largest remainders
  const shares = draft.map(() => d(0));
  if (headerDiscount.gt(0) && afterLine.gt(0)) {
    const exact = draft.map((l) => headerDiscount.times(l.taxable).div(afterLine));
    const floors = exact.map((x) => x.toDecimalPlaces(places, Decimal.ROUND_DOWN));
    let leftover = headerDiscount.minus(floors.reduce((s, x) => s.plus(x), d(0)));
    const order = exact.map((x, i) => ({ i, frac: x.minus(floors[i]) })).sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
    floors.forEach((f, i) => (shares[i] = f));
    for (const { i } of order) {
      if (leftover.lte(0)) break;
      if (shares[i].plus(unit).lte(draft[i].taxable)) { shares[i] = shares[i].plus(unit); leftover = leftover.minus(unit); }
    }
  }

  const lines: QuotationLineResult[] = draft.map((l, i) => {
    const taxableNet = l.taxable.minus(shares[i]);
    const gstAmount = rnd(taxableNet.times(l.gstPercent).div(100));
    return { gross: l.gross, lineDiscount: l.lineDiscount, taxable: l.taxable, headerDiscountShare: shares[i], taxableNet, gstPercent: l.gstPercent, gstAmount, total: taxableNet.plus(gstAmount) };
  });

  const sum = (f: (l: QuotationLineResult) => Decimal) => lines.reduce((s, l) => s.plus(f(l)), d(0));
  const byRate = new Map<string, { percent: Decimal; taxable: Decimal; gst: Decimal }>();
  for (const l of lines) {
    const k = l.gstPercent.toString();
    const e = byRate.get(k) ?? { percent: l.gstPercent, taxable: d(0), gst: d(0) };
    byRate.set(k, { percent: e.percent, taxable: e.taxable.plus(l.taxableNet), gst: e.gst.plus(l.gstAmount) });
  }
  const beforeRound = sum((l) => l.total);
  const grandTotal = input.roundGrandTotal ? beforeRound.toDecimalPlaces(0, mode) : beforeRound;
  return {
    lines,
    subtotal: sum((l) => l.gross),
    lineDiscountTotal: sum((l) => l.lineDiscount),
    headerDiscount: sum((l) => l.headerDiscountShare),
    taxableAmount: sum((l) => l.taxableNet),
    gstAmount: sum((l) => l.gstAmount),
    gstBreakdown: [...byRate.values()].sort((a, b) => a.percent.comparedTo(b.percent)),
    roundOff: grandTotal.minus(beforeRound),
    grandTotal,
  };
}
