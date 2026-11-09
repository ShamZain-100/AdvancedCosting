import { z } from 'zod';
import { isoDate } from './masters';
import { nameField, nonNegativeDecimal, optional, optionalDecimal, optionalText } from './common';

export const PROFIT_METHODS = ['PERCENT', 'FIXED'] as const;
export const PRICE_COST_BASES = ['BASIC_COST', 'TOTAL_COST'] as const;
export const GST_TREATMENTS = ['EXCLUSIVE', 'INCLUSIVE', 'NONE'] as const;

const pct = nonNegativeDecimal.refine((v) => Number(v) <= 100, 'Max 100');

const itemFields = {
  profitMethod: z.enum(PROFIT_METHODS),
  profitValue: nonNegativeDecimal,
  discountPercent: optional(pct),
  discountAmount: optionalDecimal,
  minPrice: optionalDecimal,
  maxPrice: optionalDecimal,
  notes: optionalText(255),
};

const itemRules = (i: { discountPercent?: string; discountAmount?: string; minPrice?: string; maxPrice?: string }, ctx: z.RefinementCtx) => {
  if (i.discountPercent && i.discountAmount) ctx.addIssue({ code: 'custom', path: ['discountAmount'], message: 'Use a discount % or an amount, not both' });
  if (i.minPrice && i.maxPrice && Number(i.minPrice) > Number(i.maxPrice)) ctx.addIssue({ code: 'custom', path: ['minPrice'], message: 'Minimum cannot exceed maximum' });
};

export const priceListItemSchema = z.object({ costingId: z.string().uuid('Select a costing'), ...itemFields }).superRefine(itemRules);

export const priceListSchema = z.object({
  name: nameField,
  effectiveDate: isoDate,
  costBase: z.enum(PRICE_COST_BASES),
  gstTreatment: z.enum(GST_TREATMENTS),
  roundTo: optionalDecimal,
  defaultProfitMethod: z.enum(PROFIT_METHODS).default('PERCENT'),
  defaultProfitValue: nonNegativeDecimal.default('0'),
  defaultDiscountPercent: optional(pct),
  notes: optionalText(1000),
  items: z.array(priceListItemSchema).max(500, 'Too many items in one price list').default([]),
}).superRefine((l, ctx) => {
  const ids = l.items.map((i) => i.costingId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'A costing can appear once per price list' });
});
export type PriceListInput = z.infer<typeof priceListSchema>;

/** Bulk generation: one item per selected costing using the list defaults. */
export const generatePriceListSchema = z.object({
  name: nameField,
  effectiveDate: isoDate,
  costBase: z.enum(PRICE_COST_BASES),
  gstTreatment: z.enum(GST_TREATMENTS),
  roundTo: optionalDecimal,
  profitMethod: z.enum(PROFIT_METHODS),
  profitValue: nonNegativeDecimal,
  discountPercent: optional(pct),
  minPrice: optionalDecimal,
  maxPrice: optionalDecimal,
  notes: optionalText(1000),
  costingIds: z.array(z.string().uuid()).min(1, 'Select at least one costing').max(500),
}).superRefine((g, ctx) => itemRules(g, ctx));

export const addToPriceListSchema = z.object({ costingIds: z.array(z.string().uuid()).min(1).max(500) });

export const priceListPreviewSchema = z.object({
  costingId: z.string().uuid(),
  costBase: z.enum(PRICE_COST_BASES),
  gstTreatment: z.enum(GST_TREATMENTS),
  roundTo: optionalDecimal,
  ...itemFields,
}).superRefine(itemRules);

export const priceListStatusSchema = z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']) });
