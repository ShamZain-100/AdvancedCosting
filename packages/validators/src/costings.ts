import { z } from 'zod';
import { nonNegativeDecimal, optional, optionalDecimal, optionalId, optionalText, positiveDecimal, nameField } from './common';
import { EXPENSE_CALC_METHODS, GST_TIMINGS, isoDate } from './masters';

const percent = nonNegativeDecimal.refine((v) => Number(v) <= 100, 'Max 100');
const optionalPercent = optional(percent);

export const RATE_BASES = ['STANDARD', 'MIN', 'MAX', 'AVERAGE', 'SUPPLIER', 'CUSTOM'] as const;
export const WASTAGE_MODES = ['PERCENT', 'QUANTITY'] as const;
export const COSTING_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'] as const;

export const costingMaterialSchema = z.object({
  itemId: z.string().uuid('Select an item'),
  notes: optionalText(255),
  quantity: positiveDecimal,
  unitId: z.string().uuid('Select a unit'),
  wastageMode: z.enum(WASTAGE_MODES).default('PERCENT'),
  wastagePercent: optionalPercent,
  wastageQuantity: optionalDecimal,
  rateBasis: z.enum(RATE_BASES).default('STANDARD'),
  supplierId: optionalId,
  /** only used when rateBasis = CUSTOM; otherwise the server takes the rate from the masters */
  rate: optionalDecimal,
}).superRefine((m, ctx) => {
  if (m.rateBasis === 'CUSTOM' && !m.rate) ctx.addIssue({ code: 'custom', path: ['rate'], message: 'Enter the custom rate' });
  if (m.rateBasis === 'SUPPLIER' && !m.supplierId) ctx.addIssue({ code: 'custom', path: ['supplierId'], message: 'Select a supplier' });
  if (m.wastageMode === 'QUANTITY' && !m.wastageQuantity) ctx.addIssue({ code: 'custom', path: ['wastageQuantity'], message: 'Enter the wastage quantity' });
});

export const costingLabourSchema = z.object({
  labourId: z.string().uuid('Select labour'),
  quantity: positiveDecimal.default('1'),
  unitId: optionalId,
  /** blank = labour master rate; a value is a user override */
  rate: optionalDecimal,
});

export const costingCategorySchema = z.object({
  categoryId: z.string().uuid('Select a category'),
  wastagePercent: optionalPercent,
  materials: z.array(costingMaterialSchema).max(300, 'Too many materials in one category').default([]),
});

export const costingGroupSchema = z.object({
  groupId: z.string().uuid('Select a group'),
  wastagePercent: optionalPercent,
  categories: z.array(costingCategorySchema).max(50, 'Too many categories in one group').default([]),
  labour: z.array(costingLabourSchema).max(100, 'Too many labour rows in one group').default([]),
});

export const costingExpenseSchema = z.object({
  expenseId: z.string().uuid('Select an expense'),
  groupId: optionalId,
  calculationMethod: optional(z.enum(EXPENSE_CALC_METHODS)),
  value: optionalDecimal,
  quantity: optional(positiveDecimal),
  applyTiming: optional(z.enum(GST_TIMINGS)),
});

export const costingSchema = z.object({
  productName: nameField,
  productCode: optionalText(40),
  typeId: z.string().uuid('Select a type'),
  templateId: optionalId,
  description: optionalText(1000),
  length: optionalDecimal, width: optionalDecimal, height: optionalDecimal,
  dimensionUnitId: optionalId,
  quantity: positiveDecimal.default('1'),
  unitId: optionalId,
  costingDate: isoDate,
  notes: optionalText(1000),
  wastagePercent: percent.default('0'),
  gstPercent: percent.default('0'),
  markupPercent: nonNegativeDecimal.default('0'),
  /** extra % on the total cost incl. GST, before markup (contingency / overhead) */
  extraPercent: percent.default('0'),
  groups: z.array(costingGroupSchema).max(50, 'Too many groups').default([]),
  expenses: z.array(costingExpenseSchema).max(100, 'Too many expenses').default([]),
}).superRefine((c, ctx) => {
  const dupes = (ids: string[]) => new Set(ids).size !== ids.length;
  if (dupes(c.groups.map((g) => g.groupId))) ctx.addIssue({ code: 'custom', path: ['groups'], message: 'Each group can be added once' });
  const gids = new Set(c.groups.map((g) => g.groupId));
  c.groups.forEach((g, gi) => {
    if (dupes(g.categories.map((x) => x.categoryId))) ctx.addIssue({ code: 'custom', path: ['groups', gi, 'categories'], message: 'Each category can be added once per group' });
  });
  c.expenses.forEach((e, i) => {
    if (e.groupId && !gids.has(e.groupId)) ctx.addIssue({ code: 'custom', path: ['expenses', i, 'groupId'], message: 'Group is not part of this costing' });
  });
});
export type CostingInputPayload = z.infer<typeof costingSchema>;

export const costingActionSchema = z.object({ reason: optionalText(500) });
export const saveAsTemplateSchema = z.object({ name: nameField, code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, . _ - only') });

export const calcRulesSchema = z.object({
  // money columns store 2 decimal places, so more than 2 here would make saved figures differ from calculated ones
  decimals: z.coerce.number().int().min(0).max(2),
  rounding: z.enum(['HALF_UP', 'HALF_DOWN', 'UP', 'DOWN']),
  roundLines: z.boolean(),
  materialRatesIncludeGst: z.boolean(),
  labourRatesIncludeGst: z.boolean(),
  expenseRatesIncludeGst: z.boolean(),
  gstMode: z.enum(['COSTING', 'ITEM']),
  wastageMode: z.enum(['MOST_SPECIFIC', 'CUMULATIVE']),
  markupBase: z.enum(['BASIC_COST', 'TOTAL_COST']),
  profitBase: z.enum(['BASIC_COST', 'TOTAL_COST']),
});

export const imageUpdateSchema = z.object({
  description: optionalText(200),
  isMain: z.boolean().optional(),
}).refine((v) => v.description !== undefined || v.isMain !== undefined, 'Nothing to update');

export const companySettingsSchema = z.object({
  name: nameField,
  address: optionalText(500),
  phone: optionalText(30),
  email: optional(z.string().trim().email('Invalid email')),
  gstin: optional(z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/, 'Invalid GSTIN')),
  state: optionalText(60),
  website: optionalText(120),
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code').default('INR'),
  currencySymbol: z.string().trim().min(1).max(4).default('₹'),
  footerNote: optionalText(300),
});

export const RECALC_MODES = ['AUTO', 'CONFIRM', 'MANUAL'] as const;
export const recalcPolicySchema = z.object({ mode: z.enum(RECALC_MODES), flagThresholdPercent: z.coerce.number().min(0).max(100).default(0) });
export const dismissRecalcSchema = z.object({ reason: z.string().trim().min(3, 'Give a short reason').max(255) });
