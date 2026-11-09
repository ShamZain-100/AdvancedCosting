import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

/**
 * Guards the database design: these tests read prisma/schema.prisma and the migration files, so a
 * future change that breaks a convention (missing index, float money, silent SET NULL…) fails here.
 */
const ROOT = path.resolve(__dirname, '../../../../prisma');
const schema = readFileSync(path.join(ROOT, 'schema.prisma'), 'utf8');

interface Field { name: string; type: string; optional: boolean; list: boolean; attrs: string }
interface Model { name: string; fields: Field[]; block: string[] }

const models: Model[] = [...schema.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)].map((m) => {
  const lines = m[2].split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean);
  return {
    name: m[1],
    block: lines.filter((l) => l.startsWith('@@')),
    fields: lines.filter((l) => !l.startsWith('@@')).flatMap((l) => {
      const f = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(l);
      return f ? [{ name: f[1], type: f[2], list: !!f[3], optional: !!f[4], attrs: f[5] }] : [];
    }),
  };
});
const enums = new Set([...schema.matchAll(/^enum (\w+) \{/gm)].map((m) => m[1]));
const byName = new Map(models.map((m) => [m.name, m]));
const SCALARS = new Set(['String', 'Int', 'Boolean', 'DateTime', 'Decimal', 'Json', 'BigInt', 'Float', 'Bytes']);

/** columns that start an index or key, in any form */
function leadingColumns(m: Model): Set<string> {
  const out = new Set<string>();
  for (const b of m.block) {
    const k = /^@@(?:index|unique|id)\(\[([^\]]+)\]/.exec(b);
    if (k) out.add(k[1].split(',')[0].trim().replace(/\(.*$/, ''));
  }
  for (const f of m.fields) if (/@id\b|@unique\b/.test(f.attrs)) out.add(f.name);
  return out;
}
const relations = models.flatMap((m) => m.fields.filter((f) => /@relation\(/.test(f.attrs) && /fields:\s*\[/.test(f.attrs)).map((f) => ({
  model: m.name, field: f.name, optional: f.optional, target: f.type,
  fk: /fields:\s*\[([^\]]+)\]/.exec(f.attrs)![1].split(',').map((x) => x.trim()),
  onDelete: /onDelete:\s*(\w+)/.exec(f.attrs)?.[1] ?? null,
})));

describe('schema: entities', () => {
  const REQUIRED = [
    'User', 'Role', 'Permission', 'UserRole', 'RolePermission', 'UserPermission', 'Type', 'ItemGroup', 'ItemCategory', 'Item', 'ItemUnitConversion', 'Unit', 'Supplier', 'ItemSupplier',
    'PurchaseRateHistory', 'PurchaseRate', 'Labour', 'Expense', 'AreaConversion', 'Template', 'TemplateGroup', 'TemplateCategory', 'TemplateItem', 'TemplateLabour', 'TemplateExpense',
    'Costing', 'CostingGroup', 'CostingCategory', 'CostingMaterial', 'CostingLabour', 'CostingExpense', 'CostingImage', 'PriceList', 'PriceListItem', 'Customer', 'Quotation', 'QuotationItem',
    'CompanySettings', 'CostingSettings', 'AuditLog', 'ImportHistory', 'FileAttachment',
  ];
  it('contains every entity the specification requires', () => {
    expect(REQUIRED.filter((n) => !byName.has(n))).toEqual([]);
    expect(REQUIRED).toHaveLength(42);
  });
  it('was parsed sensibly', () => { expect(models.length).toBeGreaterThanOrEqual(49); });
});

describe('schema: keys and types', () => {
  it('uses UUID primary keys (except small singleton / key-value tables and join tables)', () => {
    const allowed = new Set(['NumberSequence', 'CostingSettings', 'CompanySettings', 'AppSettings']);
    const bad = models.filter((m) => !allowed.has(m.name) && m.fields.some((f) => f.name === 'id') && !m.fields.find((f) => f.name === 'id')!.attrs.includes('@default(uuid())')).map((m) => m.name);
    expect(bad).toEqual([]);
    const noKey = models.filter((m) => !m.fields.some((f) => /@id\b/.test(f.attrs)) && !m.block.some((b) => b.startsWith('@@id'))).map((m) => m.name);
    expect(noKey).toEqual([]);
  });

  it('never uses floating point types (money and quantities are Decimal)', () => {
    expect(models.flatMap((m) => m.fields.filter((f) => f.type === 'Float' || f.type === 'Bytes').map((f) => `${m.name}.${f.name}`))).toEqual([]);
  });

  it('stores money-like columns as Decimal, never as Int / String', () => {
    const moneyName = /(Rate|Price|Amount|Cost|Total|Balance|Gst|Markup|Profit|Discount|Wastage|Quantity)$|^(rate|quantity|total|amount|value|conversionValue|baseFactor|profitValue|roundTo)$/;
    const notMoney = new Set(['NumberSequence.value', 'rateMethod', 'rateBasis', 'wastageMode', 'profitMethod', 'costBase', 'gstTreatment', 'defaultProfitMethod']);
    const bad = models.flatMap((m) => m.fields.filter((f) => !f.list && SCALARS.has(f.type) && moneyName.test(f.name) && !notMoney.has(f.name) && !notMoney.has(`${m.name}.${f.name}`) && f.type !== 'Decimal' && f.type !== 'Boolean' && f.type !== 'Json' && f.type !== 'DateTime').map((f) => `${m.name}.${f.name}:${f.type}`));
    expect(bad).toEqual([]);
  });

  it('every soft-deletable table also keeps createdAt / updatedAt (purchase entries are immutable, so they have no updatedAt)', () => {
    const immutable = new Set(['PurchaseRate']);
    const bad = models.filter((m) => !immutable.has(m.name) && m.fields.some((f) => f.name === 'deletedAt') && !(m.fields.some((f) => f.name === 'createdAt') && m.fields.some((f) => f.name === 'updatedAt'))).map((m) => m.name);
    expect(bad).toEqual([]);
  });

  it('master and document tables record who created / last changed them', () => {
    for (const name of ['Type', 'ItemGroup', 'ItemCategory', 'Unit', 'Supplier', 'Labour', 'Expense', 'AreaConversion', 'Item', 'Template', 'Costing', 'PriceList', 'Quotation', 'Customer']) {
      const names = byName.get(name)!.fields.map((f) => f.name);
      expect([name, names.includes('createdBy'), names.includes('updatedBy')]).toEqual([name, true, true]);
    }
  });

  it('references only models and enums that exist', () => {
    const bad = models.flatMap((m) => m.fields.filter((f) => !SCALARS.has(f.type) && !enums.has(f.type) && !byName.has(f.type)).map((f) => `${m.name}.${f.name}:${f.type}`));
    expect(bad).toEqual([]);
  });
});

describe('schema: indexes and deletion rules', () => {
  it('indexes every foreign key column (Postgres does not do this by itself)', () => {
    const exempt = new Set(['CompanySettings.logoFileId']); // single-row table
    const missing = relations.filter((r) => !exempt.has(`${r.model}.${r.fk[0]}`) && !leadingColumns(byName.get(r.model)!).has(r.fk[0])).map((r) => `${r.model}.${r.fk[0]}`);
    expect(missing).toEqual([]);
  });

  it('every optional relation states its delete rule instead of relying on the SET NULL default', () => {
    expect(relations.filter((r) => r.optional && !r.onDelete).map((r) => `${r.model}.${r.field}`)).toEqual([]);
  });

  it('history and master references can never be silently nulled or cascaded away', () => {
    const protectedFields = ['Labour.unit', 'Labour.type', 'Item.defaultSupplier', 'PurchaseRate.supplier', 'TemplateLabour.unit', 'CostingLabour.unit', 'CostingMaterial.supplier', 'Costing.template', 'Quotation.customer', 'QuotationItem.costing', 'QuotationItem.unit', 'CompanySettings.logo', 'AreaConversion.item'];
    const found = relations.filter((r) => protectedFields.includes(`${r.model}.${r.field}`));
    expect(found).toHaveLength(protectedFields.length);
    expect(found.filter((r) => r.onDelete !== 'Restrict').map((r) => `${r.model}.${r.field}`)).toEqual([]);
  });

  it('cascades only from a document to the rows it owns', () => {
    const cascading = relations.filter((r) => r.onDelete === 'Cascade').map((r) => `${r.model}->${r.target}`).sort();
    expect(cascading).toEqual([
      'CostingCategory->CostingGroup', 'CostingExpense->Costing', 'CostingExpense->CostingGroup', 'CostingGroup->Costing', 'CostingImage->Costing', 'CostingLabour->CostingGroup', 'CostingMaterial->CostingCategory',
      'CostingRevision->Costing', 'ItemSupplier->Item', 'ItemUnitConversion->Item', 'PasswordResetToken->User', 'PriceListItem->PriceList', 'RecalculationItem->RecalculationBatch', 'ReviewFlag->PriceList', 'ReviewFlag->Quotation', 'QuotationItem->Quotation', 'QuotationShare->Quotation',
      'RolePermission->Permission', 'RolePermission->Role', 'Session->User', 'TemplateCategory->TemplateGroup', 'TemplateExpense->Template', 'TemplateExpense->TemplateGroup', 'TemplateGroup->Template',
      'TemplateImage->Template', 'UserPriceListDealer->PriceListDealer', 'UserPriceListDealer->User', 'CostingDealerPrice->Costing', 'CostingDealerPrice->PriceListDealer', 'Notification->User', 'PushSubscription->User', 'TemplateItem->TemplateCategory', 'TemplateLabour->TemplateGroup', 'TemplateVersion->Template', 'UserPermission->Permission', 'UserPermission->User', 'UserRole->Role', 'UserRole->User',
    ].sort());
  });

  it('keeps the search indexes (trigram) that make contains-searches fast', () => {
    expect(schema).toMatch(/extensions\s*=\s*\[pg_trgm\]/);
    for (const idx of ['Item_name_trgm_idx', 'Item_code_trgm_idx', 'Costing_productName_trgm_idx', 'Costing_costingNumber_trgm_idx', 'Customer_name_trgm_idx', 'Supplier_name_trgm_idx', 'Quotation_customerName_trgm_idx']) {
      expect(schema).toContain(`map: "${idx}"`);
    }
  });

  it('keeps the list / report indexes', () => {
    for (const [model, needle] of [['Costing', '[deletedAt, costingDate]'], ['Quotation', '[status, validUntil]'], ['Quotation', '[deletedAt, quotationDate]'], ['PurchaseRate', '[supplierId, itemId, purchaseDate]'], ['PurchaseRateHistory', '[itemId, changedAt]'], ['AuditLog', '[entity, entityId]']]) {
      expect(byName.get(model)!.block.join('\n')).toContain(needle);
    }
  });
});

describe('migrations', () => {
  const dirs = readdirSync(path.join(ROOT, 'migrations')).filter((d) => statSync(path.join(ROOT, 'migrations', d)).isDirectory()).sort();
  const sql = (d: string) => readFileSync(path.join(ROOT, 'migrations', d, 'migration.sql'), 'utf8');

  it('are ordered, uniquely named and each has a migration.sql', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(10);
    expect(new Set(dirs).size).toBe(dirs.length);
    dirs.forEach((d) => expect(sql(d).trim().length).toBeGreaterThan(0));
    expect(readFileSync(path.join(ROOT, 'migrations', 'migration_lock.toml'), 'utf8')).toContain('postgresql');
  });

  it('are valid PostgreSQL (checked with the real Postgres parser)', async () => {
    const pg = await import('libpg-query');
    await (pg as { loadModule?: () => Promise<void> }).loadModule?.();
    const parse = (pg as unknown as { parseSync: (s: string) => { stmts: unknown[] } }).parseSync;
    for (const d of dirs) {
      let parsed: { stmts: unknown[] };
      try { parsed = parse(sql(d)); } catch (e) { throw new Error(`${d}: ${(e as Error).message}`); }
      expect(parsed.stmts.length).toBeGreaterThan(0);
    }
  });

  it('only constrain tables and columns that exist in the schema', () => {
    const text = dirs.map(sql).join('\n');
    // walk the migrations in order so a check follows its table through a later RENAME
    const checks: [string, string, string][] = [];
    for (const m of text.matchAll(/ALTER TABLE "(\w+)" (?:ADD CONSTRAINT "chk_\w+" CHECK \((.*)\)|RENAME TO "(\w+)");/g)) {
      if (m[3]) { for (const c of checks) if (c[1] === m[1]) c[1] = m[3]; } else checks.push(['', m[1], m[2]]);
    }
    expect(checks.length).toBeGreaterThanOrEqual(60);
    for (const [, table, expr] of checks) {
      const model = byName.get(table);
      expect(model).toBeDefined();
      for (const [, col] of expr.matchAll(/"(\w+)"/g)) expect([table, col, model!.fields.some((f) => f.name === col)]).toEqual([table, col, true]);
    }
    for (const [, name, table, col, where] of text.matchAll(/CREATE UNIQUE INDEX "(\w+)" ON "(\w+)" \("(\w+)"\) WHERE "(\w+)"/g)) {
      const model = byName.get(table)!;
      expect([name, model.fields.some((f) => f.name === col), model.fields.some((f) => f.name === where)]).toEqual([name, true, true]);
    }
  });

  it('every schema index created by the hardening migration is real: 38 foreign-key indexes + search indexes', () => {
    const text = sql(dirs.find((d) => d.includes('phase13'))!);
    expect((text.match(/CREATE INDEX "\w+_idx"/g) ?? []).length).toBeGreaterThanOrEqual(38);
    expect(text).toContain('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
    expect((text.match(/USING GIN/gi) ?? []).length).toBeGreaterThanOrEqual(8);
  });
});
