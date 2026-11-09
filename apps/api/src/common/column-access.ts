import { columnKey, TABLE_COLUMNS, type TableName } from '@costing/config';
import type { AuthUser } from './decorators';

/** The columns of a table this user may see. Super admins see every column. */
export function allowedColumns(user: Pick<AuthUser, 'isSuperAdmin' | 'permissions'>, table: TableName): Set<string> {
  const all = Object.keys(TABLE_COLUMNS[table].columns);
  return new Set(user.isSuperAdmin ? all : all.filter((c) => user.permissions.has(columnKey(table, c))));
}

/** Copies only the visible fields of each row; anything not in `keep` is dropped, so a hidden figure never leaves the server. */
export function redact<T extends Record<string, unknown>>(rows: T[], keep: Set<string>, always: string[] = ['id']): Partial<T>[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k) || always.includes(k))) as Partial<T>);
}
