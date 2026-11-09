import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ALL_COLUMN_KEYS, COLUMN_MODULE, PERMISSION_ACTIONS, PERMISSION_MODULES, TABLE_COLUMNS, columnKey, type TableName } from '@costing/config';

/** Example roles from the spec. Admins can customise everything afterwards. */
export const ALL = '*';
export const ROLES: Record<string, { description: string; grants: Record<string, string[] | typeof ALL> }> = {
  Admin: { description: 'Full access to every module', grants: Object.fromEntries(PERMISSION_MODULES.map((m) => [m, ALL])) },
  Accountant: {
    description: 'Costing, rates and quotations',
    grants: {
      dashboard: ['view'], types: ['view'], item_groups: ['view'], item_categories: ['view'], units: ['view'],
      customer_groups: ['view'], price_list_dealers: ['view'], dealer_price_list: ['view', 'export', 'print'], conversions: ['view'], items: ['view', 'edit'], suppliers: ALL as unknown as string[], labour: ['view', 'edit'], expenses: ['view', 'edit'],
      purchase_rates: ['view', 'create', 'edit', 'manage_rates', 'import', 'export'], templates: ['view'],
      costing: ALL as unknown as string[], price_lists: ['view'], customers: ['view', 'create', 'edit'],
      quotations: ['view', 'create', 'edit', 'print', 'export'], reports: ['view', 'export', 'print'],
    },
  },
  Staff: {
    description: 'Create costings, view masters',
    grants: {
      dashboard: ['view'], types: ['view'], item_groups: ['view'], item_categories: ['view'], items: ['view'], units: ['view'],
      suppliers: ['view'], labour: ['view'], expenses: ['view'], templates: ['view'], costing: ['view', 'create', 'edit', 'print'], customer_groups: ['view'], conversions: ['view'],
      customers: ['view'], quotations: ['view'],
    },
  },
  Designer: {
    description: 'Uploads product photos; sees no costs',
    grants: { dashboard: ['view'], images: ['view', 'create', 'edit', 'delete'] },
  },
  'Price List Dealer': {
    description: 'Sees only the price list of the dealer(s) the user belongs to',
    grants: { dealer_price_list: ['view', 'export', 'print'] },
  },
};

/** Starter column access per role and table. `ALL` = every column of that table. */
export const COLUMN_GRANTS: Record<string, Partial<Record<TableName, readonly string[] | typeof ALL>>> = {
  Admin: { costings: ALL, cost_report: ALL, price_list: ALL },
  Accountant: { costings: ALL, cost_report: ALL, price_list: ALL },
  Staff: {
    costings: ['costingNumber', 'productName', 'type', 'costingDate', 'status', 'basicCost', 'totalCostInclGst', 'sellingPrice', 'preparedBy'],
    cost_report: ['costingNumber', 'productName', 'productCode', 'approvedAt', 'quantity', 'basicCost', 'sellingPrice'],
  },
  'Price List Dealer': { price_list: ['image', 'productName', 'productCode', 'unit', 'dealerPrices'] },
};
export const columnGrantsFor = (role: string, table: TableName) => {
  const g = COLUMN_GRANTS[role]?.[table];
  if (!g) return [];
  return (g === ALL ? Object.keys(TABLE_COLUMNS[table].columns) : g).map((c) => columnKey(table, c));
};

// Starter units. baseFactor converts to the base unit of the type (KG, Meter, Sq Ft, Litre).
const UNITS = [
  { name: 'Kilogram', symbol: 'KG', unitType: 'WEIGHT', baseFactor: '1', decimalPrecision: 3 },
  { name: 'Gram', symbol: 'G', unitType: 'WEIGHT', baseFactor: '0.001', decimalPrecision: 3 },
  { name: 'Meter', symbol: 'M', unitType: 'LENGTH', baseFactor: '1', decimalPrecision: 3 },
  { name: 'Feet', symbol: 'FT', unitType: 'LENGTH', baseFactor: '0.3048', decimalPrecision: 3 },
  { name: 'Inch', symbol: 'IN', unitType: 'LENGTH', baseFactor: '0.0254', decimalPrecision: 3 },
  { name: 'Square Feet', symbol: 'SQFT', unitType: 'AREA', baseFactor: '1', decimalPrecision: 3 },
  { name: 'Litre', symbol: 'L', unitType: 'VOLUME', baseFactor: '1', decimalPrecision: 3 },
  { name: 'Millilitre', symbol: 'ML', unitType: 'VOLUME', baseFactor: '0.001', decimalPrecision: 3 },
  { name: 'Piece', symbol: 'PC', unitType: 'COUNT', decimalPrecision: 0 },
  { name: 'Box', symbol: 'BOX', unitType: 'COUNT', decimalPrecision: 0 },
  { name: 'Set', symbol: 'SET', unitType: 'COUNT', decimalPrecision: 0 },
] as const;

/**
 * Modules added after the first release. Roles keep any customisation, so a re-seed only adds the grants of these
 * modules that a starter role is missing (it never removes anything and never touches other modules).
 */
export const MODULES_ADDED_LATER = ['customer_groups', 'price_list_dealers', 'dealer_price_list', 'images'] as const;

/** Single grants a starter role was missing and could not work without. Existing databases get them on the next seed; nothing else on the role changes. */
export const GRANTS_ADDED_LATER: Record<string, string[]> = { Staff: ['costing:edit', 'conversions:view'], Accountant: ['purchase_rates:create', 'conversions:view'] };

export const grantsFor = (role: string, modules: readonly string[]) =>
  Object.entries(ROLES[role].grants).filter(([m]) => modules.includes(m)).flatMap(([m, a]) => (a === ALL ? [...PERMISSION_ACTIONS] : a).map((x) => `${m}:${x}`));

export async function seed(prisma = new PrismaClient()) {
  for (const u of UNITS) {
    await prisma.unit.upsert({ where: { symbol: u.symbol }, update: {}, create: { ...u } });
  }

  const keys = PERMISSION_MODULES.flatMap((module) => PERMISSION_ACTIONS.map((action) => ({ key: `${module}:${action}`, module, action })));
  for (const p of keys) await prisma.permission.upsert({ where: { key: p.key }, update: {}, create: p });
  for (const key of ALL_COLUMN_KEYS) await prisma.permission.upsert({ where: { key }, update: {}, create: { key, module: COLUMN_MODULE, action: key.slice(COLUMN_MODULE.length + 1) } });
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));

  for (const [name, def] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name, description: def.description, isSystem: true } });
    // Only set grants on first creation so later admin customisation is never overwritten by a re-seed.
    if ((await prisma.rolePermission.count({ where: { roleId: role.id } })) === 0) {
      const granted = Object.entries(def.grants).flatMap(([module, a]) => (a === ALL ? [...PERMISSION_ACTIONS] : a).map((x) => `${module}:${x}`));
      await prisma.rolePermission.createMany({ data: granted.filter((k) => perms.has(k)).map((k) => ({ roleId: role.id, permissionId: perms.get(k)! })) });
    }
  }

  for (const name of Object.keys(ROLES)) {
    const role = await prisma.role.findUnique({ where: { name } });
    const missing = [...grantsFor(name, MODULES_ADDED_LATER), ...(GRANTS_ADDED_LATER[name] ?? [])].filter((k) => perms.has(k));
    if (role && missing.length) {
      await prisma.rolePermission.createMany({ data: missing.map((k) => ({ roleId: role.id, permissionId: perms.get(k)! })), skipDuplicates: true });
    }
  }

  // Column access: a role gets its starter columns of a table only while it has none of that table's columns, so a later
  // re-seed never undoes an admin's choice.
  for (const name of Object.keys(COLUMN_GRANTS)) {
    const role = await prisma.role.findUnique({ where: { name } });
    if (!role) continue;
    const held = new Set((await prisma.rolePermission.findMany({ where: { roleId: role.id, permission: { module: COLUMN_MODULE } }, select: { permission: { select: { key: true } } } })).map((r) => r.permission.key));
    for (const table of Object.keys(TABLE_COLUMNS) as TableName[]) {
      if ([...held].some((k) => k.startsWith(`${COLUMN_MODULE}:${table}.`))) continue;
      const keys = columnGrantsFor(name, table).filter((k) => perms.has(k));
      if (keys.length) await prisma.rolePermission.createMany({ data: keys.map((k) => ({ roleId: role.id, permissionId: perms.get(k)! })), skipDuplicates: true });
    }
  }

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set: permissions and roles seeded, no admin user created.');
    return;
  }
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Admin' } });
  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() }, update: {},
    create: { email: email.toLowerCase(), name: 'Administrator', passwordHash: await bcrypt.hash(password, 12), isSuperAdmin: true, mustChangePassword: true },
  });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: adminRole.id } }, update: {}, create: { userId: user.id, roleId: adminRole.id } });
  console.log(`Super admin ready: ${user.email}`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma).catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
