import { z } from 'zod';

export const decimalString = z.string().trim().regex(/^-?\d+(\.\d+)?$/, 'Must be a number');
export const positiveDecimal = decimalString.refine((v) => Number(v) > 0, 'Must be greater than 0');
export const nonNegativeDecimal = decimalString.refine((v) => Number(v) >= 0, 'Must be 0 or more');

/** Forms submit '' for blank inputs; treat that as "not provided". */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
export const optional = <T extends z.ZodTypeAny>(s: T) => z.preprocess(blankToUndefined, s.optional());
export const optionalText = (max = 255) => optional(z.string().trim().max(max));
export const optionalId = optional(z.string().uuid());
export const optionalDecimal = optional(nonNegativeDecimal);

export const codeField = z.string().trim().min(1, 'Required').max(30).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, . _ - only');
export const nameField = z.string().trim().min(1, 'Required').max(120);

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;
