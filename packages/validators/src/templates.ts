import { z } from 'zod';
import { codeField, nameField, nonNegativeDecimal, optional, optionalDecimal, optionalId, optionalText, positiveDecimal } from './common';
import { EXPENSE_CALC_METHODS } from './masters';

const percent = nonNegativeDecimal.refine((v) => Number(v) <= 100, 'Max 100');
const optionalPercent = optional(percent);

export const templateItemSchema = z.object({
  itemId: z.string().uuid('Select an item'),
  quantity: positiveDecimal,
  unitId: z.string().uuid('Select a unit'),
  wastagePercent: optionalPercent,
  notes: optionalText(255),
});

export const templateCategorySchema = z.object({
  categoryId: z.string().uuid('Select a category'),
  wastagePercent: optionalPercent,
  items: z.array(templateItemSchema).max(300, 'Too many items in one category').default([]),
});

export const templateLabourSchema = z.object({
  labourId: z.string().uuid('Select labour'),
  quantity: positiveDecimal.default('1'),
  unitId: optionalId,
  rate: optionalDecimal,
});

export const templateGroupSchema = z.object({
  groupId: z.string().uuid('Select a group'),
  wastagePercent: optionalPercent,
  categories: z.array(templateCategorySchema).max(50, 'Too many categories in one group').default([]),
  labour: z.array(templateLabourSchema).max(100, 'Too many labour rows in one group').default([]),
});

export const templateExpenseSchema = z.object({
  expenseId: z.string().uuid('Select an expense'),
  /** master group id; blank = whole product */
  groupId: optionalId,
  calculationMethod: optional(z.enum(EXPENSE_CALC_METHODS)),
  value: optionalDecimal,
});

export const TEMPLATE_EDITABLE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const TEMPLATE_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;

export const templateSchema = z.object({
  name: nameField,
  code: codeField,
  typeId: z.string().uuid('Select a type'),
  description: optionalText(1000),
  wastagePercent: percent.default('0'),
  gstPercent: percent.default('0'),
  markupPercent: nonNegativeDecimal.default('0'),
  status: z.enum(TEMPLATE_EDITABLE_STATUSES).default('ACTIVE'),
  groups: z.array(templateGroupSchema).max(50, 'Too many groups').default([]),
  expenses: z.array(templateExpenseSchema).max(100, 'Too many expenses').default([]),
}).superRefine((t, ctx) => {
  const dupes = (ids: string[]) => new Set(ids).size !== ids.length;
  if (dupes(t.groups.map((g) => g.groupId))) ctx.addIssue({ code: 'custom', path: ['groups'], message: 'Each group can be added once' });
  const groupIds = new Set(t.groups.map((g) => g.groupId));
  t.groups.forEach((g, gi) => {
    if (dupes(g.categories.map((c) => c.categoryId))) ctx.addIssue({ code: 'custom', path: ['groups', gi, 'categories'], message: 'Each category can be added once per group' });
    g.categories.forEach((c, ci) => {
      if (dupes(c.items.map((i) => i.itemId))) ctx.addIssue({ code: 'custom', path: ['groups', gi, 'categories', ci, 'items'], message: 'Each item can be added once per category' });
    });
  });
  t.expenses.forEach((e, i) => {
    if (e.groupId && !groupIds.has(e.groupId)) ctx.addIssue({ code: 'custom', path: ['expenses', i, 'groupId'], message: 'Group is not part of this template' });
    if (e.calculationMethod === 'PERCENTAGE' && e.value && Number(e.value) > 100) ctx.addIssue({ code: 'custom', path: ['expenses', i, 'value'], message: 'Percentage cannot exceed 100' });
  });
});

export type TemplateInput = z.infer<typeof templateSchema>;

export const duplicateTemplateSchema = z.object({ name: nameField, code: codeField });
export const templateStatusSchema = z.object({ status: z.enum(TEMPLATE_STATUSES) });
