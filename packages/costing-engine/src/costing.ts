import { Decimal, d, Numeric } from './money';

/**
 * Business rules for a costing. Nothing here is hardcoded into the maths: each costing stores the
 * rules it was calculated with, so later settings changes never alter finished costings.
 */
export interface CalcRules {
  /** decimal places of every rounded money amount */
  decimals: number;
  rounding: 'HALF_UP' | 'HALF_DOWN' | 'UP' | 'DOWN';
  /** round each line total (true) or only the totals (false) */
  roundLines: boolean;
  /** rates entered by users already contain GST; they are converted to ex-GST before costing */
  materialRatesIncludeGst: boolean;
  labourRatesIncludeGst: boolean;
  expenseRatesIncludeGst: boolean;
  /** COSTING: one GST % for the whole costing; ITEM: materials use their own item GST % */
  gstMode: 'COSTING' | 'ITEM';
  /**
   * MOST_SPECIFIC: item % wins, else category %, else group %, else overall % (never stacked).
   * CUMULATIVE: all defined levels are added together.
   */
  wastageMode: 'MOST_SPECIFIC' | 'CUMULATIVE';
  /** BASIC_COST: markup on the cost before GST. TOTAL_COST: markup on the cost including GST. */
  markupBase: 'BASIC_COST' | 'TOTAL_COST';
  /** denominator of the profit percentage */
  profitBase: 'BASIC_COST' | 'TOTAL_COST';
}

export const DEFAULT_RULES: CalcRules = {
  decimals: 2,
  rounding: 'HALF_UP',
  roundLines: true,
  materialRatesIncludeGst: false,
  labourRatesIncludeGst: false,
  expenseRatesIncludeGst: false,
  gstMode: 'COSTING',
  wastageMode: 'MOST_SPECIFIC',
  markupBase: 'TOTAL_COST',
  profitBase: 'BASIC_COST',
};

export interface MaterialInput {
  id: string;
  quantity: Numeric;
  /** PERCENT: use wastagePercent / inherited %; QUANTITY: wastageQuantity is added as-is */
  wastageMode?: 'PERCENT' | 'QUANTITY';
  wastagePercent?: Numeric | null;
  wastageQuantity?: Numeric | null;
  /** per row unit, as the user sees it (GST-inclusive if the rule says so) */
  rate: Numeric;
  itemGstPercent?: Numeric | null;
}
export interface LabourInput { id: string; quantity: Numeric; rate: Numeric }
export interface CategoryInput { id: string; wastagePercent?: Numeric | null; materials: MaterialInput[] }
export interface GroupInput { id: string; wastagePercent?: Numeric | null; categories: CategoryInput[]; labour: LabourInput[] }
export interface ExpenseInput {
  id: string;
  /** group id this expense belongs to, null = whole product */
  groupId?: string | null;
  method: 'FIXED' | 'PERCENTAGE' | 'QUANTITY_BASED';
  /** amount, % or per-unit rate depending on method */
  value: Numeric;
  /** multiplier for QUANTITY_BASED (e.g. number of pieces) */
  quantity?: Numeric | null;
  timing: 'BEFORE_GST' | 'AFTER_GST';
  /** an administrator-set company expense (overhead): reported separately in `companyExpenseCost` */
  isCompany?: boolean;
}

export interface CostingInput {
  /** product quantity, used for per-unit figures */
  quantity: Numeric;
  wastagePercent?: Numeric | null;
  gstPercent: Numeric;
  markupPercent: Numeric;
  /**
   * Extra percentage (contingency, overhead...) added to the total cost including GST, before markup.
   * The markup is then applied on the cost including this extra. Optional, default 0.
   */
  extraPercent?: Numeric | null;
  groups: GroupInput[];
  expenses: ExpenseInput[];
}

export interface MaterialResult {
  id: string;
  effectiveQuantity: Decimal;
  wastageQuantity: Decimal;
  appliedWastagePercent: Decimal;
  /** rate per unit after removing GST (equals the entered rate when rates are ex-GST) */
  netRate: Decimal;
  /** human-readable working, e.g. "(20.94 + 0.42) × 98 = 2,093.04" */
  formula: string;
  /** ex-GST line cost */
  total: Decimal;
  /** share of `total` caused by wastage */
  wastageCost: Decimal;
  gstPercent: Decimal;
}
export interface ExpenseResult { id: string; amount: Decimal; timing: 'BEFORE_GST' | 'AFTER_GST' }

export interface BreakdownStep { key: string; label: string; amount: Decimal; note?: string }

export interface CostingResult {
  materials: Record<string, MaterialResult>;
  labour: Record<string, Decimal>;
  expenses: Record<string, ExpenseResult>;
  groups: { id: string; materialCost: Decimal; labourCost: Decimal; wastagePercent: Decimal | null }[];
  materialCost: Decimal;
  materialWastage: Decimal;
  labourCost: Decimal;
  expenseBeforeGst: Decimal;
  expenseAfterGst: Decimal;
  expenseCost: Decimal;
  basicCost: Decimal;
  gstAmount: Decimal;
  totalCostInclGst: Decimal;
  /** extraPercent of totalCostInclGst */
  extraAmount: Decimal;
  /** part of expenseCost that came from company expenses */
  companyExpenseCost: Decimal;
  markupAmount: Decimal;
  sellingPrice: Decimal;
  profitAmount: Decimal;
  profitPercent: Decimal;
  quantity: Decimal;
  netBasicRate: Decimal;
  netSellingPrice: Decimal;
  breakdown: BreakdownStep[];
}

export class CostingInputError extends Error {}

/** Parse a numeric input, rejecting blanks, NaN and Infinity with a message naming the field. */
function num(label: string, v: Numeric | null | undefined): Decimal {
  let x: Decimal;
  try { x = d(v as Numeric); } catch { throw new CostingInputError(`${label} is not a number`); }
  if (!x.isFinite()) throw new CostingInputError(`${label} is not a finite number`);
  return x;
}

/**
 * Rejects input the maths would otherwise silently accept (negative quantities, NaN, percentages above 100,
 * duplicate row ids that would overwrite each other's results, expenses pointing at unknown groups).
 */
export function assertValidCostingInput(input: CostingInput): void {
  const nonNeg = (label: string, v: Numeric | null | undefined) => { if (num(label, v).isNegative()) throw new CostingInputError(`${label} cannot be negative`); };
  const pct = (label: string, v: Numeric | null | undefined) => { if (isSet(v)) { nonNeg(label, v); if (num(label, v).gt(100)) throw new CostingInputError(`${label} cannot exceed 100`); } };
  const unique = (label: string, ids: string[]) => { if (new Set(ids).size !== ids.length) throw new CostingInputError(`Duplicate ${label} id`); };

  nonNeg('Quantity', input.quantity);
  pct('Overall wastage %', input.wastagePercent);
  pct('GST %', input.gstPercent);
  nonNeg('Markup %', input.markupPercent);
  pct('Extra %', input.extraPercent);
  unique('group', input.groups.map((g) => g.id));
  unique('category', input.groups.flatMap((g) => g.categories.map((c) => c.id)));
  unique('material', input.groups.flatMap((g) => g.categories.flatMap((c) => c.materials.map((m) => m.id))));
  unique('labour', input.groups.flatMap((g) => g.labour.map((l) => l.id)));
  unique('expense', input.expenses.map((e) => e.id));
  const groupIds = new Set(input.groups.map((g) => g.id));
  for (const g of input.groups) {
    pct(`Group ${g.id} wastage %`, g.wastagePercent);
    for (const c of g.categories) {
      pct(`Category ${c.id} wastage %`, c.wastagePercent);
      for (const m of c.materials) {
        nonNeg(`Material ${m.id} quantity`, m.quantity);
        nonNeg(`Material ${m.id} rate`, m.rate);
        pct(`Material ${m.id} wastage %`, m.wastagePercent);
        if (isSet(m.wastageQuantity)) nonNeg(`Material ${m.id} wastage quantity`, m.wastageQuantity);
        pct(`Material ${m.id} GST %`, m.itemGstPercent);
      }
    }
    for (const l of g.labour) { nonNeg(`Labour ${l.id} quantity`, l.quantity); nonNeg(`Labour ${l.id} rate`, l.rate); }
  }
  for (const e of input.expenses) {
    nonNeg(`Expense ${e.id} value`, e.value);
    if (isSet(e.quantity)) nonNeg(`Expense ${e.id} quantity`, e.quantity);
    if (e.method === 'PERCENTAGE' && num(`Expense ${e.id} value`, e.value).gt(100)) throw new CostingInputError(`Expense ${e.id} percentage cannot exceed 100`);
    if (e.groupId && !groupIds.has(e.groupId)) throw new CostingInputError(`Expense ${e.id} refers to unknown group ${e.groupId}`);
  }
}

const ROUNDING: Record<CalcRules['rounding'], Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_DOWN: Decimal.ROUND_HALF_DOWN,
  UP: Decimal.ROUND_UP,
  DOWN: Decimal.ROUND_DOWN,
};
const isSet = (v: Numeric | null | undefined): v is Numeric => v !== null && v !== undefined && v !== '';

/** Wastage % that applies to one material row (item → category → group → overall). */
export function resolveWastagePercent(
  levels: { item?: Numeric | null; category?: Numeric | null; group?: Numeric | null; overall?: Numeric | null },
  mode: CalcRules['wastageMode'],
): Decimal {
  const ordered = [levels.item, levels.category, levels.group, levels.overall];
  if (mode === 'CUMULATIVE') return ordered.reduce<Decimal>((s, v) => (isSet(v) ? s.plus(v) : s), d(0));
  const first = ordered.find(isSet);
  return first === undefined ? d(0) : d(first);
}

/** The figures a margin (markup %) is added to. */
export interface CostBasis { basicCost: Numeric; totalCostInclGst: Numeric; extraAmount: Numeric }
export interface MarginResult { markupAmount: Decimal; sellingPrice: Decimal; profitAmount: Decimal; profitPercent: Decimal }

/**
 * Adds a margin on top of a cost. The one place this is calculated: a costing uses its own markup %, and each customer
 * group's price uses the group's margin %, so the two can never drift apart.
 * The extra amount is a cost uplift: the margin is taken on the uplifted cost (`total + extra`, or `basic + extra` when the
 * markup base is basic cost), and the selling price is `total + extra + margin`. Profit % is measured against the uplifted
 * cost of the profit base.
 */
export function applyMargin(cost: CostBasis, marginPercent: Numeric, partialRules: Partial<CalcRules> = {}): MarginResult {
  const rules: CalcRules = { ...DEFAULT_RULES, ...partialRules };
  const rnd = (v: Numeric) => d(v).toDecimalPlaces(rules.decimals, ROUNDING[rules.rounding]);
  const basic = d(cost.basicCost), total = d(cost.totalCostInclGst), extra = d(cost.extraAmount);
  const markupBase = (rules.markupBase === 'BASIC_COST' ? basic : total).plus(extra);
  const markupAmount = rnd(markupBase.times(marginPercent).div(100));
  const sellingPrice = rnd(total.plus(extra).plus(markupAmount));
  const denominator = (rules.profitBase === 'BASIC_COST' ? basic : total).plus(extra);
  const profitPercent = denominator.isZero() ? d(0) : markupAmount.div(denominator).times(100).toDecimalPlaces(2, ROUNDING[rules.rounding]);
  return { markupAmount, sellingPrice, profitAmount: markupAmount, profitPercent };
}

/** The saved figures of an approved costing that a dealer price is built on. */
export interface DealerPriceInput extends CostBasis { quantity: Numeric }
export interface DealerPriceResult extends MarginResult { unitPrice: Decimal }

/**
 * A price list dealer's price for an approved costing: the dealer's margin in place of the costing's own markup, through
 * `applyMargin`, so a dealer price and the costing's own selling price can never be worked out differently.
 * `sellingPrice` is for the costing's whole quantity (incl. GST, like the costing's selling price); `unitPrice` is one unit.
 */
export function calculateDealerPrice(c: DealerPriceInput, marginPercent: Numeric, partialRules: Partial<CalcRules> = {}): DealerPriceResult {
  const rules: CalcRules = { ...DEFAULT_RULES, ...partialRules };
  if (d(marginPercent).isNegative()) throw new CostingInputError('Margin % cannot be negative');
  const priced = applyMargin(c, marginPercent, rules);
  const qty = d(c.quantity).lte(0) ? d(1) : d(c.quantity);
  return { ...priced, unitPrice: priced.sellingPrice.div(qty).toDecimalPlaces(rules.decimals, ROUNDING[rules.rounding]) };
}

export function calculateCosting(input: CostingInput, partialRules: Partial<CalcRules> = {}): CostingResult {
  const rules: CalcRules = { ...DEFAULT_RULES, ...partialRules };
  assertValidCostingInput(input);
  const rnd = (v: Numeric) => d(v).toDecimalPlaces(rules.decimals, ROUNDING[rules.rounding]);
  const line = (v: Numeric) => (rules.roundLines ? rnd(v) : d(v));
  const costingGst = d(input.gstPercent);
  const netOf = (gross: Decimal, includesGst: boolean, gst: Decimal) => (includesGst ? gross.div(d(1).plus(gst.div(100))) : gross);

  const materials: CostingResult['materials'] = {};
  const labour: CostingResult['labour'] = {};
  const groupResults: CostingResult['groups'] = [];
  const expenseResults: CostingResult['expenses'] = {};
  const gstBaseByRate = new Map<string, Decimal>(); // gst % → base subject to it

  let materialCost = d(0);
  let materialWastage = d(0);
  let labourCost = d(0);
  const groupBase = new Map<string, Decimal>(); // group id → material + labour (for % expenses)

  for (const g of input.groups) {
    let gMaterial = d(0);
    let gLabour = d(0);
    for (const c of g.categories) {
      for (const m of c.materials) {
        const base = d(m.quantity);
        const mode = m.wastageMode ?? 'PERCENT';
        const pct = mode === 'PERCENT'
          ? resolveWastagePercent({ item: m.wastagePercent, category: c.wastagePercent, group: g.wastagePercent, overall: input.wastagePercent }, rules.wastageMode)
          : d(0);
        const wastageQty = mode === 'QUANTITY' ? d(m.wastageQuantity ?? 0) : base.times(pct).div(100);
        const effective = base.plus(wastageQty);
        const itemGst = rules.gstMode === 'ITEM' && isSet(m.itemGstPercent) ? d(m.itemGstPercent) : costingGst;
        const rate = netOf(d(m.rate), rules.materialRatesIncludeGst, itemGst);
        const total = line(effective.times(rate));
        const wastageCost = line(wastageQty.times(rate));
        const shownRate = rate.toDecimalPlaces(4, ROUNDING[rules.rounding]);
        const working = wastageQty.isZero() ? `${effective} × ${shownRate}` : `(${base} + ${wastageQty.toDecimalPlaces(4)}) × ${shownRate}`;
        materials[m.id] = {
          id: m.id, effectiveQuantity: effective, wastageQuantity: wastageQty, appliedWastagePercent: pct, netRate: rate,
          formula: `${working} = ${total}`, total, wastageCost, gstPercent: itemGst,
        };
        gMaterial = gMaterial.plus(total);
        materialWastage = materialWastage.plus(wastageCost);
        const key = itemGst.toString();
        gstBaseByRate.set(key, (gstBaseByRate.get(key) ?? d(0)).plus(total));
      }
    }
    for (const l of g.labour) {
      const total = line(d(l.quantity).times(netOf(d(l.rate), rules.labourRatesIncludeGst, costingGst)));
      labour[l.id] = total;
      gLabour = gLabour.plus(total);
    }
    materialCost = materialCost.plus(gMaterial);
    labourCost = labourCost.plus(gLabour);
    groupBase.set(g.id, gMaterial.plus(gLabour));
    groupResults.push({ id: g.id, materialCost: gMaterial, labourCost: gLabour, wastagePercent: isSet(g.wastagePercent) ? d(g.wastagePercent) : null });
  }

  // labour is taxed at the costing-level rate
  gstBaseByRate.set(costingGst.toString(), (gstBaseByRate.get(costingGst.toString()) ?? d(0)).plus(labourCost));
  const productBase = materialCost.plus(labourCost);

  let expenseBefore = d(0);
  let expenseAfter = d(0);
  let companyExpenseCost = d(0);
  for (const e of input.expenses) {
    const base = e.groupId ? (groupBase.get(e.groupId) ?? d(0)) : productBase;
    let amount: Decimal;
    if (e.method === 'PERCENTAGE') amount = base.times(e.value).div(100);
    else if (e.method === 'QUANTITY_BASED') amount = d(e.value).times(isSet(e.quantity) ? e.quantity : 1);
    else amount = d(e.value);
    // percentages are derived from net amounts; only absolute amounts can carry GST
    if (e.method !== 'PERCENTAGE') amount = netOf(amount, rules.expenseRatesIncludeGst, costingGst);
    amount = line(amount);
    expenseResults[e.id] = { id: e.id, amount, timing: e.timing };
    if (e.isCompany) companyExpenseCost = companyExpenseCost.plus(amount);
    if (e.timing === 'AFTER_GST') expenseAfter = expenseAfter.plus(amount);
    else {
      expenseBefore = expenseBefore.plus(amount);
      gstBaseByRate.set(costingGst.toString(), (gstBaseByRate.get(costingGst.toString()) ?? d(0)).plus(amount));
    }
  }

  const expenseCost = expenseBefore.plus(expenseAfter);
  const gstAmount = rnd([...gstBaseByRate.entries()].reduce((s, [pct, base]) => s.plus(base.times(pct).div(100)), d(0)));
  // basic cost = everything that exists before GST, after-GST expenses excluded from tax but part of cost
  const basicCost = rnd(materialCost.plus(labourCost).plus(expenseBefore));
  const totalCostInclGst = rnd(basicCost.plus(gstAmount).plus(expenseAfter));

  const extraAmount = isSet(input.extraPercent) ? rnd(totalCostInclGst.times(input.extraPercent).div(100)) : d(0);
  const priced = applyMargin({ basicCost, totalCostInclGst, extraAmount }, input.markupPercent, rules);
  const { markupAmount, sellingPrice, profitAmount, profitPercent } = priced;

  const quantity = d(input.quantity).lte(0) ? d(1) : d(input.quantity);
  const perUnit = (v: Decimal) => rnd(v.div(quantity));

  const breakdown: BreakdownStep[] = [
    { key: 'material', label: 'Material cost', amount: rnd(materialCost), note: `includes ${rnd(materialWastage).toString()} for wastage` },
    { key: 'labour', label: 'Labour cost', amount: rnd(labourCost) },
    { key: 'expenseBefore', label: 'Other expenses (before GST)', amount: rnd(expenseBefore) },
    { key: 'basic', label: 'Basic cost before GST', amount: basicCost, note: 'material + labour + expenses before GST' },
    { key: 'gst', label: `GST`, amount: gstAmount, note: rules.gstMode === 'ITEM' ? 'item GST % on materials, costing GST % on the rest' : `${costingGst.toString()}% of the GST base` },
    { key: 'expenseAfter', label: 'Other expenses (after GST)', amount: rnd(expenseAfter) },
    { key: 'total', label: 'Total cost including GST', amount: totalCostInclGst },
    ...(extraAmount.isZero() ? [] : [{ key: 'extra', label: `Extra ${d(input.extraPercent ?? 0).toString()}%`, amount: extraAmount, note: 'on total cost incl. GST, before markup' }]),
    { key: 'markup', label: `Markup ${d(input.markupPercent).toString()}%`, amount: markupAmount, note: `${rules.markupBase === 'BASIC_COST' ? 'on basic cost' : 'on total cost incl. GST'}${extraAmount.isZero() ? '' : ' plus the extra'}` },
    { key: 'selling', label: 'Selling price', amount: sellingPrice },
  ];

  return {
    materials, labour, expenses: expenseResults, groups: groupResults,
    materialCost: rnd(materialCost), materialWastage: rnd(materialWastage), labourCost: rnd(labourCost),
    expenseBeforeGst: rnd(expenseBefore), expenseAfterGst: rnd(expenseAfter), expenseCost: rnd(expenseCost),
    basicCost, gstAmount, totalCostInclGst, extraAmount, companyExpenseCost: rnd(companyExpenseCost), markupAmount, sellingPrice, profitAmount, profitPercent,
    quantity, netBasicRate: perUnit(basicCost), netSellingPrice: perUnit(sellingPrice), breakdown,
  };
}

// ───────────────────────── rate resolution ─────────────────────────

export type RateBasis = 'STANDARD' | 'MIN' | 'MAX' | 'AVERAGE' | 'SUPPLIER' | 'CUSTOM';

export interface ItemRateInfo {
  baseUnitId: string;
  /** per base unit */
  defaultPurchaseRate: Numeric;
  hasRateRange: boolean;
  minRate?: Numeric | null;
  maxRate?: Numeric | null;
  avgRate?: Numeric | null;
  suppliers: { supplierId: string; rate: Numeric }[];
}

export interface ResolvedRate {
  /** per the row's unit */
  rate: Decimal;
  /** basis actually used (falls back to STANDARD when the requested figure is unavailable) */
  basis: RateBasis;
  fellBack: boolean;
}

/**
 * Rate a costing row should use, per the row's own unit.
 * `unitFactor` = how many item base units one row unit equals (1 for the base unit, 3.15 for "Meter" in the Metal Pipe example).
 */
export function resolveMaterialRate(
  item: ItemRateInfo,
  basis: RateBasis,
  unitFactor: Numeric,
  opts: { supplierId?: string | null; customRate?: Numeric | null } = {},
): ResolvedRate {
  if (basis === 'CUSTOM') return { rate: d(opts.customRate ?? 0), basis, fellBack: false };
  let base: Numeric | null | undefined;
  switch (basis) {
    case 'MIN': base = item.hasRateRange ? item.minRate : null; break;
    case 'MAX': base = item.hasRateRange ? item.maxRate : null; break;
    case 'AVERAGE': base = item.hasRateRange ? item.avgRate : null; break;
    case 'SUPPLIER': base = item.suppliers.find((s) => s.supplierId === opts.supplierId)?.rate; break;
    default: base = item.defaultPurchaseRate;
  }
  const fellBack = basis !== 'STANDARD' && !isSet(base);
  const used = fellBack ? item.defaultPurchaseRate : (base as Numeric);
  return { rate: d(used).times(unitFactor), basis: fellBack ? 'STANDARD' : basis, fellBack };
}
