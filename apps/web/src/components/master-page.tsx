'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { MasterForm } from '@/components/master-form';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Badge, Button, ErrorText, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { cn } from '@/lib/utils';

type Row = Record<string, any>;
type Option = { value: string; label: string };

export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'decimal' | 'number' | 'select' | 'checkbox' | 'email' | 'date';
  options?: Option[];
  remote?: { path: string; label: (row: Row) => string; filterBy?: string; filterParam?: string; /** key of MASTER_CONFIGS: enables "+ Add new" in this dropdown */ master?: string };
  /** form fields cleared when this one changes (dependent selects) */
  resets?: string[];
  showIf?: (values: Row) => boolean;
  wide?: boolean;
  hint?: string;
}
export interface RowsDef { name: string; label: string; addLabel: string; fields: FieldDef[]; blank: Row; hint?: string }
export interface ColumnDef { header: string; sort?: string; cell: (row: Row) => ReactNode }
export interface FilterDef { param: string; label: string; remote?: { path: string; label: (row: Row) => string }; options?: Option[] }

export interface MasterPageConfig {
  title: string;
  singular: string;
  path: string;
  module: string;
  schema: unknown;
  defaults: Row;
  fields: (FieldDef | RowsDef)[];
  columns: ColumnDef[];
  filters?: FilterDef[];
  toForm?: (row: Row) => Row;
  searchHint?: string;
  /** false for append-only records (no edit / activate) */
  editable?: boolean;
  hasStatus?: boolean;
  rowLabel?: (row: Row) => string;
  /** extra buttons in the page header (import/export…) */
  headerActions?: ReactNode;
  /** query params always sent (e.g. default sort) */
  extraParams?: Record<string, string>;
}

function FilterSelect({ f, value, onChange }: { f: FilterDef; value: string; onChange: (v: string) => void }) {
  const q = useQuery({ queryKey: ['options', f.remote?.path, null], queryFn: () => api<{ items: Row[] }>(`${f.remote!.path}?all=true`), enabled: !!f.remote });
  const options: ComboOption[] = [{ value: '', label: `${f.label}: all` }, ...(f.options ?? []), ...(q.data?.items.map((o) => ({ value: o.id as string, label: f.remote!.label(o) })) ?? [])];
  return <Combobox className="w-44" aria-label={f.label} value={value} options={options} onChange={onChange} />;
}

export function MasterPage({ cfg }: { cfg: MasterPageConfig }) {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ by?: string; dir: 'asc' | 'desc' }>({ dir: 'asc' });
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<{ row: Row | null } | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  useEffect(() => { setPage(1); }, [search, status, filters]);

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (sort.by) { params.set('sortBy', sort.by); params.set('sortDir', sort.dir); }
  Object.entries({ ...cfg.extraParams, ...filters }).forEach(([k, v]) => v && params.set(k, v));

  const list = useQuery({ queryKey: ['master', cfg.path, params.toString()], queryFn: () => api<{ items: Row[]; total: number }>(`${cfg.path}?${params}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['master', cfg.path] }); void qc.invalidateQueries({ queryKey: ['options'] }); void qc.invalidateQueries({ queryKey: ['rates'] }); };
  const toggle = useMutation({ mutationFn: (r: Row) => api(`${cfg.path}/${r.id}/status`, { method: 'PATCH', json: { isActive: !r.isActive } }), onSuccess: refresh, onError: setActionError });
  const del = useMutation({ mutationFn: (r: Row) => api(`${cfg.path}/${r.id}`, { method: 'DELETE' }), onSuccess: refresh, onError: setActionError });

  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));
  const canEdit = cfg.editable !== false && can(`${cfg.module}:edit`);
  const hasStatus = cfg.hasStatus !== false;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{cfg.title}</h1>
        <div className="flex flex-wrap gap-2">
          {cfg.headerActions}
          {can(`${cfg.module}:create`) && <Button onClick={() => setDrawer({ row: null })}><Plus size={16} className="mr-1" />New {cfg.singular}</Button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder={cfg.searchHint ?? 'Search…'} value={search} onChange={(e) => setSearch(e.target.value)} />
        {cfg.filters?.map((f) => <FilterSelect key={f.param} f={f} value={filters[f.param] ?? ''} onChange={(v) => setFilters((c) => ({ ...c, [f.param]: v }))} />)}
        {hasStatus && (
          <Combobox className="w-36" aria-label="Status" value={status} onChange={setStatus}
            options={[{ value: '', label: 'Status: all' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        )}
      </div>
      <ErrorText error={list.error ?? actionError} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {cfg.columns.map((c) => (
                <th key={c.header} className="whitespace-nowrap px-2.5 py-1.5">
                  {c.sort ? (
                    <button className="inline-flex items-center gap-1 font-medium" onClick={() => setSort((s) => ({ by: c.sort, dir: s.by === c.sort && s.dir === 'asc' ? 'desc' : 'asc' }))}>
                      {c.header}{sort.by === c.sort && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  ) : c.header}
                </th>
              ))}
              {hasStatus && <th className="px-2.5 py-1.5">Status</th>}<th className="px-2.5 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                {cfg.columns.map((c) => <td key={c.header} className="px-2.5 py-1.5">{c.cell(row)}</td>)}
                {hasStatus && <td className="px-2.5 py-1.5"><Badge tone={row.isActive ? 'green' : 'red'}>{row.isActive ? 'Active' : 'Inactive'}</Badge></td>}
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                  {canEdit && <button className="mr-3 underline" onClick={() => setDrawer({ row })}>Edit</button>}
                  {canEdit && hasStatus && <button className="mr-3 underline" onClick={() => { setActionError(null); toggle.mutate(row); }}>{row.isActive ? 'Deactivate' : 'Activate'}</button>}
                  {can(`${cfg.module}:delete`) && <button className="text-red-600 underline" onClick={() => { if (confirm(`Delete ${cfg.rowLabel?.(row) ?? row.name}?`)) { setActionError(null); del.mutate(row); } }}>Delete</button>}
                </td>
              </tr>
            ))}
            {list.data?.items.length === 0 && <tr><td className="px-2.5 py-1.5 text-slate-500" colSpan={cfg.columns.length + (hasStatus ? 2 : 1)}>No records found.</td></tr>}
            {list.isLoading && <tr><td className="px-2.5 py-1.5 text-slate-500" colSpan={cfg.columns.length + (hasStatus ? 2 : 1)}>Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages} · {list.data?.total ?? 0} records</span>
        <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
      {drawer && <MasterForm cfg={cfg} editing={drawer.row} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); refresh(); }} />}
    </div>
  );
}
