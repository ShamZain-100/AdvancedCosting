import { z } from 'zod';
import { nonNegativeDecimal, optionalId } from './common';

// ───────────────────────── document number formats ─────────────────────────

export const NUMBER_RESETS = ['YEARLY', 'FINANCIAL_YEAR', 'NEVER'] as const;
export type NumberReset = (typeof NUMBER_RESETS)[number];

const TOKEN = /\{(YYYY|YY|MM|FY|SEQ(?::(\d{1,2}))?)\}/g;
export const MAX_NUMBER_LENGTH = 40;

/**
 * Formats are text with tokens: {YYYY} calendar year, {YY} two-digit year, {MM} month, {FY} financial year (2026-27),
 * and exactly one {SEQ} / {SEQ:4} running number (zero-padded to the given width).
 * Returns a message when the format is not acceptable, otherwise null.
 */
export function validateNumberFormat(format: string): string | null {
  const f = format.trim();
  if (f.length < 3 || f.length > 30) return 'Use 3 to 30 characters';
  const seq = [...f.matchAll(/\{SEQ(?::(\d{1,2}))?\}/g)];
  if (seq.length !== 1) return 'Include exactly one {SEQ} (running number), for example {SEQ:4}';
  if (seq[0][1] !== undefined && (Number(seq[0][1]) < 1 || Number(seq[0][1]) > 10)) return '{SEQ:n} needs a width from 1 to 10';
  const literal = f.replace(TOKEN, '');
  if (/[{}]/.test(literal)) return 'Unknown or unfinished {token}. Allowed: {YYYY} {YY} {MM} {FY} {SEQ} {SEQ:n}';
  if (!/^[A-Za-z0-9 _./-]*$/.test(literal)) return 'Besides tokens, use only letters, digits, space and _ . / -';
  return null;
}

/** Financial year containing `date` (UTC). With a January start it is simply the calendar year. */
export function financialYear(date: Date, startMonth: number): { startYear: number; label: string } {
  const y = date.getUTCFullYear();
  const startYear = date.getUTCMonth() + 1 >= startMonth ? y : y - 1;
  return { startYear, label: startMonth === 1 ? String(startYear) : `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}` };
}

export function formatNumber(format: string, o: { date: Date; seq: number; fyStartMonth: number }): string {
  const y = o.date.getUTCFullYear();
  return format.trim().replace(TOKEN, (_all, tok: string, width?: string) => {
    if (tok === 'YYYY') return String(y);
    if (tok === 'YY') return String(y % 100).padStart(2, '0');
    if (tok === 'MM') return String(o.date.getUTCMonth() + 1).padStart(2, '0');
    if (tok === 'FY') return financialYear(o.date, o.fyStartMonth).label;
    return String(o.seq).padStart(width ? Number(width) : 1, '0');
  });
}

/** Counter that a number belongs to. `YEARLY` keeps the pre-settings key (`costing:2026`) so existing counters carry on. */
export function sequenceKey(kind: string, reset: NumberReset, date: Date, fyStartMonth: number): string {
  if (reset === 'NEVER') return `${kind}:all`;
  if (reset === 'FINANCIAL_YEAR') return `${kind}:FY${financialYear(date, fyStartMonth).startYear}`;
  return `${kind}:${date.getUTCFullYear()}`;
}

// ───────────────────────── application settings ─────────────────────────

const percent = nonNegativeDecimal.refine((v) => Number(v) <= 100, 'Max 100');
const numberFormat = z.string().trim().superRefine((v, ctx) => { const m = validateNumberFormat(v); if (m) ctx.addIssue({ code: 'custom', message: m }); });
const numbering = z.object({ format: numberFormat, reset: z.enum(NUMBER_RESETS) }).strict();
const approvalRule = z.object({ required: z.boolean(), allowSelfApproval: z.boolean() }).strict();

export const COSTING_PRINT_MODES = ['detailed', 'summary', 'product', 'materials', 'labour'] as const;

export const appSettingsSchema = z.object({
  /** 1 = January … 12 = December; April for the Indian financial year */
  financialYearStartMonth: z.coerce.number().int().min(1).max(12),
  numbering: z.object({ costing: numbering, quotation: numbering, priceList: numbering }).strict(),
  defaults: z.object({
    gstPercent: percent, wastagePercent: percent, markupPercent: nonNegativeDecimal,
    profitMethod: z.enum(['PERCENT', 'FIXED']), profitValue: nonNegativeDecimal,
    quotationValidityDays: z.coerce.number().int().min(1).max(730),
    quotationTerms: z.string().max(4000),
    unitId: optionalId, dimensionUnitId: optionalId,
  }).strict(),
  print: z.object({ orientation: z.enum(['portrait', 'landscape']), costingMode: z.enum(COSTING_PRINT_MODES) }).strict(),
  approval: z.object({ costing: approvalRule, quotation: approvalRule }).strict(),
}).strict();
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  financialYearStartMonth: 4,
  numbering: {
    costing: { format: 'COST-{YYYY}-{SEQ:4}', reset: 'YEARLY' },
    quotation: { format: 'QTN-{YYYY}-{SEQ:4}', reset: 'YEARLY' },
    priceList: { format: 'PL-{YYYY}-{SEQ:4}', reset: 'YEARLY' },
  },
  defaults: {
    gstPercent: '18', wastagePercent: '0', markupPercent: '0', profitMethod: 'PERCENT', profitValue: '20', quotationValidityDays: 30,
    quotationTerms: '1. Prices are in INR and exclude GST unless stated.\n2. Payment: 50% advance, balance before dispatch.\n3. Delivery within 3 weeks of confirmed order.\n4. This quotation is valid until the date shown above.',
  },
  print: { orientation: 'portrait', costingMode: 'detailed' },
  // Out of the box a costing goes draft → pending → approved, a quotation may be sent without approval, and approvers may approve their own work.
  approval: { costing: { required: true, allowSelfApproval: true }, quotation: { required: false, allowSelfApproval: true } },
};

export const numberingPreviewSchema = z.object({ kind: z.enum(['costing', 'quotation', 'priceList']), format: numberFormat, reset: z.enum(NUMBER_RESETS), financialYearStartMonth: z.coerce.number().int().min(1).max(12).optional() });
