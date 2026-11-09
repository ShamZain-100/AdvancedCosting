export const APP_NAME = 'Smart Costing Management System';

export const PERMISSION_ACTIONS = [
  'view', 'create', 'edit', 'delete', 'approve', 'export', 'import', 'print', 'manage_rates', 'manage_settings',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSION_MODULES = [
  'dashboard', 'types', 'item_groups', 'item_categories', 'items', 'units', 'suppliers', 'labour', 'expenses',
  'conversions', 'purchase_rates', 'templates', 'costing', 'price_lists', 'customers', 'customer_groups', 'price_list_dealers', 'dealer_price_list', 'images', 'quotations', 'reports',
  'data_management', 'users', 'roles', 'settings', 'audit_logs',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const permissionKey = (module: PermissionModule, action: PermissionAction) => `${module}:${action}`;

/**
 * Columns an admin can show or hide per role and per user. Each one is the permission `column:<table>.<column>`;
 * a column is shown only when the user holds it (super admins see every column).
 */
export const TABLE_COLUMNS = {
  costings: { label: 'Costing list', columns: {
    costingNumber: 'Costing no', productName: 'Product', type: 'Type', costingDate: 'Date', status: 'Status',
    basicCost: 'Basic cost', totalCostInclGst: 'Total cost incl. GST', sellingPrice: 'Selling price', profitPercent: 'Profit %', preparedBy: 'Prepared by',
  } },
  cost_report: { label: 'Cost report', columns: {
    costingNumber: 'Costing no', productName: 'Product', productCode: 'Code', approvedAt: 'Approved', quantity: 'Qty',
    basicCost: 'Basic cost', companyExpenseCost: 'Company expense', extraAmount: 'Extra', markupAmount: 'Markup', sellingPrice: 'Selling price', published: 'Publish to price list',
  } },
  price_list: { label: 'Price list (dealers)', columns: {
    image: 'Image', productName: 'Product', productCode: 'Code', unit: 'Unit', dealerPrices: 'Dealer prices',
  } },
} as const;
export type TableName = keyof typeof TABLE_COLUMNS;
export const COLUMN_MODULE = 'column';
export const columnKey = (table: TableName, column: string) => `${COLUMN_MODULE}:${table}.${column}`;
export const ALL_COLUMN_KEYS: string[] = Object.entries(TABLE_COLUMNS).flatMap(([t, def]) => Object.keys(def.columns).map((c) => columnKey(t as TableName, c)));

