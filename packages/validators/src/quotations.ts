import { z } from 'zod';
import { codeField, nameField, nonNegativeDecimal, optional, optionalDecimal, optionalId, optionalText, positiveDecimal } from './common';
import { isoDate } from './masters';

const pct = nonNegativeDecimal.refine((v) => Number(v) <= 100, 'Max 100');
const gstin = optional(z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/, 'Invalid GSTIN'));

export const customerSchema = z.object({
  name: nameField, code: codeField,
  contactPerson: optionalText(120), mobile: optionalText(30),
  email: optional(z.string().trim().email('Invalid email')),
  address: optionalText(500), gstin, state: optionalText(60), notes: optionalText(1000),
  /** a plain group for sorting customers (no prices attached) */
  customerGroupId: optionalId,
  isActive: z.boolean().default(true),
});

/** A plain way to sort customers. */
export const customerGroupSchema = z.object({
  name: nameField, code: codeField, description: optionalText(500),
  isActive: z.boolean().default(true),
});

/** A price list dealer (dealer, branch, retail...): its margin is added on top of cost, like the costing markup % (no upper limit). */
export const priceListDealerSchema = z.object({
  name: nameField, code: codeField, description: optionalText(500),
  marginPercent: nonNegativeDecimal.default('0'),
  isActive: z.boolean().default(true),
});

export const QUOTATION_SOURCES = ['MANUAL', 'COSTING', 'PRICE_LIST'] as const;
export const QUOTATION_STATUSES = ['DRAFT', 'PENDING', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONVERTED'] as const;

export const quotationItemSchema = z.object({
  source: z.enum(QUOTATION_SOURCES).default('MANUAL'),
  costingId: optionalId,
  priceListItemId: optionalId,
  /** COSTING lines: profit % added to the costing's cost before GST (blank = the costing's own markup %) */
  profitPercent: optional(nonNegativeDecimal),
  productName: optional(z.string().trim().min(1).max(160)),
  productCode: optionalText(40),
  description: optionalText(500),
  quantity: positiveDecimal,
  unitId: optionalId,
  unitLabel: optionalText(20),
  /** MANUAL lines only; other sources are priced by the server */
  unitPrice: optionalDecimal,
  discountPercent: optional(pct),
  discountAmount: optionalDecimal,
  /** blank = taken from the source (costing GST %); required for manual lines */
  gstPercent: optional(pct),
}).superRefine((i, ctx) => {
  if (i.source === 'MANUAL') {
    if (!i.productName) ctx.addIssue({ code: 'custom', path: ['productName'], message: 'Enter the product / item name' });
    if (!i.unitPrice) ctx.addIssue({ code: 'custom', path: ['unitPrice'], message: 'Enter the unit price' });
    if (!i.gstPercent) ctx.addIssue({ code: 'custom', path: ['gstPercent'], message: 'Enter the GST %' });
  }
  if (i.source === 'COSTING' && !i.costingId) ctx.addIssue({ code: 'custom', path: ['costingId'], message: 'Select a costing' });
  if (i.source === 'PRICE_LIST' && !i.priceListItemId) ctx.addIssue({ code: 'custom', path: ['priceListItemId'], message: 'Select a price list item' });
  if (i.discountPercent && i.discountAmount) ctx.addIssue({ code: 'custom', path: ['discountAmount'], message: 'Use a discount % or an amount, not both' });
});

export const quotationSchema = z.object({
  customerId: optionalId,
  customerName: nameField,
  customerMobile: optionalText(30),
  customerEmail: optional(z.string().trim().email('Invalid email')),
  customerAddress: optionalText(500),
  customerGstin: gstin,
  customerState: optionalText(60),
  quotationDate: isoDate,
  validityDays: z.coerce.number().int().min(1).max(730).default(30),
  subject: optionalText(200),
  terms: optionalText(4000),
  notes: optionalText(2000),
  discountPercent: optional(pct),
  discountAmount: optionalDecimal,
  roundGrandTotal: z.boolean().default(false),
  items: z.array(quotationItemSchema).min(1, 'Add at least one product').max(200),
}).superRefine((q, ctx) => {
  if (q.discountPercent && q.discountAmount) ctx.addIssue({ code: 'custom', path: ['discountAmount'], message: 'Use a discount % or an amount, not both' });
});
export type QuotationPayload = z.infer<typeof quotationSchema>;

export const quotationActionSchema = z.object({ reason: optionalText(500), reference: optionalText(80) });
export const quotationShareSchema = z.object({ days: z.coerce.number().int().min(1).max(365).optional() });
