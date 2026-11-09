import { areUnitsCompatible, convertQuantity, IncompatibleUnitsError, conversionsWithRules } from './units';

const kg = { id: 'kg', unitType: 'WEIGHT', baseFactor: '1' };
const g = { id: 'g', unitType: 'WEIGHT', baseFactor: '0.001' };
const m = { id: 'm', unitType: 'LENGTH', baseFactor: '1' };
const pc = { id: 'pc', unitType: 'COUNT', baseFactor: null };
const pipe = { baseUnitId: 'kg', conversions: [{ unitId: 'm', conversionValue: '3.15' }] };

describe('convertQuantity', () => {
  it('returns same quantity for same unit', () => {
    expect(convertQuantity('5', kg, kg).toString()).toBe('5');
  });
  it('converts within a unit type using base factors', () => {
    expect(convertQuantity('2500', g, kg).toString()).toBe('2.5');
  });
  it('uses item-specific conversion across unit types (1 m = 3.15 kg)', () => {
    expect(convertQuantity('2', m, kg, pipe).toString()).toBe('6.3');
    expect(convertQuantity('6.3', kg, m, pipe).toString()).toBe('2');
  });
  it('rejects incompatible units without an item conversion', () => {
    expect(() => convertQuantity('1', m, kg)).toThrow(IncompatibleUnitsError);
    expect(() => convertQuantity('1', pc, kg, pipe)).toThrow(IncompatibleUnitsError);
  });
  it('reports compatibility', () => {
    expect(areUnitsCompatible(kg, g)).toBe(true);
    expect(areUnitsCompatible(kg, m)).toBe(false);
  });
});

describe('conversionsWithRules', () => {
  const KG = { id: 'kg', unitType: 'WEIGHT' }, SQM = { id: 'sqm', unitType: 'AREA' }, SHEET = { id: 'sheet', unitType: 'COUNT' };
  const item = { id: 'i1', baseUnitId: 'kg', conversions: [] as { unitId: string; conversionValue: string }[] };

  it('uses a rule written from another unit to the base unit', () => {
    const conversions = conversionsWithRules(item, [{ fromUnitId: 'sqm', toUnitId: 'kg', conversionValue: '12.5' }]);
    expect(convertQuantity(2, SQM, KG, { baseUnitId: 'kg', conversions }).toString()).toBe('25');
  });

  it('uses a rule written from the base unit the other way round', () => {
    const conversions = conversionsWithRules(item, [{ fromUnitId: 'kg', toUnitId: 'sheet', conversionValue: '4' }]);
    expect(convertQuantity(8, SHEET, KG, { baseUnitId: 'kg', conversions }).toString()).toBe('2'); // 1 kg = 4 sheets
  });

  it('prefers the item\'s own conversion, then a rule for that item, then a general rule', () => {
    const general = { fromUnitId: 'sqm', toUnitId: 'kg', conversionValue: '1' };
    const forItem = { fromUnitId: 'sqm', toUnitId: 'kg', conversionValue: '2', itemId: 'i1' };
    const pick = (i: typeof item, rules: any[]) => convertQuantity(1, SQM, KG, { baseUnitId: 'kg', conversions: conversionsWithRules(i, rules) }).toString();
    expect(pick(item, [general, forItem])).toBe('2');
    expect(pick({ ...item, conversions: [{ unitId: 'sqm', conversionValue: '3' }] }, [general, forItem])).toBe('3');
    expect(pick(item, [general])).toBe('1');
  });

  it('ignores a rule for another item, and never chains through a third unit', () => {
    const rules = [{ fromUnitId: 'sqm', toUnitId: 'kg', conversionValue: '2', itemId: 'other' }, { fromUnitId: 'sqm', toUnitId: 'sheet', conversionValue: '2' }];
    expect(conversionsWithRules(item, rules)).toEqual([]);
  });
});
