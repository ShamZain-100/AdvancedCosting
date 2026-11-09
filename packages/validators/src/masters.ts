import { z } from 'zod';
import { codeField, nameField, nonNegativeDecimal, optional, optionalDecimal, optionalId, optionalText, positiveDecimal } from './common';

export const UNIT_TYPES = ['WEIGHT', 'LENGTH', 'AREA', 'VOLUME', 'COUNT', 'OTHER'] as const;
export const EXPENSE_CALC_METHODS = ['FIXED', 'PERCENTAGE', 'QUANTITY_BASED'] as const;
export const GST_TIMINGS = ['BEFORE_GST', 'AFTER_GST'] as const;
export const RATE_METHODS = ['LAST_PURCHASE', 'WEIGHTED_AVERAGE', 'SIMPLE_AVERAGE', 'MANUAL'] as const;
export const CONVERSION_FORMULAS = ['FIXED_FACTOR', 'CUSTOM_FORMULA'] as const;

const status = { isActive: z.boolean().default(true) };

export const typeSchema = z.object({
  name: nameField, code: codeField, description: optionalText(500), ...status,
});

export const itemGroupSchema = z.object({
  name: nameField, code: codeField, typeId: z.string().uuid('Select a type'), description: optionalText(500), ...status,
});

export const itemCategorySchema = z.object({
  name: nameField, code: codeField, groupId: z.string().uuid('Select a group'), description: optionalText(500), ...status,
});

export const unitSchema = z.object({
  name: nameField,
  symbol: z.string().trim().min(1, 'Required').max(15),
  unitType: z.enum(UNIT_TYPES),
  decimalPrecision: z.coerce.number().int().min(0).max(6).default(2),
  baseFactor: optional(positiveDecimal),
  ...status,
});

export const supplierSchema = z.object({
  name: nameField, code: codeField,
  contactPerson: optionalText(120), mobile: optionalText(30),
  email: optional(z.string().trim().email('Invalid email')),
  address: optionalText(500),
  gstin: optional(z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/, 'Invalid GSTIN')),
  state: optionalText(60),
  openingBalance: optional(z.string().trim().regex(/^-?\d+(\.\d+)?$/, 'Must be a number')),
  paymentTerms: optionalText(255), notes: optionalText(1000), ...status,
});

export const labourSchema = z.object({
  name: nameField, code: codeField, defaultRate: nonNegativeDecimal.default('0'),
  unitId: optionalId, typeId: optionalId, description: optionalText(500), ...status,
});

export const expenseSchema = z.object({
  name: nameField, code: codeField,
  calculationMethod: z.enum(EXPENSE_CALC_METHODS),
  defaultValue: nonNegativeDecimal.default('0'),
  applyTiming: z.enum(GST_TIMINGS),
  /** an overhead added automatically (locked) to every costing and reported separately */
  isCompanyExpense: z.boolean().default(false),
  ...status,
}).refine((e) => e.calculationMethod !== 'PERCENTAGE' || Number(e.defaultValue) <= 100, {
  path: ['defaultValue'], message: 'Percentage cannot exceed 100',
});

export const areaConversionSchema = z.object({
  name: nameField,
  fromUnitId: z.string().uuid('Select a unit'),
  toUnitId: z.string().uuid('Select a unit'),
  conversionValue: positiveDecimal,
  itemId: optionalId,
  formulaType: z.enum(CONVERSION_FORMULAS).default('FIXED_FACTOR'),
  formula: optionalText(255),
  ...status,
}).refine((c) => c.fromUnitId !== c.toUnitId, { path: ['toUnitId'], message: 'Units must differ' });

export const itemUnitConversionSchema = z.object({
  unitId: z.string().uuid('Select a unit'),
  conversionValue: positiveDecimal,
});
export const itemSupplierSchema = z.object({
  supplierId: z.string().uuid('Select a supplier'),
  rate: nonNegativeDecimal.default('0'),
  isDefault: z.boolean().default(false),
});

export const itemSchema = z.object({
  name: nameField, code: codeField,
  typeId: z.string().uuid('Select a type'),
  groupId: z.string().uuid('Select a group'),
  categoryId: z.string().uuid('Select a category'),
  description: optionalText(500),
  unitId: z.string().uuid('Select a unit'),
  defaultSupplierId: optionalId,
  defaultPurchaseRate: nonNegativeDecimal.default('0'),
  hasRateRange: z.boolean().default(false),
  minRate: optionalDecimal, maxRate: optionalDecimal, avgRate: optionalDecimal,
  rateMethod: z.enum(RATE_METHODS).default('LAST_PURCHASE'),
  gstPercent: nonNegativeDecimal.refine((v) => Number(v) <= 100, 'Max 100').default('0'),
  unitConversions: z.array(itemUnitConversionSchema).default([]),
  suppliers: z.array(itemSupplierSchema).default([]),
  ...status,
}).superRefine((i, ctx) => {
  if (i.hasRateRange && i.minRate && i.maxRate && Number(i.minRate) > Number(i.maxRate)) {
    ctx.addIssue({ code: 'custom', path: ['minRate'], message: 'Min cannot exceed max' });
  }
  const dupes = (ids: string[]) => new Set(ids).size !== ids.length;
  if (dupes(i.unitConversions.map((c) => c.unitId))) ctx.addIssue({ code: 'custom', path: ['unitConversions'], message: 'Duplicate unit' });
  if (dupes(i.suppliers.map((s) => s.supplierId))) ctx.addIssue({ code: 'custom', path: ['suppliers'], message: 'Duplicate supplier' });
  if (i.suppliers.filter((s) => s.isDefault).length > 1) ctx.addIssue({ code: 'custom', path: ['suppliers'], message: 'Only one default supplier' });
});

export type TypeInput = z.infer<typeof typeSchema>;
export type ItemInput = z.infer<typeof itemSchema>;

// ───────── Phase 4: purchase rates ─────────
export const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

export const purchaseRateSchema = z.object({
  itemId: z.string().uuid('Select an item'),
  supplierId: optionalId,
  unitId: z.string().uuid('Select a unit'),
  quantity: optional(positiveDecimal),
  rate: nonNegativeDecimal,
  purchaseDate: isoDate,
  referenceNo: optionalText(60),
  notes: optionalText(500),
});
export type PurchaseRateInput = z.infer<typeof purchaseRateSchema>;

export const manualRateSchema = z.object({
  newRate: nonNegativeDecimal,
  reason: z.string().trim().min(3, 'Give a short reason').max(255),
});
