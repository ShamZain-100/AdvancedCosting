import Decimal from 'decimal.js';

/** Decimal arithmetic helpers. All financial maths must go through these, never JS number operators. */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Numeric = Decimal.Value;
export const d = (v: Numeric): Decimal => new Decimal(v);

export const add = (...values: Numeric[]): Decimal =>
  values.reduce<Decimal>((sum, v) => sum.plus(v), d(0));

export const mul = (a: Numeric, b: Numeric): Decimal => d(a).times(b);

/** value × percent / 100 */
export const percentOf = (value: Numeric, percent: Numeric): Decimal =>
  d(value).times(percent).div(100);

export const round = (v: Numeric, places: number): Decimal =>
  d(v).toDecimalPlaces(places, Decimal.ROUND_HALF_UP);

export { Decimal };
