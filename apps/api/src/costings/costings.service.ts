import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  calculateCosting, CalcRules, conversionsWithRules, convertQuantity, CostingInput, CostingInputError, CostingResult, d, IncompatibleUnitsError, RateBasis, resolveMaterialRate,
} from '@costing/costing-engine';
import { costingActionSchema, costingSchema, saveAsTemplateSchema, type CostingInputPayload, type TemplateInput } from '@costing/validators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { parseOrThrow } from '../masters/master.service';
import { RateImpactService } from '../purchase-rates/rate-impact.service';
import { TemplatesService } from '../templates/templates.service';
import { ImagesService } from '../images/images.service';
import { NumberingService } from '../settings/numbering.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../common/decorators';
import { activeConversionRules } from '../common/conversion-rules';
import { CostingSettingsService } from './costing-settings.service';
import { DealerPricesService } from '../dealer-prices/dealer-prices.service';
import { allowedColumns } from '../common/column-access';

type Tx = Prisma.TransactionClient;
const bad = (m: string) => new BadRequestException(m);
const str = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? undefined : v.toString());

const TREE = {
  type: { select: { id: true, name: true } },
  preparedBy: { select: { id: true, name: true } },
  groups: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      categories: { orderBy: { sortOrder: 'asc' as const }, include: { materials: { orderBy: { sortOrder: 'asc' as const } } } },
      labour: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
  expenses: { orderBy: { sortOrder: 'asc' as const }, include: { costingGroup: { select: { groupId: true } }, expense: { select: { name: true, code: true } } } },
} satisfies Prisma.CostingInclude;
type CostingTree = Prisma.CostingGetPayload<{ include: typeof TREE }>;

/** Everything computed for a payload, ready to persist. */
interface Prepared {
  payload: CostingInputPayload;
  rules: CalcRules;
  result: CostingResult;
  /** per-row resolved values keyed like the engine ids */
  materialRows: Map<string, { rate: string; itemGst: string; basis: RateBasis }>;
  labourRows: Map<string, { rate: string; custom: boolean }>;
  expenseRows: Map<string, { method: 'FIXED' | 'PERCENTAGE' | 'QUANTITY_BASED'; value: string; quantity: string; timing: 'BEFORE_GST' | 'AFTER_GST'; overrides: string[] }>;
  /** company expenses the server added to this costing (locked; keys continue after the user's own expense rows) */
  companyRows: { key: string; expenseId: string; name: string; method: 'FIXED' | 'PERCENTAGE' | 'QUANTITY_BASED'; value: string; timing: 'BEFORE_GST' | 'AFTER_GST' }[];
  warnings: string[];
}

const mId = (g: number, c: number, m: number) => `m${g}.${c}.${m}`;
const lId = (g: number, l: number) => `l${g}.${l}`;
const eId = (e: number) => `e${e}`;

@Injectable()
export class CostingsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: CostingSettingsService,
    private readonly templates: TemplatesService,
    private readonly impact: RateImpactService,
    private readonly images: ImagesService,
    private readonly numbering: NumberingService,
    private readonly appSettings: SettingsService,
    @Optional() private readonly dealerPrices?: DealerPricesService,
  ) {}

  /** Tells the rate-change workflow how many live costings an item's rate touches. */
  onModuleInit() {
    this.impact.register({
      label: 'live costing record(s)',
      countAffected: (itemId) => this.prisma.costing.count({
        where: { deletedAt: null, pricingMode: 'LIVE', status: { not: 'APPROVED' }, groups: { some: { categories: { some: { materials: { some: { itemId } } } } } } },
      }),
    });
  }

  // ───────── calculation ─────────

  /**
   * Validate, resolve master rates and run the engine. The server never trusts client-side rates or totals:
   * everything except explicit CUSTOM overrides (which need `costing:manage_rates`) comes from the masters.
   */
  async prepare(db: Tx | PrismaService, input: CostingInputPayload, actor: AuthUser, existing?: CostingTree): Promise<Prepared> {
    const rules = await this.settings.getRules();
    const warnings: string[] = [];

    // Company expenses (administrator-set overheads) are added to every costing by the server. Anything the client sent for
    // one of them is ignored, so a user can neither add, change nor remove them.
    const companyMasters = await db.expense.findMany({ where: { isCompanyExpense: true, isActive: true, deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { name: 'asc' }] });
    const companyIds = new Set(companyMasters.map((x) => x.id));
    input = { ...input, expenses: input.expenses.filter((e) => !companyIds.has(e.expenseId)) };

    // reuse the template hierarchy checks (type → group → category → item, units, labour, expenses)
    await this.templates.validateTree(db, {
      typeId: input.typeId,
      groups: input.groups.map((g) => ({
        groupId: g.groupId,
        categories: g.categories.map((c) => ({ categoryId: c.categoryId, items: c.materials.map((m) => ({ itemId: m.itemId, unitId: m.unitId, quantity: m.quantity })) })),
        labour: g.labour.map((l) => ({ labourId: l.labourId, unitId: l.unitId, quantity: l.quantity })),
      })),
      expenses: input.expenses.map((e) => ({ expenseId: e.expenseId, groupId: e.groupId })),
    } as unknown as TemplateInput);

    const itemIds = input.groups.flatMap((g) => g.categories.flatMap((c) => c.materials.map((m) => m.itemId)));
    const labourIds = input.groups.flatMap((g) => g.labour.map((l) => l.labourId));
    const [conversionRules, items, units, labour, expenses, suppliers] = await Promise.all([
      activeConversionRules(db),
      db.item.findMany({ where: { id: { in: itemIds } }, include: { unit: true, unitConversions: true, suppliers: true } }),
      db.unit.findMany({}),
      db.labour.findMany({ where: { id: { in: labourIds } } }),
      db.expense.findMany({ where: { id: { in: input.expenses.map((e) => e.expenseId) } } }),
      db.supplier.findMany({ where: { id: { in: input.groups.flatMap((g) => g.categories.flatMap((c) => c.materials.flatMap((m) => (m.supplierId ? [m.supplierId] : [])))) }, deletedAt: null } }),
    ]);
    const I = new Map(items.map((x) => [x.id, x])), U = new Map(units.map((x) => [x.id, x])), L = new Map(labour.map((x) => [x.id, x])), E = new Map(expenses.map((x) => [x.id, x]));
    const S = new Set(suppliers.map((s) => s.id));

    // custom rates need the manage-rates permission unless they already exist unchanged on this costing
    const canCustom = actor.permissions.has('costing:manage_rates');
    const keptMaterial = new Set(existing?.groups.flatMap((g) => g.categories.flatMap((c) => c.materials.filter((m) => m.rateBasis === 'CUSTOM').map((m) => `${m.itemId}|${m.rate.toString()}`))) ?? []);
    const keptLabour = new Set(existing?.groups.flatMap((g) => g.labour.filter((l) => l.customRate).map((l) => `${l.labourId}|${l.rate.toString()}`)) ?? []);

    const materialRows: Prepared['materialRows'] = new Map();
    const labourRows: Prepared['labourRows'] = new Map();
    const expenseRows: Prepared['expenseRows'] = new Map();

    const engine: CostingInput = {
      quantity: input.quantity, wastagePercent: input.wastagePercent, gstPercent: input.gstPercent, markupPercent: input.markupPercent, extraPercent: input.extraPercent,
      groups: input.groups.map((g, gi) => ({
        id: `g${gi}`, wastagePercent: g.wastagePercent ?? null,
        categories: g.categories.map((c, ci) => ({
          id: `c${gi}.${ci}`, wastagePercent: c.wastagePercent ?? null,
          materials: c.materials.map((m, mi) => {
            const item = I.get(m.itemId)!;
            const unit = U.get(m.unitId)!;
            const ref = (u: typeof unit) => ({ id: u.id, unitType: u.unitType, baseFactor: u.baseFactor?.toString() ?? null });
            let factor;
            try {
              factor = convertQuantity(1, ref(unit), ref(item.unit), { baseUnitId: item.unitId, conversions: conversionsWithRules({ id: item.id, baseUnitId: item.unitId, conversions: item.unitConversions.map((x) => ({ unitId: x.unitId, conversionValue: x.conversionValue.toString() })) }, conversionRules) });
            } catch (e) { if (e instanceof IncompatibleUnitsError) throw bad(`Unit ${unit.symbol} cannot be used for ${item.name}`); throw e; }
            if (m.supplierId && !S.has(m.supplierId)) throw bad('Selected supplier does not exist');
            if (m.rateBasis === 'CUSTOM' && !canCustom && !keptMaterial.has(`${m.itemId}|${m.rate}`)) {
              throw new ForbiddenException('You do not have permission to enter custom rates (costing:manage_rates)');
            }
            const res = resolveMaterialRate(
              {
                baseUnitId: item.unitId, defaultPurchaseRate: item.defaultPurchaseRate.toString(), hasRateRange: item.hasRateRange,
                minRate: str(item.minRate), maxRate: str(item.maxRate), avgRate: str(item.avgRate),
                suppliers: item.suppliers.map((s) => ({ supplierId: s.supplierId, rate: s.rate.toString() })),
              },
              m.rateBasis as RateBasis, factor, { supplierId: m.supplierId, customRate: m.rate },
            );
            if (res.fellBack) warnings.push(`${item.name}: ${m.rateBasis.toLowerCase()} rate is not available, the standard rate was used`);
            materialRows.set(mId(gi, ci, mi), { rate: res.rate.toString(), itemGst: item.gstPercent.toString(), basis: res.basis });
            return {
              id: mId(gi, ci, mi), quantity: m.quantity, wastageMode: m.wastageMode, wastagePercent: m.wastagePercent ?? null,
              wastageQuantity: m.wastageQuantity ?? null, rate: res.rate, itemGstPercent: item.gstPercent.toString(),
            };
          }),
        })),
        labour: g.labour.map((l, li) => {
          const master = L.get(l.labourId)!;
          const custom = !!l.rate;
          if (custom && !canCustom && !keptLabour.has(`${l.labourId}|${l.rate}`)) throw new ForbiddenException('You do not have permission to enter custom rates (costing:manage_rates)');
          const rate = custom ? l.rate! : master.defaultRate.toString();
          labourRows.set(lId(gi, li), { rate, custom });
          return { id: lId(gi, li), quantity: l.quantity, rate };
        }),
      })),
      expenses: input.expenses.map((e, ei) => {
        const master = E.get(e.expenseId)!;
        const row = {
          method: (e.calculationMethod ?? master.calculationMethod) as 'FIXED' | 'PERCENTAGE' | 'QUANTITY_BASED',
          value: e.value ?? master.defaultValue.toString(), quantity: e.quantity ?? '1',
          timing: (e.applyTiming ?? master.applyTiming) as 'BEFORE_GST' | 'AFTER_GST',
        };
        if (row.method === 'PERCENTAGE' && Number(row.value) > 100) throw bad(`expenses.${ei}.value: Percentage cannot exceed 100`);
        // fields the user filled in are overrides; the rest keep following the expense master when rates are refreshed
        const overrides = [e.calculationMethod ? 'method' : '', e.value ? 'value' : '', e.applyTiming ? 'timing' : ''].filter(Boolean);
        expenseRows.set(eId(ei), { ...row, overrides });
        const gi = e.groupId ? input.groups.findIndex((g) => g.groupId === e.groupId) : -1;
        return { id: eId(ei), groupId: gi >= 0 ? `g${gi}` : null, ...row };
      }),
    };
    const companyRows: Prepared['companyRows'] = companyMasters.map((m, k) => ({
      key: eId(input.expenses.length + k), expenseId: m.id, name: m.name, method: m.calculationMethod as 'FIXED' | 'PERCENTAGE' | 'QUANTITY_BASED',
      value: m.defaultValue.toString(), timing: m.applyTiming as 'BEFORE_GST' | 'AFTER_GST',
    }));
    for (const c of companyRows) {
      engine.expenses.push({ id: c.key, groupId: null, method: c.method, value: c.value, quantity: '1', timing: c.timing, isCompany: true });
      expenseRows.set(c.key, { method: c.method, value: c.value, quantity: '1', timing: c.timing, overrides: [] });
    }
    let result: CostingResult;
    try { result = calculateCosting(engine, rules); } catch (e) {
      if (e instanceof CostingInputError) throw bad(e.message);
      throw e;
    }
    return { payload: input, rules, result, materialRows, labourRows, expenseRows, companyRows, warnings };
  }

  /** Read-only calculation for the editor (same code path as saving, nothing persisted). */
  async preview(actor: AuthUser, body: unknown, existingId?: string) {
    const input = parseOrThrow(costingSchema, body) as CostingInputPayload;
    const existing = existingId ? await this.mustFind(existingId, true) : undefined;
    const p = await this.prepare(this.prisma, input, actor, existing);
    const rows = {
      materials: Object.fromEntries([...p.materialRows].map(([k, v]) => [k, { rate: v.rate, basis: v.basis, effectiveQuantity: p.result.materials[k].effectiveQuantity.toString(), wastageQuantity: p.result.materials[k].wastageQuantity.toString(), netRate: p.result.materials[k].netRate.toString(), formula: p.result.materials[k].formula, total: p.result.materials[k].total.toString() }])),
      labour: Object.fromEntries([...p.labourRows].map(([k, v]) => [k, { rate: v.rate, custom: v.custom, total: p.result.labour[k].toString() }])),
      expenses: Object.fromEntries([...p.expenseRows].filter(([k]) => !p.companyRows.some((c) => c.key === k)).map(([k, v]) => [k, { method: v.method, value: v.value, timing: v.timing, amount: p.result.expenses[k].amount.toString() }])),
    };
    const companyExpenses = p.companyRows.map((c) => ({ expenseId: c.expenseId, name: c.name, method: c.method, value: c.value, timing: c.timing, amount: p.result.expenses[c.key].amount.toString() }));
    return { ...this.summary(p.result, p.warnings), rows, companyExpenses, rules: p.rules };
  }

  private summary(r: CostingResult, warnings: string[] = []) {
    const s = (v: { toString(): string }) => v.toString();
    return {
      materialCost: s(r.materialCost), materialWastage: s(r.materialWastage), labourCost: s(r.labourCost), expenseCost: s(r.expenseCost),
      basicCost: s(r.basicCost), gstAmount: s(r.gstAmount), totalCostInclGst: s(r.totalCostInclGst), extraAmount: s(r.extraAmount), companyExpenseCost: s(r.companyExpenseCost), markupAmount: s(r.markupAmount),
      sellingPrice: s(r.sellingPrice), profitAmount: s(r.profitAmount), profitPercent: s(r.profitPercent),
      netBasicRate: s(r.netBasicRate), netSellingPrice: s(r.netSellingPrice),
      groups: r.groups.map((g) => ({ id: g.id, materialCost: s(g.materialCost), labourCost: s(g.labourCost), wastagePercent: g.wastagePercent ? s(g.wastagePercent) : null })),
      breakdown: r.breakdown.map((b) => ({ key: b.key, label: b.label, amount: s(b.amount), note: b.note })),
      warnings,
    };
  }

  // ───────── persistence ─────────

  private nextNumber(tx: Tx, date: Date) {
    return this.numbering.next(tx, 'costing', date, async (n) => (await tx.costing.count({ where: { costingNumber: n } })) > 0);
  }

  private async writeTree(tx: Tx, id: string, p: Prepared) {
    const { payload, result } = p;
    await tx.costingExpense.deleteMany({ where: { costingId: id } });
    await tx.costingGroup.deleteMany({ where: { costingId: id } });
    const groupIds = new Map<string, string>();
    for (const [gi, g] of payload.groups.entries()) {
      const created = await tx.costingGroup.create({
        data: {
          costingId: id, groupId: g.groupId, sortOrder: gi, wastagePercent: g.wastagePercent ?? null,
          categories: {
            create: g.categories.map((c, ci) => ({
              categoryId: c.categoryId, sortOrder: ci, wastagePercent: c.wastagePercent ?? null,
              materials: {
                create: c.materials.map((m, mi) => {
                  const key = mId(gi, ci, mi);
                  const row = p.materialRows.get(key)!;
                  const calc = result.materials[key];
                  return {
                    itemId: m.itemId, notes: m.notes ?? null, quantity: m.quantity, unitId: m.unitId, wastageMode: m.wastageMode,
                    wastagePercent: m.wastagePercent ?? null, wastageQuantity: m.wastageQuantity ?? null, rateBasis: row.basis, supplierId: m.supplierId ?? null,
                    rate: row.rate, itemGstPercent: row.itemGst, effectiveQuantity: calc.effectiveQuantity.toString(), total: calc.total.toString(), sortOrder: mi,
                  };
                }),
              },
            })),
          },
          labour: {
            create: g.labour.map((l, li) => {
              const row = p.labourRows.get(lId(gi, li))!;
              return { labourId: l.labourId, quantity: l.quantity, unitId: l.unitId ?? null, customRate: row.custom, rate: row.rate, total: result.labour[lId(gi, li)].toString(), sortOrder: li };
            }),
          },
        },
      });
      groupIds.set(g.groupId, created.id);
    }
    const own = payload.expenses.map((e, ei) => {
      const row = p.expenseRows.get(eId(ei))!;
      return {
        costingId: id, costingGroupId: e.groupId ? groupIds.get(e.groupId)! : null, expenseId: e.expenseId, calculationMethod: row.method, value: row.value,
        quantity: row.quantity, applyTiming: row.timing, overrideFields: row.overrides, amount: result.expenses[eId(ei)].amount.toString(), sortOrder: ei, isCompany: false,
      };
    });
    const company = p.companyRows.map((c, k) => ({
      costingId: id, costingGroupId: null, expenseId: c.expenseId, calculationMethod: c.method, value: c.value, quantity: '1', applyTiming: c.timing,
      overrideFields: [] as string[], amount: result.expenses[c.key].amount.toString(), sortOrder: own.length + k, isCompany: true,
    }));
    if (own.length + company.length) await tx.costingExpense.createMany({ data: [...own, ...company] });
  }

  private header(p: Prepared) {
    const { payload: c, result: r } = p;
    return {
      productName: c.productName, productCode: c.productCode ?? null, typeId: c.typeId, templateId: c.templateId ?? null, description: c.description ?? null,
      length: c.length ?? null, width: c.width ?? null, height: c.height ?? null, dimensionUnitId: c.dimensionUnitId ?? null,
      quantity: c.quantity, unitId: c.unitId ?? null, costingDate: new Date(`${c.costingDate}T00:00:00.000Z`), notes: c.notes ?? null,
      wastagePercent: c.wastagePercent, gstPercent: c.gstPercent, markupPercent: c.markupPercent, extraPercent: c.extraPercent ?? '0',
      rules: p.rules as unknown as Prisma.InputJsonValue,
      materialCost: r.materialCost.toString(), materialWastage: r.materialWastage.toString(), labourCost: r.labourCost.toString(), expenseCost: r.expenseCost.toString(),
      basicCost: r.basicCost.toString(), gstAmount: r.gstAmount.toString(), totalCostInclGst: r.totalCostInclGst.toString(), extraAmount: r.extraAmount.toString(), companyExpenseCost: r.companyExpenseCost.toString(), markupAmount: r.markupAmount.toString(),
      sellingPrice: r.sellingPrice.toString(), profitAmount: r.profitAmount.toString(), profitPercent: r.profitPercent.toString(),
      netBasicRate: r.netBasicRate.toString(), netSellingPrice: r.netSellingPrice.toString(), calculatedAt: new Date(),
    };
  }

  private async revision(tx: Tx, id: string, version: number, actorId: string, note?: string) {
    const full = await tx.costing.findUniqueOrThrow({ where: { id }, include: TREE });
    await tx.costingRevision.create({
      data: { costingId: id, version, snapshot: { status: full.status, totals: this.totals(full), payload: this.toPayload(full) } as unknown as Prisma.InputJsonValue, note: note ?? null, createdBy: actorId },
    });
  }

  private totals(c: CostingTree) {
    return Object.fromEntries(['materialCost', 'materialWastage', 'labourCost', 'expenseCost', 'basicCost', 'gstAmount', 'totalCostInclGst', 'extraAmount', 'companyExpenseCost', 'markupAmount', 'sellingPrice', 'profitAmount', 'profitPercent'].map((k) => [k, ((c as unknown as Record<string, { toString(): string } | undefined>)[k])?.toString()]));
  }

  /**
   * The figures as they were saved, in the same shape as a preview. A costing waiting for approval or approved is frozen, so its
   * screen shows these and never recalculates from today's rates.
   */
  private storedSummary(c: CostingTree) {
    const v = (x: { toString(): string }) => x.toString();
    const after = d(v(c.totalCostInclGst)).minus(v(c.basicCost)).minus(v(c.gstAmount));
    const before = d(v(c.expenseCost)).minus(after);
    const extra = d(v(c.extraAmount));
    const step = (key: string, label: string, amount: { toString(): string }, note?: string) => ({ key, label, amount: v(amount), ...(note ? { note } : {}) });
    const materials: Record<string, unknown> = {}, labour: Record<string, unknown> = {}, expenses: Record<string, unknown> = {};
    const groups = c.groups.map((g, gi) => {
      let material = d(0), labourCost = d(0);
      g.categories.forEach((cat, ci) => cat.materials.forEach((m, mi) => {
        material = material.plus(v(m.total));
        materials[`m${gi}.${ci}.${mi}`] = { rate: v(m.rate), total: v(m.total), effectiveQuantity: v(m.effectiveQuantity), wastageQuantity: d(v(m.effectiveQuantity)).minus(v(m.quantity)).toString(), rateBasis: m.rateBasis };
      }));
      g.labour.forEach((l, li) => {
        labourCost = labourCost.plus(v(l.total));
        labour[`l${gi}.${li}`] = { rate: v(l.rate), total: v(l.total) };
      });
      return { id: `g${gi}`, materialCost: material.toString(), labourCost: labourCost.toString(), wastagePercent: g.wastagePercent === null ? null : v(g.wastagePercent) };
    });
    c.expenses.filter((e) => !e.isCompany).forEach((e, ei) => { expenses[`e${ei}`] = { amount: v(e.amount), value: v(e.value), method: e.calculationMethod, timing: e.applyTiming }; });
    return {
      ...this.totals(c), netBasicRate: v(c.netBasicRate), netSellingPrice: v(c.netSellingPrice), rules: c.rules, groups, warnings: [] as string[], rows: { materials, labour, expenses },
      companyExpenses: c.expenses.filter((e) => e.isCompany).map((e) => ({ expenseId: e.expenseId, name: e.expense.name, method: e.calculationMethod, value: v(e.value), timing: e.applyTiming, amount: v(e.amount) })),
      breakdown: [
        step('material', 'Material cost', c.materialCost, `includes ${v(c.materialWastage)} for wastage`), step('labour', 'Labour cost', c.labourCost), step('expenseBefore', 'Other expenses (before GST)', before),
        step('basic', 'Basic cost before GST', c.basicCost), step('gst', 'GST', c.gstAmount), step('expenseAfter', 'Other expenses (after GST)', after), step('total', 'Total cost including GST', c.totalCostInclGst),
        ...(extra.isZero() ? [] : [step('extra', `Extra ${d(v(c.extraPercent)).toString()}%`, extra, 'on total cost incl. GST, before markup')]),
        step('markup', `Markup ${d(v(c.markupPercent)).toString()}%`, c.markupAmount), step('selling', 'Selling price', c.sellingPrice),
      ],
    };
  }

  /** Form-shaped values (what the editor edits). Custom rates are echoed, master rates are left blank. */
  toPayload(c: CostingTree) {
    return {
      productName: c.productName, productCode: c.productCode ?? '', typeId: c.typeId, templateId: c.templateId ?? '', description: c.description ?? '',
      length: str(c.length) ?? '', width: str(c.width) ?? '', height: str(c.height) ?? '', dimensionUnitId: c.dimensionUnitId ?? '',
      quantity: str(c.quantity)!, unitId: c.unitId ?? '', costingDate: c.costingDate.toISOString().slice(0, 10), notes: c.notes ?? '',
      wastagePercent: str(c.wastagePercent)!, gstPercent: str(c.gstPercent)!, markupPercent: str(c.markupPercent)!, extraPercent: str(c.extraPercent) ?? '0',
      groups: c.groups.map((g) => ({
        groupId: g.groupId, wastagePercent: str(g.wastagePercent) ?? '',
        categories: g.categories.map((cat) => ({
          categoryId: cat.categoryId, wastagePercent: str(cat.wastagePercent) ?? '',
          materials: cat.materials.map((m) => ({
            itemId: m.itemId, notes: m.notes ?? '', quantity: str(m.quantity)!, unitId: m.unitId, wastageMode: m.wastageMode,
            wastagePercent: str(m.wastagePercent) ?? '', wastageQuantity: str(m.wastageQuantity) ?? '', rateBasis: m.rateBasis, supplierId: m.supplierId ?? '',
            rate: m.rateBasis === 'CUSTOM' ? str(m.rate)! : '',
          })),
        })),
        labour: g.labour.map((l) => ({ labourId: l.labourId, quantity: str(l.quantity)!, unitId: l.unitId ?? '', rate: l.customRate ? str(l.rate)! : '' })),
      })),
      // company expenses are the server's, not the form's
      expenses: c.expenses.filter((e) => !e.isCompany).map((e) => ({
        expenseId: e.expenseId, groupId: e.costingGroup?.groupId ?? '', quantity: str(e.quantity)!,
        calculationMethod: e.overrideFields.includes('method') ? e.calculationMethod : '', value: e.overrideFields.includes('value') ? str(e.value)! : '', applyTiming: e.overrideFields.includes('timing') ? e.applyTiming : '',
      })),
    };
  }

  private mapError(e: unknown) {
    if ((e as { code?: string }).code === 'P2002') return bad('Could not allocate a unique costing number, please retry');
    return e;
  }

  // ───────── operations ─────────

  async create(actor: AuthUser, body: unknown) {
    const input = parseOrThrow(costingSchema, body) as CostingInputPayload;
    const p = await this.prepare(this.prisma, input, actor);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const number = await this.nextNumber(tx, new Date());
        const template = input.templateId ? await tx.template.findFirst({ where: { id: input.templateId } }) : null;
        const row = await tx.costing.create({
          data: { ...this.header(p), costingNumber: number, templateVersion: template?.version ?? null, preparedById: actor.id, createdBy: actor.id, updatedBy: actor.id },
        });
        await this.writeTree(tx, row.id, p);
        await this.revision(tx, row.id, 1, actor.id, 'Created');
        return row.id;
      });
      await this.audit.log({ userId: actor.id, action: 'create', entity: 'Costing', entityId: id, metadata: { product: input.productName } });
      return { ...(await this.get(id)), warnings: p.warnings };
    } catch (e) { throw this.mapError(e); }
  }

  async update(actor: AuthUser, id: string, body: unknown) {
    const existing = await this.mustFind(id, true);
    this.assertEditable(existing);
    const input = parseOrThrow(costingSchema, body) as CostingInputPayload;
    const p = await this.prepare(this.prisma, input, actor, existing);
    await this.persist(actor, existing, p, undefined);
    await this.audit.log({ userId: actor.id, action: 'update', entity: 'Costing', entityId: id, metadata: { version: existing.version + 1 } });
    return { ...(await this.get(id)), warnings: p.warnings };
  }

  private async persist(actor: AuthUser, existing: CostingTree, p: Prepared, note?: string, extra: Prisma.CostingUncheckedUpdateInput = {}) {
    const version = existing.version + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.costing.update({
        where: { id: existing.id },
        data: { ...this.header(p), version, updatedBy: actor.id, status: existing.status === 'REJECTED' ? 'DRAFT' : existing.status, rejectionReason: null, ...extra },
      });
      await this.writeTree(tx, existing.id, p);
      await this.revision(tx, existing.id, version, actor.id, note);
    });
  }

  private assertEditable(c: { status: string }) {
    if (c.status === 'APPROVED') throw bad('Approved costings are locked. Ask an approver to reopen the costing to edit it.');
    if (c.status === 'PENDING_APPROVAL') throw bad('This costing is waiting for approval. Reject or reopen it before editing.');
  }

  /**
   * Re-resolve master rates for a LIVE costing (item rates, labour rates, expense defaults are re-read; custom overrides stay).
   * Used by the "Refresh rates" action; the automatic rate-change recalculation (Phase 14) calls the same method.
   */
  /** Figures that identify a calculation: line rates / totals and the headline amounts. Equal signatures = nothing changed. */
  private signatureOf(rows: { materials: string[]; labour: string[]; expenses: string[]; totals: string[] }) {
    const n = (v: string) => d(v).toString();
    return JSON.stringify([rows.materials.map(n), rows.labour.map(n), rows.expenses.map(n), rows.totals.map(n)]);
  }

  /**
   * Re-run the calculation of one LIVE costing against the current masters. With `dryRun` nothing is written, so the
   * caller can show the before / after figures first. Costings that are approved (frozen) or waiting for approval are
   * refused with a reason and never touched; unchanged costings are not rewritten.
   */
  async recalculate(actor: AuthUser, id: string, opts: { note?: string; dryRun?: boolean } = {}) {
    const existing = await this.mustFind(id, true);
    const base = { id, number: existing.costingNumber, product: existing.productName, status: existing.status };
    const figures = () => ({ basic: existing.basicCost.toString(), selling: existing.sellingPrice.toString(), total: existing.totalCostInclGst.toString(), gst: existing.gstAmount.toString() });
    const skip = (reason: string) => { const f = existing.basicCost ? figures() : { basic: '0', selling: '0', total: '0', gst: '0' }; return { ...base, outcome: 'SKIPPED' as const, reason, before: f, after: f, warnings: [] as string[] }; };
    if (existing.pricingMode !== 'LIVE' || existing.status === 'APPROVED') return skip('Approved costings keep their snapshot (frozen rates). Reopen the costing to let it follow the masters.');
    if (existing.status === 'PENDING_APPROVAL') return skip('Waiting for approval: the figures under review are not changed. Recalculate after it is approved, rejected or reopened.');
    const before = figures();
    const payload = parseOrThrow(costingSchema, this.toPayload(existing)) as CostingInputPayload;
    const p = await this.prepare(this.prisma, payload, actor, existing);
    const after = { basic: p.result.basicCost.toString(), selling: p.result.sellingPrice.toString(), total: p.result.totalCostInclGst.toString(), gst: p.result.gstAmount.toString() };
    const stored = this.signatureOf({
      materials: existing.groups.flatMap((g) => g.categories.flatMap((c) => c.materials.flatMap((m) => [m.rate.toString(), m.total.toString()]))),
      labour: existing.groups.flatMap((g) => g.labour.flatMap((l) => [l.rate.toString(), l.total.toString()])), expenses: existing.expenses.map((e) => e.amount.toString()),
      totals: [before.basic, before.selling, before.total, before.gst],
    });
    const fresh = this.signatureOf({
      materials: [...p.materialRows.keys()].flatMap((k) => [p.materialRows.get(k)!.rate, p.result.materials[k].total.toString()]),
      labour: [...p.labourRows.keys()].flatMap((k) => [p.labourRows.get(k)!.rate, p.result.labour[k].toString()]), expenses: [...p.expenseRows.keys()].map((k) => p.result.expenses[k].amount.toString()),
      totals: [after.basic, after.selling, after.total, after.gst],
    });
    if (stored === fresh) return { ...base, outcome: 'UNCHANGED' as const, reason: null, before, after, warnings: p.warnings };
    if (!opts.dryRun) {
      await this.persist(actor, existing, p, opts.note ?? 'Recalculated from the masters');
      await this.audit.log({ userId: actor.id, action: 'recalculate', entity: 'Costing', entityId: id, metadata: { sellingPriceBefore: before.selling, sellingPriceAfter: after.selling, note: opts.note ?? null } });
    }
    return { ...base, outcome: 'CHANGED' as const, reason: null, before, after, warnings: p.warnings };
  }

  /** The costing screen's "Refresh rates" button. */
  async refreshRates(actor: AuthUser, id: string, note = 'Rates refreshed from masters') {
    const r = await this.recalculate(actor, id, { note });
    if (r.outcome === 'SKIPPED') throw bad(r.reason!);
    return { ...(await this.get(id)), warnings: r.warnings, unchanged: r.outcome === 'UNCHANGED' };
  }

  async setStatus(actor: AuthUser, id: string, action: 'submit' | 'approve' | 'reject' | 'reopen', body: unknown) {
    const { reason } = parseOrThrow(costingActionSchema, body ?? {}) as { reason?: string };
    const c = await this.mustFind(id);
    const workflow = (await this.appSettings.get()).approval.costing;
    const next: Record<typeof action, { from: string[]; to: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' }> = {
      submit: { from: ['DRAFT', 'REJECTED'], to: 'PENDING_APPROVAL' },
      // when approval is not required an approver may approve a draft directly, without the submit step
      approve: { from: workflow.required ? ['PENDING_APPROVAL'] : ['PENDING_APPROVAL', 'DRAFT', 'REJECTED'], to: 'APPROVED' },
      reject: { from: ['PENDING_APPROVAL'], to: 'REJECTED' },
      reopen: { from: ['APPROVED'], to: 'DRAFT' },
    };
    const rule = next[action];
    if (!rule.from.includes(c.status)) throw bad(`Cannot ${action} a costing that is ${c.status.replace('_', ' ').toLowerCase()}`);
    if ((action === 'reject' || action === 'reopen') && !reason) throw bad('reason: A reason is required');
    if (action === 'approve' && !workflow.allowSelfApproval && c.preparedById === actor.id) throw new ForbiddenException('Settings require a costing to be approved by someone other than the person who prepared it');
    const data: Prisma.CostingUncheckedUpdateInput = { status: rule.to, updatedBy: actor.id };
    if (action === 'approve') Object.assign(data, { pricingMode: 'SNAPSHOT', approvedById: actor.id, approvedAt: new Date(), rejectionReason: null, version: c.version + 1 });
    if (action === 'reject') data.rejectionReason = reason;
    // reopening takes it off the price list: dealers must never see a price for figures that are being changed
    if (action === 'reopen') Object.assign(data, { pricingMode: 'LIVE', approvedById: null, approvedAt: null, version: c.version + 1, published: false, publishedAt: null, publishedById: null });
    await this.prisma.$transaction(async (tx) => {
      await tx.costing.update({ where: { id }, data });
      // approval and reopening are version events: the snapshot records the exact figures that were approved / reopened
      if (action === 'approve' || action === 'reopen') await this.revision(tx, id, c.version + 1, actor.id, action === 'approve' ? 'Approved: rates frozen' : `Reopened: ${reason}`);
    });
    await this.audit.log({ userId: actor.id, action, entity: 'Costing', entityId: id, metadata: { reason: reason ?? null } });
    // approved figures are priced for every dealer at once; a costing is published separately, so nobody is told yet
    if (action === 'approve') await this.dealerPrices?.refresh({ costingIds: [id] }).catch(() => undefined);
    if (action === 'reopen' && c.published) await this.dealerPrices?.announceRemoved(id);
    return { id, status: rule.to };
  }

  async remove(actor: AuthUser, id: string) {
    const c = await this.mustFind(id);
    if (!['DRAFT', 'REJECTED'].includes(c.status)) throw bad('Only draft or rejected costings can be deleted');
    await this.prisma.costing.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: actor.id } });
    await this.audit.log({ userId: actor.id, action: 'delete', entity: 'Costing', entityId: id, metadata: { number: c.costingNumber } });
    return { id };
  }

  /** Prefilled costing payload from a template (the editor loads it; nothing is saved until the user saves). */
  async fromTemplate(templateId: string) {
    const t = await this.templates.get(templateId);
    if (t.status !== 'ACTIVE') throw bad('Only active templates can be used for a new costing');
    const tp = t.payload;
    return {
      productName: '', productCode: '', typeId: tp.typeId, templateId, description: '', length: '', width: '', height: '', dimensionUnitId: '',
      quantity: '1', unitId: '', costingDate: new Date().toISOString().slice(0, 10), notes: '',
      wastagePercent: tp.wastagePercent, gstPercent: tp.gstPercent, markupPercent: tp.markupPercent,
      groups: tp.groups.map((g) => ({
        groupId: g.groupId, wastagePercent: g.wastagePercent,
        categories: g.categories.map((c) => ({
          categoryId: c.categoryId, wastagePercent: c.wastagePercent,
          materials: c.items.map((i) => ({ itemId: i.itemId, notes: i.notes, quantity: i.quantity, unitId: i.unitId, wastageMode: 'PERCENT', wastagePercent: i.wastagePercent, wastageQuantity: '', rateBasis: 'STANDARD', supplierId: '', rate: '' })),
        })),
        labour: g.labour.map((l) => ({ labourId: l.labourId, quantity: l.quantity, unitId: l.unitId, rate: l.rate })),
      })),
      expenses: tp.expenses.map((e) => ({ expenseId: e.expenseId, groupId: e.groupId, calculationMethod: e.calculationMethod, value: e.value, quantity: '', applyTiming: '' })),
    };
  }

  /** Turn a saved costing into a reusable template (defaults only: no prices are copied). */
  async saveAsTemplate(actor: AuthUser, id: string, body: unknown) {
    const { name, code } = parseOrThrow(saveAsTemplateSchema, body) as { name: string; code: string };
    const c = await this.mustFind(id, true);
    const payload = this.toPayload(c);
    const template = await this.templates.create(actor, {
      name, code, typeId: c.typeId, description: c.description ?? '', wastagePercent: payload.wastagePercent, gstPercent: payload.gstPercent, markupPercent: payload.markupPercent, status: 'ACTIVE',
      groups: payload.groups.map((g) => ({
        groupId: g.groupId, wastagePercent: g.wastagePercent,
        categories: g.categories.map((cat) => ({
          categoryId: cat.categoryId, wastagePercent: cat.wastagePercent,
          items: cat.materials.map((m) => ({ itemId: m.itemId, quantity: m.quantity, unitId: m.unitId, wastagePercent: m.wastageMode === 'PERCENT' ? m.wastagePercent : '', notes: m.notes })),
        })),
        labour: g.labour.map((l) => ({ labourId: l.labourId, quantity: l.quantity, unitId: l.unitId, rate: '' })),
      })),
      expenses: payload.expenses.map((e) => ({ expenseId: e.expenseId, groupId: e.groupId, calculationMethod: e.calculationMethod, value: e.value })),
    });
    // the template starts with the product photos of the costing it came from
    await this.images.copyLinks({ kind: 'costing', id }, { kind: 'template', id: template.id });
    return template;
  }

  // ───────── reads ─────────

  async get(id: string) {
    const c = await this.mustFind(id, true);
    const rules = c.rules as unknown as CalcRules;
    // recompute the summary from stored rows so the detail view always matches the stored calculation rules
    return {
      id: c.id, costingNumber: c.costingNumber, status: c.status, pricingMode: c.pricingMode, version: c.version, templateId: c.templateId, templateVersion: c.templateVersion,
      type: c.type, preparedBy: c.preparedBy, approvedAt: c.approvedAt, rejectionReason: c.rejectionReason, calculatedAt: c.calculatedAt, rules,
      payload: this.toPayload(c),
      totals: this.totals(c),
      summary: ['DRAFT', 'REJECTED'].includes(c.status) ? null : this.storedSummary(c), // a costing still being edited is always previewed live
      rows: {
        materials: c.groups.map((g) => g.categories.map((cat) => cat.materials.map((m) => ({ rate: m.rate.toString(), effectiveQuantity: m.effectiveQuantity.toString(), total: m.total.toString(), rateBasis: m.rateBasis })))),
        labour: c.groups.map((g) => g.labour.map((l) => ({ rate: l.rate.toString(), total: l.total.toString() }))),
        expenses: c.expenses.filter((e) => !e.isCompany).map((e) => ({ amount: e.amount.toString() })),
      },
      companyExpenses: c.expenses.filter((e) => e.isCompany).map((e) => ({
        expenseId: e.expenseId, name: e.expense.name, method: e.calculationMethod, value: e.value.toString(), timing: e.applyTiming, amount: e.amount.toString(),
      })),
    };
  }

  /** The costing list with only the columns this user may see (money a user may not see never leaves the server). */
  async listFor(user: AuthUser, q: Record<string, string | undefined>) {
    const r = await this.list(q);
    const keep = allowedColumns(user, 'costings');
    const hidden = { type: 'type', costingDate: 'costingDate', status: 'status', basicCost: 'basicCost', totalCostInclGst: 'totalCostInclGst', sellingPrice: 'sellingPrice', profitPercent: 'profitPercent', preparedBy: 'preparedBy', costingNumber: 'costingNumber', productName: 'productName' } as const;
    const drop = Object.entries(hidden).filter(([col]) => !keep.has(col)).map(([, field]) => field);
    return { ...r, items: r.items.map((i) => Object.fromEntries(Object.entries(i).filter(([k]) => !(drop as string[]).includes(k)))) };
  }

  async list(q: Record<string, string | undefined>) {
    const where: Prisma.CostingWhereInput = { deletedAt: null };
    if (q.status) where.status = q.status as never;
    if (q.typeId) where.typeId = q.typeId;
    if (q.preparedById) where.preparedById = q.preparedById;
    if (q.search) where.OR = ['productName', 'costingNumber', 'productCode'].map((f) => ({ [f]: { contains: q.search, mode: 'insensitive' } }));
    if (q.from || q.to) where.costingDate = { ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T00:00:00.000Z`) } : {}) };
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const sortBy = ['costingDate', 'costingNumber', 'productName', 'sellingPrice', 'updatedAt'].includes(q.sortBy ?? '') ? q.sortBy! : 'costingDate';
    const [items, total] = await Promise.all([
      this.prisma.costing.findMany({
        where, orderBy: [{ [sortBy]: q.sortDir === 'asc' ? 'asc' : 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, costingNumber: true, productName: true, productCode: true, costingDate: true, status: true, pricingMode: true, version: true,
          basicCost: true, totalCostInclGst: true, sellingPrice: true, profitPercent: true, updatedAt: true,
          type: { select: { id: true, name: true } }, preparedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.costing.count({ where }),
    ]);
    const imgs = await this.images.mainImages('costing', items.map((i) => i.id));
    return { items: items.map((i) => ({ ...i, image: imgs.get(i.id) ?? null })), total, page, pageSize };
  }

  async revisions(id: string) {
    await this.mustFind(id);
    const rows = await this.prisma.costingRevision.findMany({ where: { costingId: id }, orderBy: { version: 'desc' }, select: { version: true, note: true, createdAt: true, createdBy: true, snapshot: true } });
    const ids = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map(({ snapshot, ...r }) => ({ ...r, createdByName: r.createdBy ? (names.get(r.createdBy) ?? null) : null, totals: (snapshot as { totals?: unknown }).totals ?? null, status: (snapshot as { status?: string }).status ?? null }));
  }

  private async mustFind(id: string): Promise<Prisma.CostingGetPayload<{}>>;
  private async mustFind(id: string, withTree: true): Promise<CostingTree>;
  private async mustFind(id: string, withTree?: boolean) {
    const c = await this.prisma.costing.findFirst({ where: { id, deletedAt: null }, ...(withTree ? { include: TREE } : {}) });
    if (!c) throw new NotFoundException('Costing not found');
    return c;
  }
}
