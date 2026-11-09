import type { PermissionModule } from '@costing/config';
import { Col } from './excel-io';
import { MASTERS } from '../masters/masters.config';
import type { MasterConfig } from '../masters/master.types';

/** Lookup tables loaded once per import so rows can refer to other masters by code. */
export interface Refs {
  types: Map<string, { id: string }>;
  groups: Map<string, { id: string; typeId: string }>;
  categories: Map<string, { id: string; groupId: string }>;
  units: Map<string, { id: string }>;
  suppliers: Map<string, { id: string }>;
}
export type RefName = keyof Refs;

export interface MasterKind {
  kind: string;
  label: string;
  module: PermissionModule;
  cfg: MasterConfig;
  /** unique natural key of the master (checked for duplicates) */
  naturalKey: 'code' | 'symbol';
  columns: Col[];
  needs: RefName[];
  notes?: string[];
  /** raw cell strings → payload for the master's Zod schema; push human-readable problems to `err` */
  build(raw: Record<string, string>, refs: Refs, err: string[]): Record<string, unknown>;
  /** DB include used by the Excel export, and its mapping back to the template columns */
  exportInclude?: Record<string, unknown>;
  toRow(e: any): Record<string, string>;
}

const cfgOf = (path: string) => MASTERS.find((m) => m.path === path)!;
const col = (key: string, header: string, help: string, o: Partial<Col> = {}): Col => ({ key, header, help, ...o });
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => (v === null || v === undefined ? '' : String(Number(v.toString())));

const active = col('active', 'Active', 'Y or N (blank = Y).', { example: 'Y', width: 10 });
const parseActive = (v: string, err: string[]): boolean => {
  if (v === '' || /^(y|yes|true|1|active)$/i.test(v)) return true;
  if (/^(n|no|false|0|inactive)$/i.test(v)) return false;
  err.push(`Active must be Y or N (got "${v}")`);
  return true;
};
const yn = (b: boolean) => (b ? 'Y' : 'N');

/** Resolve a code to an id, recording a clear message when it is missing or unknown. */
export function ref<T>(map: Map<string, T>, code: string, label: string, err: string[], required = true): T | undefined {
  if (!code) { if (required) err.push(`${label} is required`); return undefined; }
  const hit = map.get(code.toLowerCase());
  if (!hit) err.push(`Unknown ${label.toLowerCase()} "${code}"`);
  return hit;
}

/** "M=3.15; FT=0.3048" → [{key, value, flag}] (a trailing * sets flag) */
function pairs(text: string, label: string, err: string[]): { key: string; value: string; flag: boolean }[] {
  if (!text) return [];
  return text.split(/[;\n]/).map((p) => p.trim()).filter(Boolean).flatMap((p) => {
    const m = /^([^=]+)=\s*([0-9.]+)\s*(\*)?$/.exec(p);
    if (!m) { err.push(`${label}: cannot read "${p}" (expected CODE=number)`); return []; }
    return [{ key: m[1].trim(), value: m[2], flag: !!m[3] }];
  });
}

export const KINDS: MasterKind[] = [
  {
    kind: 'types', label: 'Types', module: 'types', cfg: cfgOf('types'), naturalKey: 'code', needs: [],
    columns: [col('code', 'Code', 'Unique code, letters/digits . _ - only.', { required: true, example: 'CHAIRS' }), col('name', 'Name', 'Type name.', { required: true, example: 'Chairs' }), col('description', 'Description', 'Optional.'), active],
    build: (r, _x, err) => ({ code: r.code, name: r.name, description: r.description, isActive: parseActive(r.active, err) }),
    toRow: (e) => ({ code: e.code, name: e.name, description: s(e.description), active: yn(e.isActive) }),
  },
  {
    kind: 'item-groups', label: 'Item groups', module: 'item_groups', cfg: cfgOf('item-groups'), naturalKey: 'code', needs: ['types'], notes: ['Import Types first: every group needs an existing Type Code.'],
    columns: [col('code', 'Code', 'Unique code.', { required: true, example: 'METAL' }), col('name', 'Name', 'Group name.', { required: true, example: 'Metal' }), col('typeCode', 'Type Code', 'Code of an existing type.', { required: true, example: 'CHAIRS' }), col('description', 'Description', 'Optional.'), active],
    build: (r, x, err) => ({ code: r.code, name: r.name, typeId: ref(x.types, r.typeCode, 'Type code', err)?.id ?? '', description: r.description, isActive: parseActive(r.active, err) }),
    exportInclude: { type: { select: { code: true } } },
    toRow: (e) => ({ code: e.code, name: e.name, typeCode: e.type.code, description: s(e.description), active: yn(e.isActive) }),
  },
  {
    kind: 'item-categories', label: 'Item categories', module: 'item_categories', cfg: cfgOf('item-categories'), naturalKey: 'code', needs: ['groups'], notes: ['Import Item groups first.'],
    columns: [col('code', 'Code', 'Unique code.', { required: true, example: 'METAL-FRAME' }), col('name', 'Name', 'Category name.', { required: true, example: 'Metal Frame' }), col('groupCode', 'Group Code', 'Code of an existing item group.', { required: true, example: 'METAL' }), col('description', 'Description', 'Optional.'), active],
    build: (r, x, err) => ({ code: r.code, name: r.name, groupId: ref(x.groups, r.groupCode, 'Group code', err)?.id ?? '', description: r.description, isActive: parseActive(r.active, err) }),
    exportInclude: { group: { select: { code: true } } },
    toRow: (e) => ({ code: e.code, name: e.name, groupCode: e.group.code, description: s(e.description), active: yn(e.isActive) }),
  },
  {
    kind: 'units', label: 'Units', module: 'units', cfg: cfgOf('units'), naturalKey: 'symbol', needs: [],
    columns: [col('symbol', 'Symbol', 'Unique symbol.', { required: true, example: 'KG' }), col('name', 'Name', 'Unit name.', { required: true, example: 'Kilogram' }),
      col('unitType', 'Unit Type', 'WEIGHT, LENGTH, AREA, VOLUME, COUNT or OTHER.', { required: true, example: 'WEIGHT' }), col('decimalPrecision', 'Decimal Precision', '0-6 (blank = 2).', { example: '3' }),
      col('baseFactor', 'Base Factor', 'Multiplier to the base unit of its type (Gram = 0.001 when KG is the base). Blank = no generic conversion.', { example: '1' }), active],
    build: (r, _x, err) => ({ symbol: r.symbol, name: r.name, unitType: r.unitType.toUpperCase(), decimalPrecision: r.decimalPrecision === '' ? 2 : r.decimalPrecision, baseFactor: r.baseFactor, isActive: parseActive(r.active, err) }),
    toRow: (e) => ({ symbol: e.symbol, name: e.name, unitType: e.unitType, decimalPrecision: s(e.decimalPrecision), baseFactor: e.baseFactor ? num(e.baseFactor) : '', active: yn(e.isActive) }),
  },
  {
    kind: 'suppliers', label: 'Suppliers', module: 'suppliers', cfg: cfgOf('suppliers'), naturalKey: 'code', needs: [],
    columns: [col('code', 'Code', 'Unique code.', { required: true, example: 'SUP01' }), col('name', 'Name', 'Supplier name.', { required: true }), col('contactPerson', 'Contact Person', 'Optional.'), col('mobile', 'Mobile', 'Optional.'),
      col('email', 'Email', 'Optional.'), col('address', 'Address', 'Optional.'), col('gstin', 'GSTIN', '15-character GSTIN, optional.', { example: '27ABCDE1234F1Z5' }), col('state', 'State', 'Optional.'),
      col('openingBalance', 'Opening Balance', 'Number, blank = 0.', { example: '0' }), col('paymentTerms', 'Payment Terms', 'Optional.'), col('notes', 'Notes', 'Optional.'), active],
    build: (r, _x, err) => ({ code: r.code, name: r.name, contactPerson: r.contactPerson, mobile: r.mobile, email: r.email, address: r.address, gstin: r.gstin, state: r.state, openingBalance: r.openingBalance || '0', paymentTerms: r.paymentTerms, notes: r.notes, isActive: parseActive(r.active, err) }),
    toRow: (e) => ({ code: e.code, name: e.name, contactPerson: s(e.contactPerson), mobile: s(e.mobile), email: s(e.email), address: s(e.address), gstin: s(e.gstin), state: s(e.state), openingBalance: num(e.openingBalance), paymentTerms: s(e.paymentTerms), notes: s(e.notes), active: yn(e.isActive) }),
  },
  {
    kind: 'customers', label: 'Customers', module: 'customers', cfg: cfgOf('customers'), naturalKey: 'code', needs: [],
    columns: [col('code', 'Code', 'Unique code.', { required: true, example: 'CUST01' }), col('name', 'Name', 'Customer name.', { required: true }), col('contactPerson', 'Contact Person', 'Optional.'), col('mobile', 'Mobile', 'Optional.'),
      col('email', 'Email', 'Optional.'), col('address', 'Address', 'Optional.'), col('gstin', 'GSTIN', 'Optional.'), col('state', 'State', 'Optional.'), col('notes', 'Notes', 'Optional.'), active],
    build: (r, _x, err) => ({ code: r.code, name: r.name, contactPerson: r.contactPerson, mobile: r.mobile, email: r.email, address: r.address, gstin: r.gstin, state: r.state, notes: r.notes, isActive: parseActive(r.active, err) }),
    toRow: (e) => ({ code: e.code, name: e.name, contactPerson: s(e.contactPerson), mobile: s(e.mobile), email: s(e.email), address: s(e.address), gstin: s(e.gstin), state: s(e.state), notes: s(e.notes), active: yn(e.isActive) }),
  },
  {
    kind: 'labour', label: 'Labour', module: 'labour', cfg: cfgOf('labour'), naturalKey: 'code', needs: ['units', 'types'],
    columns: [col('code', 'Code', 'Unique code.', { required: true, example: 'LAB-METAL' }), col('name', 'Name', 'Labour name.', { required: true, example: 'Metal Labour' }), col('defaultRate', 'Default Rate', 'Number, blank = 0.', { example: '1200' }),
      col('unitSymbol', 'Unit Symbol', 'Optional, symbol of an existing unit.', { example: 'PC' }), col('typeCode', 'Type Code', 'Optional, code of an existing type.'), col('description', 'Description', 'Optional.'), active],
    build: (r, x, err) => ({ code: r.code, name: r.name, defaultRate: r.defaultRate || '0', unitId: r.unitSymbol ? (ref(x.units, r.unitSymbol, 'Unit symbol', err)?.id ?? '') : '', typeId: r.typeCode ? (ref(x.types, r.typeCode, 'Type code', err)?.id ?? '') : '', description: r.description, isActive: parseActive(r.active, err) }),
    exportInclude: { unit: { select: { symbol: true } }, type: { select: { code: true } } },
    toRow: (e) => ({ code: e.code, name: e.name, defaultRate: num(e.defaultRate), unitSymbol: e.unit?.symbol ?? '', typeCode: e.type?.code ?? '', description: s(e.description), active: yn(e.isActive) }),
  },
  {
    kind: 'expenses', label: 'Expenses', module: 'expenses', cfg: cfgOf('expenses'), naturalKey: 'code', needs: [],
    columns: [col('code', 'Code', 'Unique code.', { required: true, example: 'TRANSPORT' }), col('name', 'Name', 'Expense name.', { required: true, example: 'Transportation' }),
      col('method', 'Calculation Method', 'FIXED, PERCENTAGE or QUANTITY_BASED.', { required: true, example: 'FIXED' }), col('value', 'Default Value', 'Amount, percentage or per-unit rate. Blank = 0.', { example: '100' }),
      col('timing', 'Apply', 'BEFORE_GST or AFTER_GST (blank = BEFORE_GST).', { example: 'BEFORE_GST' }), active],
    build: (r, _x, err) => ({ code: r.code, name: r.name, calculationMethod: r.method.toUpperCase().replace(/ /g, '_'), defaultValue: r.value || '0', applyTiming: (r.timing || 'BEFORE_GST').toUpperCase().replace(/ /g, '_'), isActive: parseActive(r.active, err) }),
    toRow: (e) => ({ code: e.code, name: e.name, method: e.calculationMethod, value: num(e.defaultValue), timing: e.applyTiming, active: yn(e.isActive) }),
  },
  {
    kind: 'items', label: 'Items', module: 'items', cfg: cfgOf('items'), naturalKey: 'code', needs: ['types', 'groups', 'categories', 'units', 'suppliers'],
    notes: ['Import Types, Item groups, Item categories, Units and Suppliers first.', 'Unit Conversions: "M=3.15; FT=0.9" means 1 M = 3.15 base units, 1 FT = 0.9 base units.', 'Suppliers: "SUP01=95; SUP02=97*" gives each supplier\'s rate per base unit; * marks the default supplier.'],
    columns: [col('code', 'Code', 'Unique item code.', { required: true, example: 'MPM' }), col('name', 'Name', 'Item name.', { required: true, example: 'Metal Pipe MAX' }),
      col('typeCode', 'Type Code', 'Existing type.', { required: true, example: 'CHAIRS' }), col('groupCode', 'Group Code', 'Existing group of that type.', { required: true, example: 'METAL' }), col('categoryCode', 'Category Code', 'Existing category of that group.', { required: true, example: 'METAL-FRAME' }),
      col('unitSymbol', 'Base Unit', 'Symbol of the base unit.', { required: true, example: 'KG' }), col('rate', 'Default Purchase Rate', 'Per base unit, blank = 0.', { example: '98' }), col('gst', 'GST %', 'Blank = 0.', { example: '18' }),
      col('rangeCapable', 'Min/Max/Avg Capable', 'Y or N (blank = N). Y enables the min, max, average and rate method columns.', { example: 'N' }), col('minRate', 'Min Rate', 'Only when capable.'), col('maxRate', 'Max Rate', 'Only when capable.'), col('avgRate', 'Avg Rate', 'Only when capable.'),
      col('rateMethod', 'Rate Method', 'LAST_PURCHASE, WEIGHTED_AVERAGE, SIMPLE_AVERAGE or MANUAL (blank = LAST_PURCHASE).'), col('defaultSupplier', 'Default Supplier Code', 'Optional.'),
      col('conversions', 'Unit Conversions', 'See instructions above.', { example: 'M=3.15', width: 28 }), col('suppliers', 'Suppliers', 'See instructions above.', { example: 'SUP01=95*', width: 28 }), col('description', 'Description', 'Optional.'), active],
    build: (r, x, err) => {
      const group = ref(x.groups, r.groupCode, 'Group code', err);
      const conversions = pairs(r.conversions, 'Unit Conversions', err).flatMap((p) => { const u = ref(x.units, p.key, 'Unit symbol', err); return u ? [{ unitId: u.id, conversionValue: p.value }] : []; });
      const suppliers = pairs(r.suppliers, 'Suppliers', err).flatMap((p) => { const sp = ref(x.suppliers, p.key, 'Supplier code', err); return sp ? [{ supplierId: sp.id, rate: p.value, isDefault: p.flag }] : []; });
      const capable = /^(y|yes|true|1)$/i.test(r.rangeCapable);
      if (r.rangeCapable && !capable && !/^(n|no|false|0)$/i.test(r.rangeCapable)) err.push(`Min/Max/Avg Capable must be Y or N (got "${r.rangeCapable}")`);
      if (!capable && (r.minRate || r.maxRate || r.avgRate)) err.push('Min/Max/Avg rates are only allowed when Min/Max/Avg Capable is Y');
      return {
        code: r.code, name: r.name, typeId: ref(x.types, r.typeCode, 'Type code', err)?.id ?? '', groupId: group?.id ?? '', categoryId: ref(x.categories, r.categoryCode, 'Category code', err)?.id ?? '',
        unitId: ref(x.units, r.unitSymbol, 'Base unit', err)?.id ?? '', defaultPurchaseRate: r.rate || '0', gstPercent: r.gst || '0', hasRateRange: capable,
        minRate: r.minRate, maxRate: r.maxRate, avgRate: r.avgRate, rateMethod: (r.rateMethod || 'LAST_PURCHASE').toUpperCase().replace(/ /g, '_'),
        defaultSupplierId: r.defaultSupplier ? (ref(x.suppliers, r.defaultSupplier, 'Supplier code', err)?.id ?? '') : '', description: r.description, unitConversions: conversions, suppliers, isActive: parseActive(r.active, err),
      };
    },
    exportInclude: { type: { select: { code: true } }, group: { select: { code: true } }, category: { select: { code: true } }, unit: { select: { symbol: true } }, defaultSupplier: { select: { code: true } }, unitConversions: { include: { unit: { select: { symbol: true } } } }, suppliers: { include: { supplier: { select: { code: true } } } } },
    toRow: (e) => ({
      code: e.code, name: e.name, typeCode: e.type.code, groupCode: e.group.code, categoryCode: e.category.code, unitSymbol: e.unit.symbol, rate: num(e.defaultPurchaseRate), gst: num(e.gstPercent),
      rangeCapable: yn(e.hasRateRange), minRate: e.minRate ? num(e.minRate) : '', maxRate: e.maxRate ? num(e.maxRate) : '', avgRate: e.avgRate ? num(e.avgRate) : '', rateMethod: e.rateMethod, defaultSupplier: e.defaultSupplier?.code ?? '',
      conversions: e.unitConversions.map((c: any) => `${c.unit.symbol}=${num(c.conversionValue)}`).join('; '), suppliers: e.suppliers.map((p: any) => `${p.supplier.code}=${num(p.rate)}${p.isDefault ? '*' : ''}`).join('; '),
      description: s(e.description), active: yn(e.isActive),
    }),
  },
];

export const kindOf = (kind: string) => KINDS.find((k) => k.kind === kind);
