import { calculateCosting, CalcRules, CostingInput, CostingInputError, resolveWastagePercent } from './costing';

/** Small deterministic PRNG so failures are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
const dp = (r: () => number, max: number, places: number) => (r() * max).toFixed(places);

function randomInput(seed: number): CostingInput {
  const r = rng(seed);
  const maybe = (v: string) => (r() < 0.4 ? v : null);
  const groups = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, g) => ({
    id: `g${g}`, wastagePercent: maybe(dp(r, 10, 2)),
    categories: Array.from({ length: 1 + Math.floor(r() * 2) }, (_, c) => ({
      id: `c${g}.${c}`, wastagePercent: maybe(dp(r, 10, 2)),
      materials: Array.from({ length: 1 + Math.floor(r() * 4) }, (_, m) => ({
        id: `m${g}.${c}.${m}`, quantity: dp(r, 100, 3), rate: dp(r, 500, 2), wastagePercent: maybe(dp(r, 15, 2)), itemGstPercent: String([0, 5, 12, 18, 28][Math.floor(r() * 5)]),
      })),
    })),
    labour: Array.from({ length: Math.floor(r() * 3) }, (_, l) => ({ id: `l${g}.${l}`, quantity: dp(r, 5, 2), rate: dp(r, 2000, 2) })),
  }));
  return {
    quantity: 1 + Math.floor(r() * 10), wastagePercent: maybe(dp(r, 5, 2)), gstPercent: [0, 5, 12, 18][Math.floor(r() * 4)], markupPercent: dp(r, 60, 2), groups,
    expenses: Array.from({ length: Math.floor(r() * 4) }, (_, e) => ({
      id: `e${e}`, groupId: r() < 0.5 ? `g${Math.floor(r() * groups.length)}` : null,
      method: (['FIXED', 'PERCENTAGE', 'QUANTITY_BASED'] as const)[Math.floor(r() * 3)], value: dp(r, 40, 2), quantity: dp(r, 5, 0),
      timing: r() < 0.7 ? ('BEFORE_GST' as const) : ('AFTER_GST' as const),
    })),
  };
}

const RULE_SETS: Partial<CalcRules>[] = [
  {}, { roundLines: false }, { gstMode: 'ITEM' }, { wastageMode: 'CUMULATIVE' }, { markupBase: 'BASIC_COST', profitBase: 'TOTAL_COST' },
  { decimals: 0 }, { decimals: 3, rounding: 'DOWN' },
];

describe('costing invariants (randomised, seeded)', () => {
  const cases = Array.from({ length: 150 }, (_, i) => i + 1);

  it.each(RULE_SETS.map((r, i) => [i, r] as const))('totals reconcile for rule set %#', (_i, rules) => {
    for (const seed of cases) {
      const input = randomInput(seed);
      const r = calculateCosting(input, rules);
      const places = rules.decimals ?? 2;
      const tol = 10 ** -places; // each rounded step may differ by one unit in the last place

      // every figure is finite and non-negative
      for (const v of [r.materialCost, r.labourCost, r.expenseCost, r.basicCost, r.gstAmount, r.totalCostInclGst, r.markupAmount, r.sellingPrice]) {
        expect(v.isFinite() && !v.isNegative()).toBe(true);
      }
      // the stated formulas hold (rounding can move each step by at most one unit)
      expect(r.basicCost.minus(r.materialCost.plus(r.labourCost).plus(r.expenseBeforeGst)).abs().lte(tol * 3)).toBe(true);
      expect(r.totalCostInclGst.minus(r.basicCost.plus(r.gstAmount).plus(r.expenseAfterGst)).abs().lte(tol * 2)).toBe(true);
      expect(r.sellingPrice.minus(r.totalCostInclGst.plus(r.markupAmount)).abs().lte(tol * 2)).toBe(true);
      expect(r.expenseCost.minus(r.expenseBeforeGst.plus(r.expenseAfterGst)).abs().lte(tol * 2)).toBe(true);
      // per-line totals add up to the group figures
      const lineSum = Object.values(r.materials).reduce((s, m) => s.plus(m.total), r.materialCost.mul(0));
      expect(lineSum.minus(r.materialCost).abs().lte(tol * Object.keys(r.materials).length + tol)).toBe(true);
      // wastage can only add cost
      expect(r.materialWastage.lte(r.materialCost.plus(tol))).toBe(true);
    }
  });

  it('is deterministic', () => {
    const a = calculateCosting(randomInput(7));
    const b = calculateCosting(randomInput(7));
    expect(a.sellingPrice.toString()).toBe(b.sellingPrice.toString());
    expect(a.breakdown.map((x) => x.amount.toString())).toEqual(b.breakdown.map((x) => x.amount.toString()));
  });

  it('GST-inclusive rates cost the same as the equivalent ex-GST rates', () => {
    for (const seed of cases) {
      const input = randomInput(seed);
      input.gstPercent = 18;
      const exclusive = calculateCosting(input, { roundLines: false });
      const grossed: CostingInput = {
        ...input,
        groups: input.groups.map((g) => ({
          ...g,
          categories: g.categories.map((c) => ({ ...c, materials: c.materials.map((m) => ({ ...m, rate: (Number(m.rate) * 1.18).toFixed(10) })) })),
          labour: g.labour.map((l) => ({ ...l, rate: (Number(l.rate) * 1.18).toFixed(10) })),
        })),
        expenses: input.expenses.map((e) => (e.method === 'PERCENTAGE' ? e : { ...e, value: (Number(e.value) * 1.18).toFixed(10) })),
      };
      const inclusive = calculateCosting(grossed, { roundLines: false, materialRatesIncludeGst: true, labourRatesIncludeGst: true, expenseRatesIncludeGst: true });
      expect(inclusive.basicCost.minus(exclusive.basicCost).abs().lte(0.01)).toBe(true);
      expect(inclusive.gstAmount.minus(exclusive.gstAmount).abs().lte(0.01)).toBe(true);
    }
  });

  it('doubling every material quantity doubles material cost', () => {
    for (const seed of cases) {
      const input = randomInput(seed);
      const doubled: CostingInput = { ...input, groups: input.groups.map((g) => ({ ...g, categories: g.categories.map((c) => ({ ...c, materials: c.materials.map((m) => ({ ...m, quantity: Number(m.quantity) * 2 })) })) })) };
      const a = calculateCosting(input, { roundLines: false });
      const b = calculateCosting(doubled, { roundLines: false });
      expect(b.materialCost.minus(a.materialCost.mul(2)).abs().lte(0.01)).toBe(true);
    }
  });

  it('never stacks wastage in MOST_SPECIFIC mode', () => {
    for (const seed of cases) {
      const input = randomInput(seed);
      const r = calculateCosting(input, { wastageMode: 'MOST_SPECIFIC' });
      input.groups.forEach((g) => g.categories.forEach((c) => c.materials.forEach((m) => {
        const expected = resolveWastagePercent({ item: m.wastagePercent, category: c.wastagePercent, group: g.wastagePercent, overall: input.wastagePercent }, 'MOST_SPECIFIC');
        expect(r.materials[m.id].appliedWastagePercent.toString()).toBe(expected.toString());
        const levels = [m.wastagePercent, c.wastagePercent, g.wastagePercent, input.wastagePercent].filter((x) => x !== null && x !== undefined);
        if (levels.length) expect(r.materials[m.id].appliedWastagePercent.eq(Number(levels[0]))).toBe(true);
      })));
    }
  });
});

describe('input validation', () => {
  const base = (): CostingInput => ({
    quantity: 1, gstPercent: 18, markupPercent: 10, expenses: [],
    groups: [{ id: 'g', labour: [], categories: [{ id: 'c', materials: [{ id: 'm', quantity: 1, rate: 10 }] }] }],
  });

  it.each([
    ['negative material quantity', (i: CostingInput) => { i.groups[0].categories[0].materials[0].quantity = -1; }, /cannot be negative/],
    ['negative rate', (i: CostingInput) => { i.groups[0].categories[0].materials[0].rate = '-5'; }, /cannot be negative/],
    ['non-numeric rate', (i: CostingInput) => { i.groups[0].categories[0].materials[0].rate = 'abc'; }, /not a number/],
    ['infinite quantity', (i: CostingInput) => { i.groups[0].categories[0].materials[0].quantity = Infinity; }, /not a finite number/],
    ['GST above 100', (i: CostingInput) => { i.gstPercent = 120; }, /cannot exceed 100/],
    ['wastage above 100', (i: CostingInput) => { i.groups[0].categories[0].materials[0].wastagePercent = 101; }, /cannot exceed 100/],
    ['percentage expense above 100', (i: CostingInput) => { i.expenses = [{ id: 'e', method: 'PERCENTAGE', value: 150, timing: 'BEFORE_GST' }]; }, /cannot exceed 100/],
    ['expense for an unknown group', (i: CostingInput) => { i.expenses = [{ id: 'e', groupId: 'nope', method: 'FIXED', value: 1, timing: 'BEFORE_GST' }]; }, /unknown group/],
    ['duplicate material ids', (i: CostingInput) => { i.groups[0].categories[0].materials.push({ id: 'm', quantity: 1, rate: 1 }); }, /Duplicate material id/],
  ])('rejects %s', (_n, mutate, message) => {
    const input = base();
    mutate(input);
    expect(() => calculateCosting(input)).toThrow(CostingInputError);
    expect(() => calculateCosting(input)).toThrow(message);
  });

  it('accepts a valid input untouched', () => {
    expect(() => calculateCosting(base())).not.toThrow();
  });
});

describe('explainability', () => {
  it('states the working for each material line, including wastage', () => {
    const r = calculateCosting({
      quantity: 1, gstPercent: 0, markupPercent: 0, expenses: [],
      groups: [{ id: 'g', labour: [], categories: [{ id: 'c', materials: [{ id: 'm', quantity: '20.94', rate: '98', wastagePercent: 2 }, { id: 'n', quantity: '4', rate: '4' }] }] }],
    });
    expect(r.materials.m.formula).toBe('(20.94 + 0.4188) × 98 = 2093.16');
    expect(r.materials.n.formula).toBe('4 × 4 = 16');
  });

  it('shows the net rate used when rates include GST', () => {
    const r = calculateCosting(
      { quantity: 1, gstPercent: 18, markupPercent: 0, expenses: [], groups: [{ id: 'g', labour: [], categories: [{ id: 'c', materials: [{ id: 'm', quantity: 1, rate: '118' }] }] }] },
      { materialRatesIncludeGst: true },
    );
    expect(r.materials.m.netRate.toString()).toBe('100');
  });
});
