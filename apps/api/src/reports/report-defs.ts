import { BadRequestException } from '@nestjs/common';
import { computeRateStats, d, Decimal } from '@costing/costing-engine';
import type { PrismaService } from '../prisma/prisma.service';

export type ColType = 'text' | 'money' | 'qty' | 'percent' | 'date' | 'int';
export interface ReportColumn { key: string; header: string; type: ColType; width: number; /** add a SUM total for this column */ total?: boolean }
export type FilterKey = 'from' | 'to' | 'product' | 'typeId' | 'groupId' | 'supplierId' | 'itemId' | 'status';
export interface Filters { from?: string; to?: string; product?: string; typeId?: string; groupId?: string; supplierId?: string; itemId?: string; status?: string }
export type Row = Record<string, string | number | null>;

export interface ReportResult { rows: Row[]; /** extra figures shown above the table */ summary?: { label: string; value: string }[] }
export interface ReportDef {
  id: string;
  title: string;
  /** navigation group (matches the Reports menu) */
  group: 'Costing Reports' | 'Material Reports' | 'Labour Reports' | 'Supplier Reports' | 'Profit Reports' | 'Quotation Reports';
  description: string;
  /** permissions needed besides reports:view */
  needs: string[];
  filters: FilterKey[];
  /** which status values the status filter offers */
  statuses?: 'costing' | 'quotation';
  columns: ReportColumn[];
  run(ctx: { prisma: PrismaService }, f: Filters): Promise<ReportResult>;
}

export const MAX_SOURCE_ROWS = 100_000;
const money = (x: Decimal | string | number | null | undefined) => (x === null || x === undefined ? null : d(x.toString()).toFixed(2));
const qty = (x: Decimal) => x.toDecimalPlaces(4).toString();
const pct = (x: Decimal) => x.toFixed(2);
const day = (x: Date) => x.toISOString().slice(0, 10);
const ZERO = () => d(0);
const sum = <T>(xs: T[], f: (x: T) => Decimal) => xs.reduce((s, x) => s.plus(f(x)), ZERO());
const dec = (v: unknown) => d(String(v ?? 0));
const ratio = (n: Decimal, dn: Decimal) => (dn.isZero() ? ZERO() : n.div(dn).times(100));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COSTING_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'];
export const QUOTATION_STATUSES = ['DRAFT', 'PENDING', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONVERTED'];

/** Validates raw query-string filters; anything malformed is a 400 rather than silently ignored. */
export function parseFilters(q: Record<string, unknown>, allowed: FilterKey[], statuses?: string[]): Filters {
  const out: Filters = {};
  for (const k of allowed) {
    const v = typeof q[k] === 'string' ? (q[k] as string).trim() : '';
    if (!v) continue;
    if ((k === 'from' || k === 'to') && !(DATE.test(v) && !Number.isNaN(Date.parse(v)))) throw new BadRequestException(`${k} must be a date (YYYY-MM-DD)`);
    if (['typeId', 'groupId', 'supplierId', 'itemId'].includes(k) && !UUID.test(v)) throw new BadRequestException(`${k} is not a valid id`);
    if (k === 'status' && !(statuses ?? []).includes(v)) throw new BadRequestException(`status must be one of: ${(statuses ?? []).join(', ')}`);
    out[k] = v.slice(0, 80) as never;
  }
  if (out.from && out.to && out.from > out.to) throw new BadRequestException('"From" date is after the "To" date');
  return out;
}

const dateRange = (f: Filters, field = 'costingDate') => (f.from || f.to ? { [field]: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00.000Z`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999Z`) } : {}) } } : {});
const productOr = (f: Filters, prefix = '') => (f.product ? { OR: [{ [`${prefix}productName`]: { contains: f.product, mode: 'insensitive' } }, { [`${prefix}productCode`]: { contains: f.product, mode: 'insensitive' } }] } : {});
const costingWhere = (f: Filters) => ({ deletedAt: null, ...dateRange(f), ...(f.typeId ? { typeId: f.typeId } : {}), ...(f.status ? { status: f.status as never } : {}), ...productOr(f) });

function guard<T>(rows: T[]): T[] {
  if (rows.length > MAX_SOURCE_ROWS) throw new BadRequestException('This report covers too many records. Narrow it with the date or other filters.');
  return rows;
}

const COSTING_FIELDS = { id: true, costingNumber: true, productName: true, productCode: true, costingDate: true, status: true, version: true, quantity: true, materialCost: true, labourCost: true, expenseCost: true, basicCost: true, gstAmount: true, totalCostInclGst: true, sellingPrice: true, profitAmount: true, profitPercent: true, markupPercent: true, netSellingPrice: true, netBasicRate: true, createdAt: true, type: { select: { name: true } } } as const;

// ───────────────────────── definitions ─────────────────────────

const productCosting: ReportDef = {
  id: 'product-costing', title: 'Product-wise Costing Report', group: 'Costing Reports', needs: ['costing:view'],
  description: 'One row per product: how many costings exist, the latest costing and the range of selling prices.',
  filters: ['from', 'to', 'product', 'typeId', 'status'], statuses: 'costing',
  columns: [
    { key: 'product', header: 'Product', type: 'text', width: 26 }, { key: 'code', header: 'Code', type: 'text', width: 12 }, { key: 'type', header: 'Type', type: 'text', width: 14 },
    { key: 'costings', header: 'Costings', type: 'int', width: 9, total: true }, { key: 'latestNumber', header: 'Latest costing', type: 'text', width: 16 }, { key: 'latestDate', header: 'Date', type: 'date', width: 11 },
    { key: 'latestStatus', header: 'Status', type: 'text', width: 14 }, { key: 'latestBasic', header: 'Basic cost', type: 'money', width: 13 }, { key: 'latestSelling', header: 'Selling price', type: 'money', width: 13 },
    { key: 'minSelling', header: 'Min selling', type: 'money', width: 13 }, { key: 'maxSelling', header: 'Max selling', type: 'money', width: 13 }, { key: 'avgProfit', header: 'Avg profit %', type: 'percent', width: 11 },
  ],
  async run({ prisma }, f) {
    const rows = guard(await prisma.costing.findMany({ where: costingWhere(f), select: COSTING_FIELDS, orderBy: [{ costingDate: 'desc' }, { createdAt: 'desc' }] }));
    const byProduct = new Map<string, typeof rows>();
    for (const r of rows) { const k = (r.productCode || r.productName).toLowerCase(); byProduct.set(k, [...(byProduct.get(k) ?? []), r]); }
    const out: Row[] = [...byProduct.values()].map((list) => {
      const latest = list[0]; // already newest first
      const sells = list.map((c) => dec(c.sellingPrice));
      return {
        product: latest.productName, code: latest.productCode, type: latest.type.name, costings: list.length, latestNumber: latest.costingNumber, latestDate: day(latest.costingDate), latestStatus: latest.status.replace('_', ' ').toLowerCase(),
        latestBasic: money(latest.basicCost), latestSelling: money(latest.sellingPrice), minSelling: money(Decimal.min(...sells)), maxSelling: money(Decimal.max(...sells)), avgProfit: pct(sum(list, (c) => dec(c.profitPercent)).div(list.length)),
      };
    }).sort((a, b) => String(a.product).localeCompare(String(b.product)));
    return { rows: out };
  },
};

const typeCosting: ReportDef = {
  id: 'type-costing', title: 'Type-wise Costing Report', group: 'Costing Reports', needs: ['costing:view'],
  description: 'Costing totals for each product type: material, labour, expenses, GST, selling value and average profit.',
  filters: ['from', 'to', 'typeId', 'status'], statuses: 'costing',
  columns: [
    { key: 'type', header: 'Type', type: 'text', width: 22 }, { key: 'costings', header: 'Costings', type: 'int', width: 9, total: true }, { key: 'material', header: 'Material', type: 'money', width: 14, total: true },
    { key: 'labour', header: 'Labour', type: 'money', width: 14, total: true }, { key: 'expenses', header: 'Expenses', type: 'money', width: 14, total: true }, { key: 'basic', header: 'Basic cost', type: 'money', width: 14, total: true },
    { key: 'gst', header: 'GST', type: 'money', width: 13, total: true }, { key: 'selling', header: 'Selling value', type: 'money', width: 15, total: true }, { key: 'avgProfit', header: 'Avg profit %', type: 'percent', width: 11 },
  ],
  async run({ prisma }, f) {
    const rows = guard(await prisma.costing.findMany({ where: costingWhere(f), select: COSTING_FIELDS }));
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.type.name, [...(by.get(r.type.name) ?? []), r]);
    return { rows: [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, l]) => ({
      type, costings: l.length, material: money(sum(l, (c) => dec(c.materialCost))), labour: money(sum(l, (c) => dec(c.labourCost))), expenses: money(sum(l, (c) => dec(c.expenseCost))),
      basic: money(sum(l, (c) => dec(c.basicCost))), gst: money(sum(l, (c) => dec(c.gstAmount))), selling: money(sum(l, (c) => dec(c.sellingPrice))), avgProfit: pct(sum(l, (c) => dec(c.profitPercent)).div(l.length)),
    })) };
  },
};

const groupMaterial: ReportDef = {
  id: 'group-material', title: 'Group-wise Material Cost Report', group: 'Material Reports', needs: ['costing:view'],
  description: 'Material cost by item group and category across costings, with the wastage share and each category\'s share of the total.',
  filters: ['from', 'to', 'product', 'typeId', 'groupId', 'status'], statuses: 'costing',
  columns: [
    { key: 'group', header: 'Group', type: 'text', width: 20 }, { key: 'category', header: 'Category', type: 'text', width: 22 }, { key: 'lines', header: 'Material lines', type: 'int', width: 11, total: true },
    { key: 'cost', header: 'Material cost', type: 'money', width: 16, total: true }, { key: 'wastage', header: 'Of which wastage', type: 'money', width: 16, total: true }, { key: 'share', header: 'Share of total %', type: 'percent', width: 13 },
  ],
  async run({ prisma }, f) {
    const lines = guard(await prisma.costingMaterial.findMany({
      where: { costingCategory: { costingGroup: { ...(f.groupId ? { groupId: f.groupId } : {}), costing: costingWhere(f) } } },
      select: { total: true, quantity: true, effectiveQuantity: true, costingCategory: { select: { category: { select: { name: true } }, costingGroup: { select: { group: { select: { name: true } } } } } } },
      take: MAX_SOURCE_ROWS + 1,
    }));
    const by = new Map<string, { group: string; category: string; cost: Decimal; wastage: Decimal; lines: number }>();
    for (const l of lines) {
      const group = l.costingCategory.costingGroup.group.name, category = l.costingCategory.category.name, k = `${group}\u0000${category}`;
      const total = dec(l.total), eff = dec(l.effectiveQuantity);
      const waste = eff.isZero() ? ZERO() : total.times(eff.minus(dec(l.quantity))).div(eff); // wastage share of the line cost
      const e = by.get(k) ?? { group, category, cost: ZERO(), wastage: ZERO(), lines: 0 };
      by.set(k, { ...e, cost: e.cost.plus(total), wastage: e.wastage.plus(waste), lines: e.lines + 1 });
    }
    const grand = sum([...by.values()], (e) => e.cost);
    return { rows: [...by.values()].sort((a, b) => a.group.localeCompare(b.group) || a.category.localeCompare(b.category)).map((e) => ({ group: e.group, category: e.category, lines: e.lines, cost: money(e.cost), wastage: money(e.wastage), share: pct(ratio(e.cost, grand)) })) };
  },
};

const itemRate: ReportDef = {
  id: 'item-purchase-rate', title: 'Item-wise Purchase Rate Report', group: 'Material Reports', needs: ['purchase_rates:view'],
  description: 'For each item: purchases in the period, minimum, maximum, average and weighted-average rate (per base unit) and the current rate.',
  filters: ['from', 'to', 'itemId', 'supplierId'],
  columns: [
    { key: 'code', header: 'Code', type: 'text', width: 12 }, { key: 'item', header: 'Item', type: 'text', width: 26 }, { key: 'unit', header: 'Base unit', type: 'text', width: 9 }, { key: 'purchases', header: 'Purchases', type: 'int', width: 10, total: true },
    { key: 'min', header: 'Min rate', type: 'money', width: 12 }, { key: 'max', header: 'Max rate', type: 'money', width: 12 }, { key: 'avg', header: 'Average', type: 'money', width: 12 }, { key: 'weighted', header: 'Weighted avg', type: 'money', width: 13 },
    { key: 'last', header: 'Last rate', type: 'money', width: 12 }, { key: 'lastDate', header: 'Last purchase', type: 'date', width: 13 }, { key: 'current', header: 'Current rate', type: 'money', width: 13 },
  ],
  async run({ prisma }, f) {
    const entries = guard(await prisma.purchaseRate.findMany({
      where: { deletedAt: null, ...dateRange(f, 'purchaseDate'), ...(f.itemId ? { itemId: f.itemId } : {}), ...(f.supplierId ? { supplierId: f.supplierId } : {}) },
      orderBy: [{ purchaseDate: 'asc' }, { createdAt: 'asc' }], select: { itemId: true, baseRate: true, baseQuantity: true, purchaseDate: true },
      take: MAX_SOURCE_ROWS + 1,
    }));
    const by = new Map<string, typeof entries>();
    for (const e of entries) by.set(e.itemId, [...(by.get(e.itemId) ?? []), e]);
    const items = await prisma.item.findMany({ where: { id: { in: [...by.keys()] } }, select: { id: true, code: true, name: true, defaultPurchaseRate: true, unit: { select: { symbol: true } } } });
    return { rows: items.sort((a, b) => a.name.localeCompare(b.name)).map((it) => {
      const list = by.get(it.id)!;
      const st = computeRateStats(list.map((e) => ({ baseRate: e.baseRate.toString(), baseQuantity: e.baseQuantity.toString(), date: e.purchaseDate })));
      return { code: it.code, item: it.name, unit: it.unit.symbol, purchases: st.count, min: money(st.min), max: money(st.max), avg: money(st.simpleAverage), weighted: money(st.weightedAverage), last: money(st.last), lastDate: day(list[list.length - 1].purchaseDate), current: money(it.defaultPurchaseRate) };
    }) };
  },
};

const supplierRate: ReportDef = {
  id: 'supplier-rate', title: 'Supplier-wise Rate Report', group: 'Supplier Reports', needs: ['purchase_rates:view', 'suppliers:view'],
  description: 'Purchase rates for each supplier and item (per base unit): count, minimum, maximum, average and latest.',
  filters: ['from', 'to', 'supplierId', 'itemId'],
  columns: [
    { key: 'supplier', header: 'Supplier', type: 'text', width: 24 }, { key: 'item', header: 'Item', type: 'text', width: 26 }, { key: 'unit', header: 'Base unit', type: 'text', width: 9 }, { key: 'purchases', header: 'Purchases', type: 'int', width: 10, total: true },
    { key: 'min', header: 'Min rate', type: 'money', width: 12 }, { key: 'max', header: 'Max rate', type: 'money', width: 12 }, { key: 'avg', header: 'Average', type: 'money', width: 12 }, { key: 'last', header: 'Last rate', type: 'money', width: 12 }, { key: 'lastDate', header: 'Last purchase', type: 'date', width: 13 },
  ],
  async run({ prisma }, f) {
    const entries = guard(await prisma.purchaseRate.findMany({
      where: { deletedAt: null, supplierId: f.supplierId ?? { not: null }, ...dateRange(f, 'purchaseDate'), ...(f.itemId ? { itemId: f.itemId } : {}) },
      orderBy: [{ purchaseDate: 'asc' }, { createdAt: 'asc' }],
      select: { supplierId: true, itemId: true, baseRate: true, baseQuantity: true, purchaseDate: true, supplier: { select: { name: true } }, item: { select: { name: true, unit: { select: { symbol: true } } } } },
      take: MAX_SOURCE_ROWS + 1,
    }));
    const by = new Map<string, typeof entries>();
    for (const e of entries) { const k = `${e.supplierId}|${e.itemId}`; by.set(k, [...(by.get(k) ?? []), e]); }
    return { rows: [...by.values()].map((list) => {
      const st = computeRateStats(list.map((e) => ({ baseRate: e.baseRate.toString(), baseQuantity: e.baseQuantity.toString(), date: e.purchaseDate })));
      const first = list[0];
      return { supplier: first.supplier?.name ?? '', item: first.item.name, unit: first.item.unit.symbol, purchases: st.count, min: money(st.min), max: money(st.max), avg: money(st.simpleAverage), last: money(st.last), lastDate: day(list[list.length - 1].purchaseDate) };
    }).sort((a, b) => String(a.supplier).localeCompare(String(b.supplier)) || String(a.item).localeCompare(String(b.item))) };
  },
};

const labourCost: ReportDef = {
  id: 'labour-cost', title: 'Labour Cost Report', group: 'Labour Reports', needs: ['costing:view'],
  description: 'Labour cost by labour type and group across costings: lines, costings, average rate and total.',
  filters: ['from', 'to', 'product', 'typeId', 'groupId', 'status'], statuses: 'costing',
  columns: [
    { key: 'labour', header: 'Labour', type: 'text', width: 26 }, { key: 'group', header: 'Group', type: 'text', width: 18 }, { key: 'lines', header: 'Lines', type: 'int', width: 8, total: true }, { key: 'costings', header: 'Costings', type: 'int', width: 9 },
    { key: 'avgRate', header: 'Avg rate', type: 'money', width: 12 }, { key: 'cost', header: 'Labour cost', type: 'money', width: 15, total: true }, { key: 'share', header: 'Share %', type: 'percent', width: 9 },
  ],
  async run({ prisma }, f) {
    const lines = guard(await prisma.costingLabour.findMany({
      where: { costingGroup: { ...(f.groupId ? { groupId: f.groupId } : {}), costing: costingWhere(f) } },
      select: { rate: true, total: true, labour: { select: { name: true } }, costingGroup: { select: { costingId: true, group: { select: { name: true } } } } }, take: MAX_SOURCE_ROWS + 1,
    }));
    const by = new Map<string, { labour: string; group: string; cost: Decimal; rates: Decimal[]; costings: Set<string> }>();
    for (const l of lines) {
      const k = `${l.labour.name}\u0000${l.costingGroup.group.name}`;
      const e = by.get(k) ?? { labour: l.labour.name, group: l.costingGroup.group.name, cost: ZERO(), rates: [], costings: new Set() };
      e.cost = e.cost.plus(dec(l.total)); e.rates.push(dec(l.rate)); e.costings.add(l.costingGroup.costingId); by.set(k, e);
    }
    const grand = sum([...by.values()], (e) => e.cost);
    return { rows: [...by.values()].sort((a, b) => a.labour.localeCompare(b.labour) || a.group.localeCompare(b.group)).map((e) => ({ labour: e.labour, group: e.group, lines: e.rates.length, costings: e.costings.size, avgRate: money(sum(e.rates, (x) => x).div(e.rates.length)), cost: money(e.cost), share: pct(ratio(e.cost, grand)) })) };
  },
};

const wastage: ReportDef = {
  id: 'wastage', title: 'Wastage Report', group: 'Material Reports', needs: ['costing:view'],
  description: 'Wastage by item: quantity used, wastage quantity and percentage, and the cost of that wastage.',
  filters: ['from', 'to', 'product', 'typeId', 'groupId', 'itemId', 'status'], statuses: 'costing',
  columns: [
    { key: 'group', header: 'Group', type: 'text', width: 16 }, { key: 'item', header: 'Item', type: 'text', width: 26 }, { key: 'unit', header: 'Unit', type: 'text', width: 7 }, { key: 'lines', header: 'Lines', type: 'int', width: 7, total: true },
    { key: 'base', header: 'Qty used', type: 'qty', width: 12 }, { key: 'waste', header: 'Wastage qty', type: 'qty', width: 12 }, { key: 'wastePct', header: 'Wastage %', type: 'percent', width: 10 },
    { key: 'cost', header: 'Material cost', type: 'money', width: 14, total: true }, { key: 'wasteCost', header: 'Wastage cost', type: 'money', width: 14, total: true },
  ],
  async run({ prisma }, f) {
    const lines = guard(await prisma.costingMaterial.findMany({
      where: { ...(f.itemId ? { itemId: f.itemId } : {}), costingCategory: { costingGroup: { ...(f.groupId ? { groupId: f.groupId } : {}), costing: costingWhere(f) } } },
      select: { quantity: true, effectiveQuantity: true, total: true, unitId: true, item: { select: { name: true } }, costingCategory: { select: { costingGroup: { select: { group: { select: { name: true } } } } } } }, take: MAX_SOURCE_ROWS + 1,
    }));
    const units = new Map((await prisma.unit.findMany({ select: { id: true, symbol: true } })).map((u) => [u.id, u.symbol]));
    const by = new Map<string, { group: string; item: string; unit: string; base: Decimal; eff: Decimal; cost: Decimal; wasteCost: Decimal; lines: number }>();
    for (const l of lines) {
      const group = l.costingCategory.costingGroup.group.name, k = `${group}\u0000${l.item.name}\u0000${l.unitId}`;
      const eff = dec(l.effectiveQuantity), base = dec(l.quantity), total = dec(l.total);
      const e = by.get(k) ?? { group, item: l.item.name, unit: units.get(l.unitId) ?? '', base: ZERO(), eff: ZERO(), cost: ZERO(), wasteCost: ZERO(), lines: 0 };
      by.set(k, { ...e, base: e.base.plus(base), eff: e.eff.plus(eff), cost: e.cost.plus(total), wasteCost: e.wasteCost.plus(eff.isZero() ? ZERO() : total.times(eff.minus(base)).div(eff)), lines: e.lines + 1 });
    }
    return { rows: [...by.values()].filter((e) => e.eff.gt(e.base)).sort((a, b) => b.wasteCost.comparedTo(a.wasteCost)).map((e) => ({
      group: e.group, item: e.item, unit: e.unit, lines: e.lines, base: qty(e.base), waste: qty(e.eff.minus(e.base)), wastePct: pct(ratio(e.eff.minus(e.base), e.base)), cost: money(e.cost), wasteCost: money(e.wasteCost),
    })) };
  },
};

const profit: ReportDef = {
  id: 'profit', title: 'Profit Report', group: 'Profit Reports', needs: ['costing:view'],
  description: 'Cost, selling price and profit for every costing, highest profit % first.',
  filters: ['from', 'to', 'product', 'typeId', 'status'], statuses: 'costing',
  columns: [
    { key: 'number', header: 'Costing', type: 'text', width: 16 }, { key: 'product', header: 'Product', type: 'text', width: 24 }, { key: 'type', header: 'Type', type: 'text', width: 13 }, { key: 'date', header: 'Date', type: 'date', width: 11 }, { key: 'status', header: 'Status', type: 'text', width: 13 },
    { key: 'basic', header: 'Basic cost', type: 'money', width: 13, total: true }, { key: 'total', header: 'Cost incl. GST', type: 'money', width: 14, total: true }, { key: 'selling', header: 'Selling price', type: 'money', width: 14, total: true },
    { key: 'profit', header: 'Profit', type: 'money', width: 13, total: true }, { key: 'profitPct', header: 'Profit %', type: 'percent', width: 10 },
  ],
  async run({ prisma }, f) {
    const rows = guard(await prisma.costing.findMany({ where: costingWhere(f), select: COSTING_FIELDS }));
    const out = rows.sort((a, b) => dec(b.profitPercent).comparedTo(dec(a.profitPercent))).map((c) => ({
      number: c.costingNumber, product: c.productName, type: c.type.name, date: day(c.costingDate), status: c.status.replace('_', ' ').toLowerCase(),
      basic: money(c.basicCost), total: money(c.totalCostInclGst), selling: money(c.sellingPrice), profit: money(c.profitAmount), profitPct: pct(dec(c.profitPercent)),
    }));
    const totalProfit = sum(rows, (c) => dec(c.profitAmount)), totalBasic = sum(rows, (c) => dec(c.basicCost));
    return { rows: out, summary: [{ label: 'Total profit', value: money(totalProfit)! }, { label: 'Overall profit % of basic cost', value: `${pct(ratio(totalProfit, totalBasic))}%` }] };
  },
};

const sellingPrice: ReportDef = {
  id: 'selling-price', title: 'Selling Price Report', group: 'Profit Reports', needs: ['costing:view'],
  description: 'Per product: the costing\'s selling price per unit, the price in active price lists and the latest quoted unit price.',
  filters: ['from', 'to', 'product', 'typeId', 'status'], statuses: 'costing',
  columns: [
    { key: 'number', header: 'Costing', type: 'text', width: 16 }, { key: 'product', header: 'Product', type: 'text', width: 24 }, { key: 'status', header: 'Status', type: 'text', width: 13 }, { key: 'quantity', header: 'Qty', type: 'qty', width: 8 },
    { key: 'costSelling', header: 'Selling price', type: 'money', width: 14 }, { key: 'perUnit', header: 'Per unit (incl. GST)', type: 'money', width: 16 },
    { key: 'priceList', header: 'Active price list', type: 'text', width: 20 }, { key: 'listPrice', header: 'List price (excl. GST)', type: 'money', width: 16 },
    { key: 'quote', header: 'Last quotation', type: 'text', width: 16 }, { key: 'quotePrice', header: 'Quoted unit price', type: 'money', width: 15 },
  ],
  async run({ prisma }, f) {
    const costings = guard(await prisma.costing.findMany({ where: costingWhere(f), select: COSTING_FIELDS, orderBy: [{ productName: 'asc' }, { costingDate: 'desc' }] }));
    const ids = costings.map((c) => c.id);
    const [lists, quoted] = await Promise.all([
      prisma.priceListItem.findMany({ where: { costingId: { in: ids }, priceList: { status: 'ACTIVE', deletedAt: null } }, select: { costingId: true, effectiveExGst: true, priceList: { select: { name: true, number: true } } } }),
      prisma.quotationItem.findMany({ where: { costingId: { in: ids }, quotation: { deletedAt: null } }, select: { costingId: true, unitPrice: true, quotation: { select: { number: true, quotationDate: true, createdAt: true } } } }),
    ]);
    const listBy = new Map<string, (typeof lists)[number]>(); lists.forEach((l) => { if (!listBy.has(l.costingId)) listBy.set(l.costingId, l); });
    const quoteBy = new Map<string, (typeof quoted)[number]>();
    quoted.sort((a, b) => +b.quotation.quotationDate - +a.quotation.quotationDate || +b.quotation.createdAt - +a.quotation.createdAt).forEach((q) => { if (q.costingId && !quoteBy.has(q.costingId)) quoteBy.set(q.costingId, q); });
    return { rows: costings.map((c) => {
      const pl = listBy.get(c.id), qt = quoteBy.get(c.id);
      return { number: c.costingNumber, product: c.productName, status: c.status.replace('_', ' ').toLowerCase(), quantity: qty(dec(c.quantity)), costSelling: money(c.sellingPrice), perUnit: money(c.netSellingPrice),
        priceList: pl ? `${pl.priceList.number}` : null, listPrice: pl ? money(pl.effectiveExGst) : null, quote: qt ? qt.quotation.number : null, quotePrice: qt ? money(qt.unitPrice) : null };
    }) };
  },
};

const quotationReport: ReportDef = {
  id: 'quotation', title: 'Quotation Report', group: 'Quotation Reports', needs: ['quotations:view'],
  description: 'Every quotation with customer, status and totals, plus counts and values by status.',
  filters: ['from', 'to', 'status', 'product'], statuses: 'quotation',
  columns: [
    { key: 'number', header: 'Quotation', type: 'text', width: 16 }, { key: 'date', header: 'Date', type: 'date', width: 11 }, { key: 'valid', header: 'Valid until', type: 'date', width: 11 }, { key: 'customer', header: 'Customer', type: 'text', width: 24 },
    { key: 'status', header: 'Status', type: 'text', width: 11 }, { key: 'taxable', header: 'Taxable', type: 'money', width: 14, total: true }, { key: 'gst', header: 'GST', type: 'money', width: 13, total: true }, { key: 'total', header: 'Grand total', type: 'money', width: 15, total: true }, { key: 'by', header: 'Prepared by', type: 'text', width: 16 },
  ],
  async run({ prisma }, f) {
    const where = { deletedAt: null, ...dateRange(f, 'quotationDate'), ...(f.status ? { status: f.status as never } : {}), ...(f.product ? { items: { some: { OR: [{ productName: { contains: f.product, mode: 'insensitive' as const } }, { productCode: { contains: f.product, mode: 'insensitive' as const } }] } } } : {}) };
    const rows = guard(await prisma.quotation.findMany({ where, orderBy: [{ quotationDate: 'desc' }, { createdAt: 'desc' }], select: { number: true, quotationDate: true, validUntil: true, customerName: true, status: true, taxableAmount: true, gstAmount: true, grandTotal: true, preparedBy: { select: { name: true } } } }));
    const byStatus = new Map<string, { n: number; v: Decimal }>();
    rows.forEach((r) => { const e = byStatus.get(r.status) ?? { n: 0, v: ZERO() }; byStatus.set(r.status, { n: e.n + 1, v: e.v.plus(dec(r.grandTotal)) }); });
    return {
      rows: rows.map((r) => ({ number: r.number, date: day(r.quotationDate), valid: day(r.validUntil), customer: r.customerName, status: r.status.toLowerCase(), taxable: money(r.taxableAmount), gst: money(r.gstAmount), total: money(r.grandTotal), by: r.preparedBy.name })),
      summary: [...byStatus.entries()].map(([s, e]) => ({ label: s.charAt(0) + s.slice(1).toLowerCase(), value: `${e.n} · ${money(e.v)}` })),
    };
  },
};

const rateImpact: ReportDef = {
  id: 'rate-change-impact', title: 'Rate Change Impact Report', group: 'Supplier Reports', needs: ['purchase_rates:view'],
  description: 'Every change to an item\'s current rate: old and new rate, size of the change, source, who made it and how many live records it affected.',
  filters: ['from', 'to', 'itemId'],
  columns: [
    { key: 'when', header: 'When', type: 'text', width: 17 }, { key: 'code', header: 'Code', type: 'text', width: 11 }, { key: 'item', header: 'Item', type: 'text', width: 24 }, { key: 'oldRate', header: 'Old rate', type: 'money', width: 12 }, { key: 'newRate', header: 'New rate', type: 'money', width: 12 },
    { key: 'change', header: 'Change %', type: 'percent', width: 10 }, { key: 'source', header: 'Source', type: 'text', width: 14 }, { key: 'by', header: 'By', type: 'text', width: 16 }, { key: 'affected', header: 'Records affected', type: 'int', width: 11, total: true }, { key: 'reason', header: 'Reason', type: 'text', width: 24 },
  ],
  async run({ prisma }, f) {
    const rows = guard(await prisma.purchaseRateHistory.findMany({
      where: { ...dateRange(f, 'changedAt'), ...(f.itemId ? { itemId: f.itemId } : {}) }, orderBy: { changedAt: 'desc' },
      select: { changedAt: true, oldRate: true, newRate: true, source: true, reason: true, impact: true, changedBy: true, item: { select: { code: true, name: true } } }, take: MAX_SOURCE_ROWS + 1,
    }));
    const ids = [...new Set(rows.map((r) => r.changedBy).filter((x): x is string => !!x))];
    const users = new Map((ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
    return { rows: rows.map((r) => ({
      when: r.changedAt.toISOString().slice(0, 16).replace('T', ' '), code: r.item.code, item: r.item.name, oldRate: money(r.oldRate), newRate: money(r.newRate),
      change: dec(r.oldRate).isZero() ? null : pct(ratio(dec(r.newRate).minus(dec(r.oldRate)), dec(r.oldRate))), source: r.source.replace('_', ' ').toLowerCase(), by: r.changedBy ? (users.get(r.changedBy) ?? '') : '',
      affected: Number((r.impact as { total?: number } | null)?.total ?? 0), reason: r.reason,
    })) };
  },
};

const costingHistory: ReportDef = {
  id: 'costing-history', title: 'Costing History Report', group: 'Costing Reports', needs: ['costing:view'],
  description: 'Every saved version of every costing: when it changed, by whom, its status and selling price at that moment.',
  filters: ['from', 'to', 'product', 'status'], statuses: 'costing',
  columns: [
    { key: 'number', header: 'Costing', type: 'text', width: 16 }, { key: 'product', header: 'Product', type: 'text', width: 24 }, { key: 'version', header: 'Version', type: 'int', width: 8 }, { key: 'when', header: 'When', type: 'text', width: 17 },
    { key: 'by', header: 'By', type: 'text', width: 16 }, { key: 'status', header: 'Status', type: 'text', width: 14 }, { key: 'basic', header: 'Basic cost', type: 'money', width: 13 }, { key: 'selling', header: 'Selling price', type: 'money', width: 14 }, { key: 'note', header: 'Note', type: 'text', width: 28 },
  ],
  async run({ prisma }, f) {
    const rows = guard(await prisma.costingRevision.findMany({
      where: { ...dateRange(f, 'createdAt'), costing: { deletedAt: null, ...productOr(f) } }, orderBy: [{ createdAt: 'desc' }],
      select: { version: true, note: true, createdAt: true, createdBy: true, snapshot: true, costing: { select: { costingNumber: true, productName: true } } }, take: MAX_SOURCE_ROWS + 1,
    }));
    const ids = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))];
    const users = new Map((ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
    const snap = (r: (typeof rows)[number]) => r.snapshot as { status?: string; totals?: { basicCost?: string; sellingPrice?: string } };
    return { rows: rows.filter((r) => !f.status || snap(r).status === f.status).map((r) => ({
      number: r.costing.costingNumber, product: r.costing.productName, version: r.version, when: r.createdAt.toISOString().slice(0, 16).replace('T', ' '), by: r.createdBy ? (users.get(r.createdBy) ?? '') : '',
      status: (snap(r).status ?? '').replace('_', ' ').toLowerCase(), basic: money(snap(r).totals?.basicCost), selling: money(snap(r).totals?.sellingPrice), note: r.note,
    })) };
  },
};

export const REPORTS: ReportDef[] = [productCosting, typeCosting, costingHistory, groupMaterial, wastage, itemRate, labourCost, supplierRate, rateImpact, profit, sellingPrice, quotationReport];
export const reportOf = (id: string) => REPORTS.find((r) => r.id === id);
