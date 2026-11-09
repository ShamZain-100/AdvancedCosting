import { Decimal, d, Numeric } from './money';

export interface UnitRef {
  id: string;
  unitType: string;
  /** Multiplier to the base unit of its unit type (null = no generic conversion). */
  baseFactor?: Numeric | null;
}

export interface ItemConversion {
  unitId: string;
  /** 1 <unit> = conversionValue × (item base unit) */
  conversionValue: Numeric;
}

/** A fixed conversion from the Area / Conversion master: 1 <from> = conversionValue × <to>. No itemId means it applies to every item. */
export interface ConversionRule {
  fromUnitId: string;
  toUnitId: string;
  conversionValue: Numeric;
  itemId?: string | null;
}

export class IncompatibleUnitsError extends Error {}

/**
 * The conversions an item can use: its own first, then rules written for that item, then general rules.
 * A rule counts only when one side is the item's base unit; rules are not chained through a third unit, because a chain the
 * user never wrote is a guess.
 */
export function conversionsWithRules(item: { id: string; baseUnitId: string; conversions: ItemConversion[] }, rules: ConversionRule[]): ItemConversion[] {
  const applicable = [...rules.filter((r) => r.itemId === item.id), ...rules.filter((r) => !r.itemId)];
  const fromRules = applicable.flatMap((r): ItemConversion[] => {
    if (r.toUnitId === item.baseUnitId) return [{ unitId: r.fromUnitId, conversionValue: r.conversionValue }];
    if (r.fromUnitId === item.baseUnitId) return [{ unitId: r.toUnitId, conversionValue: d(1).div(r.conversionValue) }];
    return [];
  });
  return [...item.conversions, ...fromRules];
}

/**
 * Convert a quantity between two units for an item.
 * 1. same unit → unchanged
 * 2. both expressible against the item's base unit (item conversions, base unit itself = 1) → via item values
 * 3. same unit type with base factors → generic conversion
 * Otherwise the units are incompatible and an error is thrown (never guess).
 */
export function convertQuantity(
  qty: Numeric,
  from: UnitRef,
  to: UnitRef,
  item?: { baseUnitId: string; conversions: ItemConversion[] },
): Decimal {
  if (from.id === to.id) return d(qty);

  if (item) {
    const factor = (u: UnitRef): Decimal | null => {
      if (u.id === item.baseUnitId) return d(1);
      const c = item.conversions.find((x) => x.unitId === u.id);
      return c ? d(c.conversionValue) : null;
    };
    const f = factor(from);
    const t = factor(to);
    if (f && t) return d(qty).times(f).div(t);
  }

  if (from.unitType === to.unitType && from.baseFactor != null && to.baseFactor != null) {
    return d(qty).times(from.baseFactor).div(to.baseFactor);
  }
  throw new IncompatibleUnitsError(`Cannot convert between units ${from.id} and ${to.id}`);
}

export const areUnitsCompatible = (a: UnitRef, b: UnitRef): boolean =>
  a.id === b.id || (a.unitType === b.unitType && a.baseFactor != null && b.baseFactor != null);
