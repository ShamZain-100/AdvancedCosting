import { BadRequestException } from '@nestjs/common';
import {
  areaConversionSchema, expenseSchema, itemCategorySchema, itemGroupSchema, itemSchema, labourSchema,
  customerGroupSchema, priceListDealerSchema, customerSchema, supplierSchema, typeSchema, unitSchema,
} from '@costing/validators';
import { d } from '@costing/costing-engine';
import type { MasterConfig } from './master.types';

const bad = (m: string) => new BadRequestException(m);

const same = (x: unknown, y: unknown) => (x == null || y == null ? x == null && y == null : d(String(x)).equals(d(String(y))));
const str = (x: unknown) => (x == null ? null : String(x));

// Template rows only block deletion while their template is not deleted.
const inLiveTemplate = { template: { deletedAt: null } };
const viaGroup = { templateGroup: { template: { deletedAt: null } } };
const inLiveCosting = { costing: { deletedAt: null } };
const viaCostingGroup = { costingGroup: { costing: { deletedAt: null } } };
const viaCostingCategory = { costingCategory: { costingGroup: { costing: { deletedAt: null } } } };
const viaCategory = { templateCategory: { templateGroup: { template: { deletedAt: null } } } };

/** What a conversion rule does, for spotting a change that affects costings. */
const conversionRule = (x: any) => JSON.stringify([x.fromUnitId, x.toUnitId, String(x.conversionValue), x.itemId ?? null, x.formulaType, x.isActive]);
/** A rule for one item affects that item's costings; a general rule can affect any costing. */
const conversionChanged = (x: any) => [x.itemId
  ? { kind: 'ITEM_UNITS' as const, sourceId: x.itemId as string, sourceName: (x.item?.name ?? x.name) as string, note: `Conversion rule "${x.name}" changed` }
  : { kind: 'RULES' as const, sourceId: null, sourceName: x.name as string, note: `General conversion rule "${x.name}" changed` }];

export const MASTERS: MasterConfig[] = [
  {
    path: 'types', model: 'type', entity: 'Type', module: 'types', schema: typeSchema,
    searchFields: ['name', 'code'], sortable: ['name', 'code', 'createdAt'],
    references: [
      { model: 'itemGroup', field: 'typeId', label: 'item group(s)', soft: true },
      { model: 'item', field: 'typeId', label: 'item(s)', soft: true },
      { model: 'labour', field: 'typeId', label: 'labour record(s)', soft: true },
      { model: 'template', field: 'typeId', label: 'template(s)', soft: true },
      { model: 'costing', field: 'typeId', label: 'costing(s)', soft: true },
    ],
  },
  {
    path: 'item-groups', model: 'itemGroup', entity: 'ItemGroup', module: 'item_groups', schema: itemGroupSchema,
    searchFields: ['name', 'code'], filters: ['typeId'], sortable: ['name', 'code', 'createdAt'],
    include: { type: { select: { id: true, name: true } } },
    references: [
      { model: 'itemCategory', field: 'groupId', label: 'item categor(ies)', soft: true },
      { model: 'item', field: 'groupId', label: 'item(s)', soft: true },
      { model: 'templateGroup', field: 'groupId', label: 'template(s)', where: inLiveTemplate },
      { model: 'costingGroup', field: 'groupId', label: 'costing(s)', where: inLiveCosting },
    ],
    validate: async (d, { prisma }) => {
      const t = await prisma.type.findFirst({ where: { id: d.typeId, deletedAt: null } });
      if (!t) throw bad('Selected type does not exist');
    },
  },
  {
    path: 'item-categories', model: 'itemCategory', entity: 'ItemCategory', module: 'item_categories', schema: itemCategorySchema,
    searchFields: ['name', 'code'], filters: ['groupId'], sortable: ['name', 'code', 'createdAt'],
    include: { group: { select: { id: true, name: true, typeId: true } } },
    references: [
      { model: 'item', field: 'categoryId', label: 'item(s)', soft: true },
      { model: 'templateCategory', field: 'categoryId', label: 'template(s)', where: viaGroup },
      { model: 'costingCategory', field: 'categoryId', label: 'costing(s)', where: viaCostingGroup },
    ],
    validate: async (d, { prisma }) => {
      const g = await prisma.itemGroup.findFirst({ where: { id: d.groupId, deletedAt: null } });
      if (!g) throw bad('Selected group does not exist');
    },
  },
  {
    path: 'units', model: 'unit', entity: 'Unit', module: 'units', schema: unitSchema,
    searchFields: ['name', 'symbol'], filters: ['unitType'], sortable: ['name', 'symbol', 'unitType'],
    references: [
      { model: 'item', field: 'unitId', label: 'item(s)', soft: true },
      { model: 'labour', field: 'unitId', label: 'labour record(s)', soft: true },
      { model: 'areaConversion', field: 'fromUnitId', label: 'conversion(s)', soft: true },
      { model: 'areaConversion', field: 'toUnitId', label: 'conversion(s)', soft: true },
      { model: 'itemUnitConversion', field: 'unitId', label: 'item unit conversion(s)' },
      { model: 'purchaseRate', field: 'unitId', label: 'purchase entr(ies)', soft: true },
      { model: 'templateItem', field: 'unitId', label: 'template item(s)', where: viaCategory },
      { model: 'templateLabour', field: 'unitId', label: 'template labour line(s)', where: viaGroup },
      { model: 'costingMaterial', field: 'unitId', label: 'costing line(s)', where: viaCostingCategory },
      { model: 'costingLabour', field: 'unitId', label: 'costing labour line(s)', where: viaCostingGroup },
    ],
  },
  {
    path: 'suppliers', model: 'supplier', entity: 'Supplier', module: 'suppliers', schema: supplierSchema,
    searchFields: ['name', 'code', 'contactPerson', 'mobile', 'gstin'], sortable: ['name', 'code', 'createdAt'],
    references: [
      { model: 'item', field: 'defaultSupplierId', label: 'item(s) as default supplier', soft: true },
      { model: 'itemSupplier', field: 'supplierId', label: 'item supplier rate(s)' },
      { model: 'purchaseRate', field: 'supplierId', label: 'purchase entr(ies)', soft: true },
      { model: 'costingMaterial', field: 'supplierId', label: 'costing line(s)', where: viaCostingCategory },
    ],
  },
  {
    path: 'labour', model: 'labour', entity: 'Labour', module: 'labour', schema: labourSchema,
    searchFields: ['name', 'code'], filters: ['typeId'], sortable: ['name', 'code', 'defaultRate'],
    include: { unit: { select: { id: true, symbol: true } }, type: { select: { id: true, name: true } } },
    references: [
      { model: 'templateLabour', field: 'labourId', label: 'template labour line(s)', where: viaGroup },
      { model: 'costingLabour', field: 'labourId', label: 'costing labour line(s)', where: viaCostingGroup },
    ],
    watch: (b, a) => (same(b.defaultRate, a.defaultRate) ? [] : [{ kind: 'LABOUR_RATE', sourceId: a.id, sourceName: a.name, before: str(b.defaultRate), after: str(a.defaultRate), note: 'Labour rate edited' }]),
  },
  {
    path: 'expenses', model: 'expense', entity: 'Expense', module: 'expenses', schema: expenseSchema,
    searchFields: ['name', 'code'], filters: ['calculationMethod'], sortable: ['name', 'code'],
    references: [
      { model: 'templateExpense', field: 'expenseId', label: 'template expense line(s)', where: inLiveTemplate },
      { model: 'costingExpense', field: 'expenseId', label: 'costing expense line(s)', where: inLiveCosting },
    ],
    watchCreate: (c) => (c.isCompanyExpense && c.isActive
      ? [{ kind: 'COMPANY_EXPENSE', sourceId: c.id, sourceName: c.name, before: null, after: str(c.defaultValue), note: 'Company expense added' }] : []),
    watch: (b, a) => {
      // company expenses sit on every costing, so any change to one (value, method, timing, flag, active) reaches every live costing
      if (b.isCompanyExpense || a.isCompanyExpense) {
        const changed = !!b.isCompanyExpense !== !!a.isCompanyExpense || b.isActive !== a.isActive || !same(b.defaultValue, a.defaultValue)
          || b.calculationMethod !== a.calculationMethod || b.applyTiming !== a.applyTiming;
        return changed ? [{ kind: 'COMPANY_EXPENSE', sourceId: a.id, sourceName: a.name, before: str(b.defaultValue), after: str(a.defaultValue), note: 'Company expense changed' }] : [];
      }
      return same(b.defaultValue, a.defaultValue) && b.calculationMethod === a.calculationMethod && b.applyTiming === a.applyTiming
        ? [] : [{ kind: 'EXPENSE_DEFAULT', sourceId: a.id, sourceName: a.name, before: str(b.defaultValue), after: str(a.defaultValue), note: 'Expense default edited' }];
    },
  },
  {
    path: 'conversions', model: 'areaConversion', entity: 'AreaConversion', module: 'conversions', schema: areaConversionSchema,
    searchFields: ['name'], filters: ['itemId'], sortable: ['name', 'createdAt'],
    include: {
      fromUnit: { select: { id: true, symbol: true } }, toUnit: { select: { id: true, symbol: true } },
      item: { select: { id: true, name: true } },
    },
    references: [],
    watch: (b, a) => (conversionRule(b) === conversionRule(a) ? [] : conversionChanged(a)),
    watchCreate: (a) => (a.isActive === false ? [] : conversionChanged(a)),
    validate: async (d, { prisma }) => {
      const [from, to] = await Promise.all([
        prisma.unit.findFirst({ where: { id: d.fromUnitId, deletedAt: null } }),
        prisma.unit.findFirst({ where: { id: d.toUnitId, deletedAt: null } }),
      ]);
      if (!from || !to) throw bad('Selected unit does not exist');
      // Item-specific rules may cross unit types (1 Meter = 3.15 KG); generic rules may not.
      if (!d.itemId && from.unitType !== to.unitType) {
        throw bad(`Incompatible units: ${from.symbol} (${from.unitType}) cannot be converted to ${to.symbol} (${to.unitType}) without selecting an item`);
      }
      if (d.itemId && !(await prisma.item.findFirst({ where: { id: d.itemId, deletedAt: null } }))) throw bad('Selected item does not exist');
      if (d.formulaType === 'CUSTOM_FORMULA' && !d.formula) throw bad('formula: Enter the formula for a custom conversion');
    },
  },
  {
    path: 'items', model: 'item', entity: 'Item', module: 'items', schema: itemSchema,
    searchFields: ['name', 'code', 'description'], filters: ['typeId', 'groupId', 'categoryId', 'defaultSupplierId'],
    sortable: ['name', 'code', 'defaultPurchaseRate', 'createdAt'],
    include: {
      type: { select: { id: true, name: true } }, group: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } }, unit: { select: { id: true, symbol: true, unitType: true } },
      defaultSupplier: { select: { id: true, name: true } },
      unitConversions: { include: { unit: { select: { id: true, symbol: true, unitType: true } } } },
      suppliers: { include: { supplier: { select: { id: true, name: true } } } },
    },
    watch: (b, a) => {
      const out: ReturnType<NonNullable<MasterConfig['watch']>> = [];
      const rate = !same(b.defaultPurchaseRate, a.defaultPurchaseRate);
      const range = b.hasRateRange !== a.hasRateRange || !same(b.minRate, a.minRate) || !same(b.maxRate, a.maxRate) || !same(b.avgRate, a.avgRate);
      const sup = (x: any) => JSON.stringify(x.suppliers.map((s: any) => [s.supplierId, d(String(s.rate)).toString()]).sort());
      if (rate || range || sup(b) !== sup(a)) {
        out.push({ kind: 'ITEM_RATE', sourceId: a.id, sourceName: a.name, before: rate ? str(b.defaultPurchaseRate) : null, after: rate ? str(a.defaultPurchaseRate) : null, logHistory: rate, note: rate ? 'Rate edited in the item master' : 'Min / max / average or supplier rates edited' });
      }
      if (!same(b.gstPercent, a.gstPercent)) out.push({ kind: 'ITEM_GST', sourceId: a.id, sourceName: a.name, before: str(b.gstPercent), after: str(a.gstPercent), note: 'Item GST % edited' });
      const conv = (x: any) => JSON.stringify([x.unitId, ...x.unitConversions.map((c: any) => [c.unitId, d(String(c.conversionValue)).toString()]).sort()]);
      if (conv(b) !== conv(a)) out.push({ kind: 'ITEM_UNITS', sourceId: a.id, sourceName: a.name, note: 'Base unit or unit conversions edited' });
      return out;
    },
    references: [
      { model: 'areaConversion', field: 'itemId', label: 'conversion rule(s)', soft: true },
      { model: 'purchaseRate', field: 'itemId', label: 'purchase entr(ies)', soft: true },
      { model: 'templateItem', field: 'itemId', label: 'template line(s)', where: viaCategory },
      { model: 'costingMaterial', field: 'itemId', label: 'costing line(s)', where: viaCostingCategory },
    ],
    nested: {
      keys: ['unitConversions', 'suppliers'],
      save: async (tx, id, nested) => {
        await tx.itemUnitConversion.deleteMany({ where: { itemId: id } });
        await tx.itemSupplier.deleteMany({ where: { itemId: id } });
        if (nested.unitConversions.length) await tx.itemUnitConversion.createMany({ data: nested.unitConversions.map((c) => ({ itemId: id, unitId: c.unitId, conversionValue: c.conversionValue })) });
        if (nested.suppliers.length) await tx.itemSupplier.createMany({ data: nested.suppliers.map((s) => ({ itemId: id, supplierId: s.supplierId, rate: s.rate, isDefault: s.isDefault })) });
      },
    },
    // Min/Max/Average only apply when the item is flagged as capable; otherwise clear them.
    normalize: (d) => {
      const out = { ...d };
      const flagged = out.suppliers?.find((s: any) => s.isDefault);
      if (flagged) out.defaultSupplierId = flagged.supplierId;
      if (!out.hasRateRange) { out.minRate = null; out.maxRate = null; out.avgRate = null; }
      return out;
    },
    validate: async (d, { prisma }) => {
      const [type, group, category, unit] = await Promise.all([
        prisma.type.findFirst({ where: { id: d.typeId, deletedAt: null } }),
        prisma.itemGroup.findFirst({ where: { id: d.groupId, deletedAt: null } }),
        prisma.itemCategory.findFirst({ where: { id: d.categoryId, deletedAt: null } }),
        prisma.unit.findFirst({ where: { id: d.unitId, deletedAt: null } }),
      ]);
      if (!type) throw bad('typeId: Selected type does not exist');
      if (!group) throw bad('groupId: Selected group does not exist');
      if (!category) throw bad('categoryId: Selected category does not exist');
      if (!unit) throw bad('unitId: Selected unit does not exist');
      if (group.typeId !== type.id) throw bad('groupId: Group does not belong to the selected type');
      if (category.groupId !== group.id) throw bad('categoryId: Category does not belong to the selected group');
      if (d.unitConversions.some((c: any) => c.unitId === d.unitId)) throw bad('unitConversions: The base unit needs no conversion (it is always 1)');

      const unitIds = d.unitConversions.map((c: any) => c.unitId);
      if (unitIds.length && (await prisma.unit.count({ where: { id: { in: unitIds }, deletedAt: null } })) !== unitIds.length) throw bad('unitConversions: Unknown unit');
      const supplierIds = [...d.suppliers.map((s: any) => s.supplierId), ...(d.defaultSupplierId ? [d.defaultSupplierId] : [])];
      if (supplierIds.length && (await prisma.supplier.count({ where: { id: { in: [...new Set(supplierIds)] as string[] }, deletedAt: null } })) !== new Set(supplierIds).size) throw bad('suppliers: Unknown supplier');
    },
  },
  {
    path: 'customers', model: 'customer', entity: 'Customer', module: 'customers', schema: customerSchema,
    searchFields: ['name', 'code', 'contactPerson', 'mobile', 'email', 'gstin'], filters: ['customerGroupId'], sortable: ['name', 'code', 'createdAt'],
    include: { customerGroup: { select: { id: true, name: true, code: true } } },
    references: [{ model: 'quotation', field: 'customerId', label: 'quotation(s)', soft: true }],
    validate: async (d, { prisma }) => {
      if (d.customerGroupId && !(await prisma.customerGroup.findFirst({ where: { id: d.customerGroupId, deletedAt: null } }))) throw bad('customerGroupId: Selected customer group does not exist');
    },
  },
  {
    path: 'customer-groups', model: 'customerGroup', entity: 'CustomerGroup', module: 'customer_groups', schema: customerGroupSchema,
    searchFields: ['name', 'code'], sortable: ['name', 'code', 'createdAt'],
    references: [{ model: 'customer', field: 'customerGroupId', label: 'customer(s)', soft: true }],
  },
  {
    path: 'price-list-dealers', model: 'priceListDealer', entity: 'PriceListDealer', module: 'price_list_dealers', schema: priceListDealerSchema,
    searchFields: ['name', 'code'], sortable: ['name', 'code', 'marginPercent', 'createdAt'],
    // a new dealer, a new margin or switching a dealer on or off reprices the price list for that dealer
    watchCreate: (a) => [{ kind: 'DEALER', sourceId: a.id, sourceName: a.name, note: 'Price list dealer added' }],
    watch: (b, a) => (same(b.marginPercent, a.marginPercent) && b.isActive === a.isActive ? [] : [{ kind: 'DEALER', sourceId: a.id, sourceName: a.name, before: str(b.marginPercent), after: str(a.marginPercent), note: 'Dealer margin changed' }]),
    references: [{ model: 'userPriceListDealer', field: 'dealerId', label: 'user assignment(s)' }],
  },
];
