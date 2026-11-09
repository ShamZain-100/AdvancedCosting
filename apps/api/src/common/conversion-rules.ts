import type { ConversionRule } from '@costing/costing-engine';

/**
 * Active fixed conversions from the Area / Conversion master. Custom formulas are stored for reference but never evaluated:
 * running formula text typed into a form would be unsafe, and money must never rest on a guess.
 */
export async function activeConversionRules(db: { areaConversion: { findMany: (a: any) => Promise<any[]> } }): Promise<ConversionRule[]> {
  const rows = await db.areaConversion.findMany({
    where: { isActive: true, deletedAt: null, formulaType: 'FIXED_FACTOR' }, select: { fromUnitId: true, toUnitId: true, conversionValue: true, itemId: true },
  });
  return rows.map((r) => ({ fromUnitId: r.fromUnitId, toUnitId: r.toUnitId, conversionValue: r.conversionValue.toString(), itemId: r.itemId }));
}
