import { calculateQuotation, QuotationInput, QuotationInputError } from './quotation';

const s = (v: { toString(): string }) => v.toString();
const line = (over: Partial<QuotationInput['lines'][number]> = {}) => ({ quantity: 2, unitPrice: '4951.34', gstPercent: 18, ...over });

describe('calculateQuotation', () => {
  it('computes a single line with GST', () => {
    const r = calculateQuotation({ lines: [line()] });
    expect(s(r.lines[0].gross)).toBe('9902.68');
    expect(s(r.gstAmount)).toBe('1782.48'); // 9902.68 × 18% = 1782.4824
    expect(s(r.grandTotal)).toBe('11685.16');
  });

  it('applies line discounts (percent or amount, capped at the line value)', () => {
    const r = calculateQuotation({ lines: [line({ discountPercent: 10 }), line({ discountAmount: 500 }), line({ discountAmount: 999999 })] });
    expect(s(r.lines[0].lineDiscount)).toBe('990.27');
    expect(s(r.lines[1].lineDiscount)).toBe('500');
    expect(s(r.lines[2].lineDiscount)).toBe('9902.68');
    expect(s(r.lines[2].total)).toBe('0');
  });

  it('spreads a quotation discount over the lines and charges GST on the discounted value', () => {
    const r = calculateQuotation({ lines: [line({ quantity: 1, unitPrice: 1000, gstPercent: 18 }), line({ quantity: 1, unitPrice: 3000, gstPercent: 5 })], discountPercent: 10 });
    expect(s(r.headerDiscount)).toBe('400');
    expect(r.lines.map((l) => s(l.headerDiscountShare))).toEqual(['100', '300']);
    expect(s(r.taxableAmount)).toBe('3600');
    expect(s(r.gstAmount)).toBe('297'); // 900×18% + 2700×5% = 162 + 135
    expect(s(r.grandTotal)).toBe('3897');
  });

  it('distributes an awkward discount exactly (no lost or extra paise)', () => {
    const r = calculateQuotation({ lines: [line({ quantity: 1, unitPrice: '33.33' }), line({ quantity: 1, unitPrice: '33.33' }), line({ quantity: 1, unitPrice: '33.34' })], discountAmount: '10.00' });
    expect(s(r.headerDiscount)).toBe('10');
    expect(r.lines.reduce((t, l) => t.plus(l.headerDiscountShare), r.lines[0].gross.mul(0)).toString()).toBe('10');
    r.lines.forEach((l) => expect(l.headerDiscountShare.lte(l.taxable)).toBe(true));
  });

  it('groups GST by rate for printing', () => {
    const r = calculateQuotation({ lines: [line({ quantity: 1, unitPrice: 100, gstPercent: 18 }), line({ quantity: 1, unitPrice: 200, gstPercent: 5 }), line({ quantity: 1, unitPrice: 100, gstPercent: 18 })] });
    expect(r.gstBreakdown.map((b) => [s(b.percent), s(b.taxable), s(b.gst)])).toEqual([['5', '200', '10'], ['18', '200', '36']]);
  });

  it('can round the grand total and shows the round-off', () => {
    const r = calculateQuotation({ lines: [line()], roundGrandTotal: true });
    expect(s(r.grandTotal)).toBe('11685');
    expect(s(r.roundOff)).toBe('-0.16');
  });

  it('honours configured decimals and rounding mode', () => {
    const r = calculateQuotation({ lines: [line({ quantity: 1, unitPrice: '10.005', gstPercent: 0 })] }, { decimals: 2, rounding: 'DOWN' });
    expect(s(r.lines[0].gross)).toBe('10');
  });

  it('handles an empty quotation', () => {
    const r = calculateQuotation({ lines: [] });
    expect(s(r.grandTotal)).toBe('0');
  });

  it.each([
    ['negative quantity', { lines: [line({ quantity: -1 })] }, /cannot be negative/],
    ['GST over 100', { lines: [line({ gstPercent: 120 })] }, /cannot exceed 100/],
    ['both line discounts', { lines: [line({ discountPercent: 5, discountAmount: 5 })] }, /not both/],
    ['both header discounts', { lines: [line()], discountPercent: 5, discountAmount: 5 }, /not both/],
    ['header discount over 100%', { lines: [line()], discountPercent: 101 }, /cannot exceed 100/],
    ['non-numeric price', { lines: [line({ unitPrice: 'abc' })] }, /not a number/],
  ])('rejects %s', (_n, input, msg) => {
    expect(() => calculateQuotation(input as QuotationInput)).toThrow(QuotationInputError);
    expect(() => calculateQuotation(input as QuotationInput)).toThrow(msg);
  });

  it('totals always equal the sum of the rounded lines (randomised)', () => {
    let seed = 99;
    const r = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let n = 0; n < 300; n++) {
      const input: QuotationInput = {
        lines: Array.from({ length: 1 + Math.floor(r() * 6) }, () => line({
          quantity: (1 + r() * 20).toFixed(3), unitPrice: (r() * 5000).toFixed(2), gstPercent: [0, 5, 12, 18, 28][Math.floor(r() * 5)],
          discountPercent: r() < 0.3 ? (r() * 40).toFixed(2) : null,
        })),
        discountPercent: r() < 0.4 ? (r() * 25).toFixed(2) : null, roundGrandTotal: r() < 0.5,
      };
      const q = calculateQuotation(input);
      const totals = q.lines.reduce((t, l) => t.plus(l.total), q.subtotal.mul(0));
      expect(totals.plus(q.roundOff).minus(q.grandTotal).abs().lt(0.0001)).toBe(true);
      expect(q.subtotal.minus(q.lineDiscountTotal).minus(q.headerDiscount).minus(q.taxableAmount).abs().lt(0.0001)).toBe(true);
      expect(q.taxableAmount.plus(q.gstAmount).plus(q.roundOff).minus(q.grandTotal).abs().lt(0.0001)).toBe(true);
      q.lines.forEach((l) => { expect(l.taxableNet.isNegative()).toBe(false); expect(l.total.isNegative()).toBe(false); });
    }
  });
});
