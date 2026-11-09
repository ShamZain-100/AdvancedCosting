import { Decimal, d, Numeric } from './money';

export interface RateEntry {
  /** rate per item base unit */
  baseRate: Numeric;
  /** quantity in item base units (weight for the weighted average) */
  baseQuantity: Numeric;
  /** ISO date (YYYY-MM-DD) or Date; later wins, ties broken by array order (later = newer) */
  date: string | Date;
}

export interface RateStats {
  count: number;
  last: Decimal | null;
  min: Decimal | null;
  max: Decimal | null;
  simpleAverage: Decimal | null;
  weightedAverage: Decimal | null;
}

export type RateMethod = 'LAST_PURCHASE' | 'WEIGHTED_AVERAGE' | 'SIMPLE_AVERAGE' | 'MANUAL';

const time = (x: string | Date) => new Date(x).getTime();

export function computeRateStats(entries: RateEntry[], places = 4): RateStats {
  if (!entries.length) return { count: 0, last: null, min: null, max: null, simpleAverage: null, weightedAverage: null };
  const rates = entries.map((e) => d(e.baseRate));
  // stable sort by date; among equal dates the entry later in the array is newer
  const newest = entries.map((e, i) => ({ e, i })).sort((a, b) => time(a.e.date) - time(b.e.date) || a.i - b.i).at(-1)!.e;
  const totalQty = entries.reduce((s, e) => s.plus(e.baseQuantity), d(0));
  const totalCost = entries.reduce((s, e) => s.plus(d(e.baseRate).times(e.baseQuantity)), d(0));
  const r = (v: Decimal) => v.toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
  return {
    count: entries.length,
    last: r(d(newest.baseRate)),
    min: r(Decimal.min(...rates)),
    max: r(Decimal.max(...rates)),
    simpleAverage: r(rates.reduce((s, x) => s.plus(x), d(0)).div(rates.length)),
    // a purchase with zero quantity cannot weight anything; fall back to the simple average
    weightedAverage: totalQty.isZero() ? r(rates.reduce((s, x) => s.plus(x), d(0)).div(rates.length)) : r(totalCost.div(totalQty)),
  };
}

/**
 * Current rate an item should carry after its purchases change.
 * Returns null when the rate must not move automatically (MANUAL, or no purchases).
 */
export function selectCurrentRate(method: RateMethod, stats: RateStats): Decimal | null {
  if (!stats.count) return null;
  switch (method) {
    case 'LAST_PURCHASE': return stats.last;
    case 'WEIGHTED_AVERAGE': return stats.weightedAverage;
    case 'SIMPLE_AVERAGE': return stats.simpleAverage;
    case 'MANUAL': return null;
  }
}
