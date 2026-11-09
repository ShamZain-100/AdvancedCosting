import {
  areaConversionSchema, CONVERSION_FORMULAS, customerGroupSchema, customerSchema, priceListDealerSchema, EXPENSE_CALC_METHODS, expenseSchema, GST_TIMINGS, itemCategorySchema,
  itemGroupSchema, itemSchema, labourSchema, RATE_METHODS, supplierSchema, typeSchema, UNIT_TYPES, unitSchema,
} from '@costing/validators';
import type { FieldDef, MasterPageConfig } from '@/components/master-page';

const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));
const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const num = (v: unknown, dp = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: dp }));
const str = (v: unknown) => (v === null || v === undefined ? '' : String(Number(v)));

const text = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: 'text', ...extra });
const area = (name: string, label: string): FieldDef => ({ name, label, type: 'textarea', wide: true });
const decimal = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: 'decimal', ...extra });
const active: FieldDef = { name: 'isActive', label: 'Active', type: 'checkbox' };
const nameCode = [text('name', 'Name'), text('code', 'Code')];
const unitRemote = { path: '/units', label: (u: any) => `${u.name} (${u.symbol})`, master: 'units' };
const typeRemote = { path: '/types', label: (t: any) => t.name, master: 'types' };
const groupRemote = { path: '/item-groups', label: (g: any) => g.name, master: 'item-groups' };

/** API returns nulls; forms want blank strings. */
const blankNulls = (row: Record<string, any>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? '' : v]));

const colName = { header: 'Name', sort: 'name', cell: (r: any) => r.name };
const colCode = { header: 'Code', sort: 'code', cell: (r: any) => r.code };

export type MasterEntry = MasterPageConfig & { perm: string; nav: string };

export const MASTER_CONFIGS: Record<string, MasterEntry> = {
  types: {
    nav: 'Type Master', perm: 'types:view', title: 'Type Master', singular: 'Type', path: '/types', module: 'types', schema: typeSchema,
    defaults: { name: '', code: '', description: '', isActive: true },
    fields: [...nameCode, area('description', 'Description'), active],
    columns: [colName, colCode, { header: 'Description', cell: (r) => dash(r.description) },
      { header: 'Created', sort: 'createdAt', cell: (r) => new Date(r.createdAt).toLocaleDateString() }],
    toForm: blankNulls,
  },
  'item-groups': {
    nav: 'Item Group', perm: 'item_groups:view', title: 'Item Group Master', singular: 'Group', path: '/item-groups', module: 'item_groups', schema: itemGroupSchema,
    defaults: { name: '', code: '', typeId: '', description: '', isActive: true },
    fields: [...nameCode, { name: 'typeId', label: 'Type', type: 'select', remote: typeRemote }, area('description', 'Description'), active],
    columns: [colName, colCode, { header: 'Type', cell: (r) => r.type?.name }],
    filters: [{ param: 'typeId', label: 'Type', remote: typeRemote }],
    toForm: blankNulls,
  },
  'item-categories': {
    nav: 'Item Category', perm: 'item_categories:view', title: 'Item Category Master', singular: 'Category', path: '/item-categories', module: 'item_categories', schema: itemCategorySchema,
    defaults: { name: '', code: '', groupId: '', description: '', isActive: true },
    fields: [...nameCode, { name: 'groupId', label: 'Group', type: 'select', remote: groupRemote }, area('description', 'Description'), active],
    columns: [colName, colCode, { header: 'Group', cell: (r) => r.group?.name }],
    filters: [{ param: 'groupId', label: 'Group', remote: groupRemote }],
    toForm: blankNulls,
  },
  units: {
    nav: 'Unit Master', perm: 'units:view', title: 'Unit Master', singular: 'Unit', path: '/units', module: 'units', schema: unitSchema,
    defaults: { name: '', symbol: '', unitType: 'WEIGHT', decimalPrecision: 2, baseFactor: '', isActive: true },
    fields: [text('name', 'Unit name'), text('symbol', 'Symbol'), { name: 'unitType', label: 'Unit type', type: 'select', options: opts(UNIT_TYPES) },
      { name: 'decimalPrecision', label: 'Decimal precision', type: 'number' },
      text('baseFactor', 'Factor to base unit', { wide: true, hint: 'e.g. Gram = 0.001 (base KG). Units convert only within the same type and when both have a factor.' }), active],
    columns: [colName, { header: 'Symbol', sort: 'symbol', cell: (r) => r.symbol }, { header: 'Type', sort: 'unitType', cell: (r) => r.unitType },
      { header: 'Precision', cell: (r) => r.decimalPrecision }, { header: 'Base factor', cell: (r) => (r.baseFactor ? num(r.baseFactor, 6) : '—') }],
    filters: [{ param: 'unitType', label: 'Type', options: opts(UNIT_TYPES) }],
    toForm: (r) => ({ ...blankNulls(r), baseFactor: str(r.baseFactor) }),
  },
  suppliers: {
    nav: 'Supplier Master', perm: 'suppliers:view', title: 'Supplier Master', singular: 'Supplier', path: '/suppliers', module: 'suppliers', schema: supplierSchema,
    searchHint: 'Search name, code, contact, GSTIN…',
    defaults: { name: '', code: '', contactPerson: '', mobile: '', email: '', address: '', gstin: '', state: '', openingBalance: '0', paymentTerms: '', notes: '', isActive: true },
    fields: [...nameCode, text('contactPerson', 'Contact person'), text('mobile', 'Mobile'), { ...text('email', 'Email'), type: 'email' }, text('gstin', 'GSTIN'),
      text('state', 'State'), decimal('openingBalance', 'Opening balance'), text('paymentTerms', 'Payment terms'), area('address', 'Address'), area('notes', 'Notes'), active],
    columns: [colName, colCode, { header: 'Group', cell: (r) => dash(r.group?.name) }, { header: 'Contact', cell: (r) => dash(r.contactPerson) }, { header: 'Mobile', cell: (r) => dash(r.mobile) }, { header: 'GSTIN', cell: (r) => dash(r.gstin) }],
    toForm: (r) => ({ ...blankNulls(r), openingBalance: str(r.openingBalance) || '0' }),
  },
  labour: {
    nav: 'Labour Master', perm: 'labour:view', title: 'Labour Master', singular: 'Labour', path: '/labour', module: 'labour', schema: labourSchema,
    defaults: { name: '', code: '', defaultRate: '0', unitId: '', typeId: '', description: '', isActive: true },
    fields: [...nameCode, decimal('defaultRate', 'Default rate'), { name: 'unitId', label: 'Unit', type: 'select', remote: unitRemote },
      { name: 'typeId', label: 'Type (optional)', type: 'select', remote: typeRemote }, area('description', 'Description'), active],
    columns: [colName, colCode, { header: 'Rate', sort: 'defaultRate', cell: (r) => num(r.defaultRate) },
      { header: 'Unit', cell: (r) => r.unit?.symbol ?? '—' }, { header: 'Type', cell: (r) => r.type?.name ?? '—' }],
    toForm: (r) => ({ ...blankNulls(r), defaultRate: str(r.defaultRate) }),
  },
  expenses: {
    nav: 'Expense Master', perm: 'expenses:view', title: 'Expense Master', singular: 'Expense', path: '/expenses', module: 'expenses', schema: expenseSchema,
    defaults: { name: '', code: '', calculationMethod: 'FIXED', defaultValue: '0', applyTiming: 'BEFORE_GST', isCompanyExpense: false, isActive: true },
    fields: [...nameCode, { name: 'calculationMethod', label: 'Calculation method', type: 'select', options: opts(EXPENSE_CALC_METHODS) },
      decimal('defaultValue', 'Default value (amount, % or per-qty rate)'), { name: 'applyTiming', label: 'Apply', type: 'select', options: opts(GST_TIMINGS) },
      { name: 'isCompanyExpense', label: 'Company expense', type: 'checkbox', wide: true, hint: 'Added automatically (locked) to every costing and shown separately in reports. A change reaches all live costings; approved costings keep theirs.' }, active],
    columns: [colName, colCode, { header: 'Method', cell: (r) => r.calculationMethod },
      { header: 'Default', cell: (r) => (r.calculationMethod === 'PERCENTAGE' ? `${num(r.defaultValue)}%` : num(r.defaultValue)) },
      { header: 'Applied', cell: (r) => String(r.applyTiming).replace('_', ' ') },
      { header: 'Kind', cell: (r) => (r.isCompanyExpense ? 'Company' : 'Product') }],
    filters: [{ param: 'calculationMethod', label: 'Method', options: opts(EXPENSE_CALC_METHODS) }],
    toForm: (r) => ({ ...blankNulls(r), defaultValue: str(r.defaultValue) }),
  },
  conversions: {
    nav: 'Area / Conversion', perm: 'conversions:view', title: 'Area / Conversion Master', singular: 'Conversion', path: '/conversions', module: 'conversions', schema: areaConversionSchema,
    defaults: { name: '', fromUnitId: '', toUnitId: '', conversionValue: '', itemId: '', formulaType: 'FIXED_FACTOR', formula: '', isActive: true },
    fields: [text('name', 'Conversion name'),
      { name: 'itemId', label: 'Applicable item (optional)', type: 'select', remote: { path: '/items', label: (i: any) => `${i.name} (${i.code})`, master: 'items' }, hint: 'Leave blank for a reusable rule; the units must then be the same type.' },
      { name: 'fromUnitId', label: 'From unit (1 of…)', type: 'select', remote: unitRemote }, { name: 'toUnitId', label: 'To unit', type: 'select', remote: unitRemote },
      decimal('conversionValue', '1 from-unit equals … to-unit'),
      { name: 'formulaType', label: 'Formula type', type: 'select', options: opts(CONVERSION_FORMULAS) },
      { ...text('formula', 'Custom formula'), wide: true, showIf: (v) => v.formulaType === 'CUSTOM_FORMULA', hint: 'Kept for reference only. Calculations use fixed-factor rules, so this rule will not convert anything.' }, active],
    columns: [colName, { header: 'Rule', cell: (r) => `1 ${r.fromUnit.symbol} = ${num(r.conversionValue, 6)} ${r.toUnit.symbol}` },
      { header: 'Item', cell: (r) => r.item?.name ?? 'Any' }, { header: 'Type', cell: (r) => String(r.formulaType).replace('_', ' ') }],
    toForm: (r) => ({ ...blankNulls(r), conversionValue: str(r.conversionValue) }),
  },
  items: {
    nav: 'Item Master', perm: 'items:view', title: 'Item Master', singular: 'Item', path: '/items', module: 'items', schema: itemSchema,
    searchHint: 'Search name, code, description…',
    defaults: { name: '', code: '', typeId: '', groupId: '', categoryId: '', description: '', unitId: '', defaultSupplierId: '', defaultPurchaseRate: '0', hasRateRange: false,
      minRate: '', maxRate: '', avgRate: '', rateMethod: 'LAST_PURCHASE', gstPercent: '0', unitConversions: [], suppliers: [], isActive: true },
    fields: [
      ...nameCode,
      { name: 'typeId', label: 'Type', type: 'select', remote: typeRemote, resets: ['groupId', 'categoryId'] },
      { name: 'groupId', label: 'Item group', type: 'select', remote: { ...groupRemote, filterBy: 'typeId' }, resets: ['categoryId'] },
      { name: 'categoryId', label: 'Item category', type: 'select', remote: { path: '/item-categories', label: (c: any) => c.name, filterBy: 'groupId', master: 'item-categories' } },
      { name: 'unitId', label: 'Base unit', type: 'select', remote: unitRemote },
      decimal('defaultPurchaseRate', 'Default purchase rate (per base unit)'),
      decimal('gstPercent', 'GST %'),
      { name: 'defaultSupplierId', label: 'Default supplier', type: 'select', remote: { path: '/suppliers', label: (s: any) => s.name, master: 'suppliers' } },
      { name: 'hasRateRange', label: 'Is capable for Min / Max / Average?', type: 'checkbox', wide: true },
      decimal('minRate', 'Minimum rate', { showIf: (v) => !!v.hasRateRange }),
      decimal('maxRate', 'Maximum rate', { showIf: (v) => !!v.hasRateRange }),
      decimal('avgRate', 'Average rate', { showIf: (v) => !!v.hasRateRange }),
      { name: 'rateMethod', label: 'Rate calculation method', type: 'select', options: opts(RATE_METHODS), showIf: (v) => !!v.hasRateRange },
      area('description', 'Description'),
      { name: 'unitConversions', label: 'Unit conversions', addLabel: 'Add unit', blank: { unitId: '', conversionValue: '' },
        hint: '1 of this unit = value × base unit (e.g. base KG: 1 Meter = 3.15).',
        fields: [{ name: 'unitId', label: 'Unit', type: 'select', remote: unitRemote }, decimal('conversionValue', 'Equals (base units)')] },
      { name: 'suppliers', label: 'Suppliers & rates', addLabel: 'Add supplier', blank: { supplierId: '', rate: '0', isDefault: false },
        fields: [{ name: 'supplierId', label: 'Supplier', type: 'select', remote: { path: '/suppliers', label: (s: any) => s.name, master: 'suppliers' } }, decimal('rate', 'Rate'),
          { name: 'isDefault', label: 'Default', type: 'checkbox' }] },
      active,
    ],
    columns: [colName, colCode, { header: 'Type', cell: (r) => r.type?.name }, { header: 'Group', cell: (r) => r.group?.name }, { header: 'Category', cell: (r) => r.category?.name },
      { header: 'Rate', sort: 'defaultPurchaseRate', cell: (r) => `${num(r.defaultPurchaseRate)} / ${r.unit?.symbol}` }, { header: 'GST', cell: (r) => `${num(r.gstPercent)}%` }],
    filters: [{ param: 'typeId', label: 'Type', remote: typeRemote }, { param: 'groupId', label: 'Group', remote: groupRemote }],
    toForm: (r) => ({
      ...blankNulls(r),
      defaultPurchaseRate: str(r.defaultPurchaseRate), gstPercent: str(r.gstPercent), minRate: str(r.minRate), maxRate: str(r.maxRate), avgRate: str(r.avgRate),
      unitConversions: r.unitConversions.map((c: any) => ({ unitId: c.unitId, conversionValue: str(c.conversionValue) })),
      suppliers: r.suppliers.map((s: any) => ({ supplierId: s.supplierId, rate: str(s.rate), isDefault: s.isDefault })),
    }),
  },
  priceListDealers: {
    nav: 'Price List Dealers', perm: 'price_list_dealers:view', title: 'Price List Dealers', singular: 'Price list dealer', path: '/price-list-dealers', module: 'price_list_dealers', schema: priceListDealerSchema,
    searchHint: 'Search name, code…',
    defaults: { name: '', code: '', description: '', marginPercent: '0', isActive: true },
    fields: [...nameCode, decimal('marginPercent', 'Profit margin %', { hint: 'Added on top of cost for this dealer, like the costing markup %. Every published costing gets a price for this dealer from it.' }), area('description', 'Description'), active],
    columns: [colName, colCode, { header: 'Margin %', sort: 'marginPercent', cell: (r) => `${num(r.marginPercent)}%` }, { header: 'Description', cell: (r) => dash(r.description) }],
    toForm: (r) => ({ ...blankNulls(r), marginPercent: str(r.marginPercent) }),
  },
  customerGroups: {
    nav: 'Customer Groups', perm: 'customer_groups:view', title: 'Customer Groups', singular: 'Customer group', path: '/customer-groups', module: 'customer_groups', schema: customerGroupSchema,
    searchHint: 'Search name, code…',
    defaults: { name: '', code: '', description: '', isActive: true },
    fields: [...nameCode, area('description', 'Description'), active],
    columns: [colName, colCode, { header: 'Description', cell: (r) => dash(r.description) }],
    toForm: blankNulls,
  },
  customers: {
    nav: 'Customers', perm: 'customers:view', title: 'Customers', singular: 'Customer', path: '/customers', module: 'customers', schema: customerSchema,
    searchHint: 'Search name, code, contact, GSTIN…',
    defaults: { name: '', code: '', contactPerson: '', mobile: '', email: '', customerGroupId: '', address: '', gstin: '', state: '', notes: '', isActive: true },
    fields: [...nameCode, { name: 'customerGroupId', label: 'Customer group', type: 'select', remote: { path: '/customer-groups', label: (g: any) => g.name, master: 'customerGroups' } },
      text('contactPerson', 'Contact person'), text('mobile', 'Mobile'), { ...text('email', 'Email'), type: 'email' }, text('gstin', 'GSTIN'),
      text('state', 'State'), area('address', 'Address'), area('notes', 'Notes'), active],
    columns: [colName, colCode, { header: 'Contact', cell: (r) => dash(r.contactPerson) }, { header: 'Mobile', cell: (r) => dash(r.mobile) }, { header: 'GSTIN', cell: (r) => dash(r.gstin) }],
    filters: [{ param: 'customerGroupId', label: 'Customer group', remote: { path: '/customer-groups', label: (g: any) => g.name } }],
    toForm: blankNulls,
  },
};
