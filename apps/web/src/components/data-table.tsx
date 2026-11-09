'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, ErrorText, Input } from '@/components/ui/primitives';
import { SelectBox } from '@/components/ui/select-box';
import { api, downloadFile } from '@/lib/api';
import { cn } from '@/lib/utils';

export type ColumnType = 'text' | 'money' | 'number' | 'date' | 'boolean' | 'image';
export interface TableColumn { key: string; label: string; type: ColumnType }
export type Row = Record<string, any>;
export interface TableResult { columns: TableColumn[]; items: Row[]; total: number; page: number; pageSize: number }

const num = (t: ColumnType) => t === 'money' || t === 'number';
/** Display only: the figures arrive from the server already calculated and rounded. */
const fmt = (v: unknown, t: ColumnType) => {
  if (v === null || v === undefined || v === '') return '—';
  if (t === 'money') return Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (t === 'number') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 4 });
  if (t === 'date') return String(v).slice(0, 10);
  if (t === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/**
 * A table whose sorting, per-column filters, search and paging all run on the server (so hidden columns can never be
 * filtered on, and money is compared exactly). Columns come from the server too: what a user may not see is not sent.
 */
export function DataTable({ path, title, cell, excel, toolbar, extra }: {
  path: string;
  title?: string;
  /** custom rendering for some columns (e.g. a publish switch); return undefined to use the default */
  cell?: (col: TableColumn, row: Row) => ReactNode | undefined;
  excel?: { path: string; filename: string } | null;
  toolbar?: ReactNode;
  /** extra response fields the page wants (e.g. dealers) */
  extra?: (data: TableResult & Row) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const debounced = useDebounced({ search, filters });

  const qs = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (sort) { p.set('sort', sort.key); p.set('dir', sort.dir); }
    if (debounced.search) p.set('search', debounced.search);
    for (const [k, v] of Object.entries(debounced.filters)) if (v !== '') p.set(k, v);
    return p.toString();
  }, [page, pageSize, sort, debounced]);
  useEffect(() => { setPage(1); }, [debounced, pageSize]);

  const q = useQuery({ queryKey: ['table', path, qs], queryFn: () => api<TableResult & Row>(`${path}?${qs}`), placeholderData: keepPreviousData });
  useEffect(() => { if (q.data) extra?.(q.data); }, [q.data, extra]);
  const cols = q.data?.columns ?? [];
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const setF = (k: string, v: string) => setFilters((cur) => ({ ...cur, [k]: v }));
  const active = Object.values(filters).some((v) => v !== '') || search !== '';
  const exportQs = qs.replace(/(^|&)(page|pageSize)=[^&]*/g, '').replace(/^&/, '');

  const toggleSort = (key: string) => setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {title && <h2 className="mr-auto font-semibold">{title}</h2>}
        <Input className="h-8 w-56" placeholder="Search…" aria-label="Search the table" value={search} onChange={(e) => setSearch(e.target.value)} />
        {active && <Button variant="outline" className="h-8" onClick={() => { setSearch(''); setFilters({}); }}><X size={14} />Clear filters</Button>}
        {toolbar}
        {excel && <Button variant="outline" className="h-8" onClick={() => void downloadFile(`${excel.path}${exportQs ? `?${exportQs}` : ''}`, excel.filename)}><Download size={14} />Excel</Button>}
      </div>
      <ErrorText error={q.error} />
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-slate-600">
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={cn('whitespace-nowrap px-2 py-1.5 font-medium', num(c.type) ? 'text-right' : 'text-left')}>
                  {c.type === 'image' ? c.label : (
                    <button type="button" className="inline-flex items-center gap-0.5 hover:text-slate-900" onClick={() => toggleSort(c.key)} aria-label={`Sort by ${c.label}`}>
                      {c.label}{sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  )}
                </th>
              ))}
            </tr>
            <tr className="border-t border-slate-200 bg-white">
              {cols.map((c) => (
                <th key={c.key} className="px-1 py-1 font-normal">
                  {c.type === 'text' && <Input className="h-7 min-w-24 text-xs" placeholder="Filter" aria-label={`Filter ${c.label}`} value={filters[`f.${c.key}`] ?? ''} onChange={(e) => setF(`f.${c.key}`, e.target.value)} />}
                  {(num(c.type) || c.type === 'date') && (
                    <div className="flex min-w-36 gap-1">
                      <Input className="h-7 text-xs" type={c.type === 'date' ? 'date' : 'text'} inputMode="decimal" placeholder="Min" aria-label={`${c.label} from`} value={filters[`min.${c.key}`] ?? ''} onChange={(e) => setF(`min.${c.key}`, e.target.value)} />
                      <Input className="h-7 text-xs" type={c.type === 'date' ? 'date' : 'text'} inputMode="decimal" placeholder="Max" aria-label={`${c.label} to`} value={filters[`max.${c.key}`] ?? ''} onChange={(e) => setF(`max.${c.key}`, e.target.value)} />
                    </div>
                  )}
                  {c.type === 'boolean' && (
                    <SelectBox aria-label={`Filter ${c.label}`} className="min-w-20" value={filters[`f.${c.key}`] ?? ''} onChange={(e) => setF(`f.${c.key}`, e.target.value)}>
                      <option value="">All</option><option value="true">Yes</option><option value="false">No</option>
                    </SelectBox>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                {cols.map((c) => {
                  const custom = cell?.(c, r);
                  return <td key={c.key} className={cn('px-2 py-1.5', num(c.type) && 'text-right tabular-nums')}>{custom !== undefined ? custom : fmt(r[c.key], c.type)}</td>;
                })}
              </tr>
            ))}
            {q.data && q.data.items.length === 0 && <tr><td className="px-2 py-3 text-slate-500" colSpan={Math.max(1, cols.length)}>Nothing to show{active ? ' for these filters' : ''}.</td></tr>}
            {q.isLoading && <tr><td className="px-2 py-3 text-slate-500" colSpan={Math.max(1, cols.length)}>Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span>{q.data ? `${q.data.total} row${q.data.total === 1 ? '' : 's'}` : ''}</span>
        <div className="ml-auto flex items-center gap-2">
          <SelectBox aria-label="Rows per page" className="min-w-20" value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))}>
            <option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="250">250</option>
          </SelectBox>
          <Button variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button variant="outline" className="h-8" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
