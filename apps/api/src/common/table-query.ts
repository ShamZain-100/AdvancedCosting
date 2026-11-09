import { BadRequestException } from '@nestjs/common';
import { d } from '@costing/costing-engine';

export type ColumnType = 'text' | 'money' | 'number' | 'date' | 'boolean' | 'image';
export interface TableColumn { key: string; label: string; type: ColumnType }
export interface TableQuery { page: number; pageSize: number; sort?: string; dir: 'asc' | 'desc'; search?: string; text: Record<string, string>; min: Record<string, string>; max: Record<string, string>; flag: Record<string, boolean> }

const isNum = (t: ColumnType) => t === 'money' || t === 'number';

/**
 * Query string of a filterable table: page, pageSize, sort, dir, search, and per column `f.<key>` (text contains or yes / no),
 * `min.<key>` / `max.<key>` (numbers and dates). Unknown columns are refused, so a hidden column cannot be probed by filtering on it.
 */
export function parseTableQuery(q: Record<string, string | undefined>, columns: TableColumn[]): TableQuery {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const out: TableQuery = {
    page: Math.max(1, Number(q.page) || 1), pageSize: Math.min(500, Math.max(1, Number(q.pageSize) || 50)),
    dir: q.dir === 'desc' ? 'desc' : 'asc', search: q.search?.trim().slice(0, 80) || undefined, text: {}, min: {}, max: {}, flag: {},
  };
  if (q.sort) { if (!byKey.has(q.sort)) throw new BadRequestException(`sort: unknown column ${q.sort}`); out.sort = q.sort; }
  for (const [raw, value] of Object.entries(q)) {
    const m = /^(f|min|max)\.(.+)$/.exec(raw);
    if (!m || value === undefined || value === '') continue;
    const col = byKey.get(m[2]);
    if (!col) throw new BadRequestException(`${raw}: unknown column`);
    const v = value.trim().slice(0, 80);
    if (m[1] === 'f') {
      if (col.type === 'boolean') out.flag[col.key] = v === 'true' || v === 'yes';
      else out.text[col.key] = v.toLowerCase();
    } else {
      if (isNum(col.type) && !/^-?\d+(\.\d+)?$/.test(v)) throw new BadRequestException(`${raw}: must be a number`);
      if (col.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequestException(`${raw}: must be a date (YYYY-MM-DD)`);
      if (!isNum(col.type) && col.type !== 'date') throw new BadRequestException(`${raw}: ranges apply to numbers and dates only`);
      out[m[1] as 'min' | 'max'][col.key] = v;
    }
  }
  return out;
}

const cell = (row: Record<string, unknown>, key: string) => row[key];
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const cmp = (a: unknown, b: unknown, type: ColumnType): number => {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '' ? 0 : 1;
  if (b === null || b === undefined || b === '') return -1;
  if (isNum(type)) return d(String(a)).comparedTo(d(String(b)));
  if (type === 'boolean') return Number(a) - Number(b);
  return str(a).localeCompare(str(b), 'en', { numeric: true, sensitivity: 'base' });
};

/** Filters, sorts and pages rows in memory (money compared as decimals, never as floats). Returns every match too, for exports. */
export function applyTableQuery<T extends Record<string, unknown>>(rows: T[], columns: TableColumn[], q: TableQuery) {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const textCols = columns.filter((c) => c.type === 'text');
  let out = rows.filter((r) => {
    if (q.search && !textCols.some((c) => str(cell(r, c.key)).toLowerCase().includes(q.search!.toLowerCase()))) return false;
    for (const [k, v] of Object.entries(q.text)) if (!str(cell(r, k)).toLowerCase().includes(v)) return false;
    for (const [k, v] of Object.entries(q.flag)) if (Boolean(cell(r, k)) !== v) return false;
    for (const [bound, vals] of [['min', q.min], ['max', q.max]] as const) {
      for (const [k, v] of Object.entries(vals)) {
        const x = cell(r, k);
        if (x === null || x === undefined || x === '') return false;
        const c = byKey.get(k)!;
        const diff = c.type === 'date' ? str(x).slice(0, 10).localeCompare(v) : d(String(x)).comparedTo(d(v));
        if (bound === 'min' ? diff < 0 : diff > 0) return false;
      }
    }
    return true;
  });
  if (q.sort) {
    const c = byKey.get(q.sort)!;
    out = [...out].sort((a, b) => cmp(cell(a, c.key), cell(b, c.key), c.type) * (q.dir === 'desc' ? -1 : 1));
  }
  const total = out.length;
  return { all: out, items: out.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total, page: q.page, pageSize: q.pageSize };
}
