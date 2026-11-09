import {
  costingMaterialSchema, costingSchema, quotationItemSchema, supplierSchema, unitSchema, labourSchema, typeSchema,
  decimalString, positiveDecimal, nonNegativeDecimal, paginationQuery,
} from '@costing/validators';

const id = '00000000-0000-4000-8000-000000000001';
const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;
const issues = (s: { safeParse: (v: unknown) => any }, v: unknown): string[] => {
  const r = s.safeParse(v);
  return r.success ? [] : r.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`);
};

describe('decimal fields (money never travels as a JS number)', () => {
  it.each(['0', '1', '12.50', '-3', '0.000001'])('accepts %s as a number string', (v) => expect(ok(decimalString, v)).toBe(true));
  it.each(['', 'abc', '1e5', '1,000', '1.', '.5', 'NaN', 'Infinity', '1 2', '--1'])('rejects %j', (v) => expect(ok(decimalString, v)).toBe(false));
  it('rejects real JS numbers so floats cannot sneak in', () => {
    expect(ok(decimalString, 12.5)).toBe(false);
  });
  it('positive means above zero; non-negative allows zero', () => {
    expect(ok(positiveDecimal, '0')).toBe(false);
    expect(ok(positiveDecimal, '0.01')).toBe(true);
    expect(ok(nonNegativeDecimal, '0')).toBe(true);
    expect(ok(nonNegativeDecimal, '-0.01')).toBe(false);
  });
});

describe('pagination', () => {
  it('has safe defaults and caps the page size', () => {
    expect(paginationQuery.parse({})).toMatchObject({ page: 1, pageSize: 25 });
    expect(ok(paginationQuery, { pageSize: '201' })).toBe(false);
    expect(ok(paginationQuery, { page: '0' })).toBe(false);
    expect(paginationQuery.parse({ page: '3', pageSize: '50' })).toMatchObject({ page: 3, pageSize: 50 });
  });
});

describe('master data', () => {
  it('trims names and codes, and rejects blank or oddly shaped ones', () => {
    expect(typeSchema.parse({ name: '  Furniture ', code: ' FUR ' })).toMatchObject({ name: 'Furniture', code: 'FUR' });
    expect(ok(typeSchema, { name: '   ', code: 'X' })).toBe(false);
    expect(ok(typeSchema, { name: 'A', code: 'has space' })).toBe(false);
    expect(ok(typeSchema, { name: 'A', code: "x'; DROP TABLE" })).toBe(false);
    expect(ok(typeSchema, { name: 'x'.repeat(121), code: 'X' })).toBe(false);
  });

  it('supplier GSTIN is upper-cased and checked; blank is allowed', () => {
    expect(supplierSchema.parse({ name: 'S', code: 'S1', gstin: '27aabcu9603r1zx' }).gstin).toBe('27AABCU9603R1ZX');
    expect(ok(supplierSchema, { name: 'S', code: 'S1', gstin: '' })).toBe(true);
    expect(ok(supplierSchema, { name: 'S', code: 'S1', gstin: 'NOTAGSTIN' })).toBe(false);
    expect(ok(supplierSchema, { name: 'S', code: 'S1', email: 'not-an-email' })).toBe(false);
  });

  it('units limit decimal precision and require a positive base factor when given', () => {
    const u = { name: 'Kilogram', symbol: 'KG', unitType: 'WEIGHT' };
    expect(ok(unitSchema, u)).toBe(true);
    expect(ok(unitSchema, { ...u, decimalPrecision: 7 })).toBe(false);
    expect(ok(unitSchema, { ...u, baseFactor: '0' })).toBe(false);
    expect(ok(unitSchema, { ...u, unitType: 'MAGIC' })).toBe(false);
  });

  it('labour rates cannot be negative', () => {
    expect(ok(labourSchema, { name: 'Welding', code: 'WLD', defaultRate: '-1' })).toBe(false);
    expect(labourSchema.parse({ name: 'Welding', code: 'WLD' }).defaultRate).toBe('0');
  });
});

describe('costing material rows', () => {
  const base = { itemId: id, quantity: '2', unitId: id };

  it('standard rows need only item, quantity and unit', () => {
    expect(ok(costingMaterialSchema, base)).toBe(true);
  });
  it('quantity must be above zero', () => {
    expect(ok(costingMaterialSchema, { ...base, quantity: '0' })).toBe(false);
  });
  it('a custom rate basis requires the rate; a supplier basis requires the supplier', () => {
    expect(issues(costingMaterialSchema, { ...base, rateBasis: 'CUSTOM' })).toEqual(['rate: Enter the custom rate']);
    expect(issues(costingMaterialSchema, { ...base, rateBasis: 'SUPPLIER' })).toEqual(['supplierId: Select a supplier']);
    expect(ok(costingMaterialSchema, { ...base, rateBasis: 'CUSTOM', rate: '12' })).toBe(true);
  });
  it('wastage by quantity requires the quantity; wastage % is capped at 100', () => {
    expect(issues(costingMaterialSchema, { ...base, wastageMode: 'QUANTITY' })).toEqual(['wastageQuantity: Enter the wastage quantity']);
    expect(ok(costingMaterialSchema, { ...base, wastagePercent: '100.01' })).toBe(false);
    expect(ok(costingMaterialSchema, { ...base, wastagePercent: '' })).toBe(true);
  });
  it('item ids must be UUIDs', () => {
    expect(ok(costingMaterialSchema, { ...base, itemId: 'not-a-uuid' })).toBe(false);
  });
});

describe('costing header', () => {
  const header = { productName: 'Chair', typeId: id, costingDate: '2026-02-01', gstPercent: '18', markupPercent: '10', groups: [] };

  it('accepts a minimal valid costing and defaults the quantity', () => {
    const r = costingSchema.safeParse(header);
    expect(r.success).toBe(true);
  });
  it('rejects a missing name, a non-UUID type and an impossible date', () => {
    expect(ok(costingSchema, { ...header, productName: '' })).toBe(false);
    expect(ok(costingSchema, { ...header, typeId: '1' })).toBe(false);
    expect(ok(costingSchema, { ...header, costingDate: '2026-13-45' })).toBe(false);
  });
  it('does not let a client choose server-calculated money fields', () => {
    const r = costingSchema.safeParse({ ...header, sellingPrice: '1', basicCost: '1', totalCostInclGst: '1' });
    if (r.success) for (const k of ['sellingPrice', 'basicCost', 'totalCostInclGst']) expect(r.data).not.toHaveProperty(k);
  });
});

describe('quotation lines', () => {
  const manual = { source: 'MANUAL', productName: 'Table', quantity: '1', unitPrice: '1000', gstPercent: '18' };

  it('manual lines need name, price and GST %', () => {
    expect(ok(quotationItemSchema, manual)).toBe(true);
    expect(issues(quotationItemSchema, { source: 'MANUAL', quantity: '1' }).sort()).toEqual([
      'gstPercent: Enter the GST %', 'productName: Enter the product / item name', 'unitPrice: Enter the unit price',
    ]);
  });
  it('costing and price list lines must point at their source', () => {
    expect(issues(quotationItemSchema, { source: 'COSTING', quantity: '1' })).toEqual(['costingId: Select a costing']);
    expect(issues(quotationItemSchema, { source: 'PRICE_LIST', quantity: '1' })).toEqual(['priceListItemId: Select a price list item']);
  });
  it('a discount is a percentage or an amount, never both', () => {
    expect(issues(quotationItemSchema, { ...manual, discountPercent: '5', discountAmount: '50' })).toEqual(['discountAmount: Use a discount % or an amount, not both']);
  });
  it('discount and GST percentages are capped at 100', () => {
    expect(ok(quotationItemSchema, { ...manual, discountPercent: '101' })).toBe(false);
    expect(ok(quotationItemSchema, { ...manual, gstPercent: '101' })).toBe(false);
  });
});
