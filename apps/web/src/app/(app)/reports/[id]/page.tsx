'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CompanyHeader, useCompany } from '@/components/print-kit';
import { Button, Card, ErrorText, Input } from '@/components/ui/primitives';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { SelectBox } from '@/components/ui/select-box';

type Row = Record<string, any>;
type Col = { key: string; header: string; type: 'text' | 'money' | 'qty' | 'percent' | 'date' | 'int'; total?: boolean };
const PAGE = 50;
const sel = 'h-9 rounded-md border border-slate-300 bg-white px-2 text-sm';

const fmt = (c: Col, v: unknown) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (c.type === 'money') return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (c.type === 'percent') return `${n.toFixed(2)}%`;
  if (c.type === 'qty') return n.toLocaleString('en-IN', { maximumFractionDigits: 4 });
  if (c.type === 'int') return n.toLocaleString('en-IN');
  return String(v);
};

function Remote({ label, path, value, onChange, name }: { label: string; path: string; value: string; onChange: (v: string) => void; name?: (r: Row) => string }) {
  const q = useQuery({ queryKey: ['options', path, 'all=true'], queryFn: () => api<{ items: Row[] }>(`${path}?all=true`) });
  return (
    <SelectBox aria-label={label} className={sel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}: all</option>{q.data?.items.map((r) => <option key={r.id} value={r.id}>{name ? name(r) : r.name}</option>)}
    </SelectBox>
  );
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const can = useAuth((s) => s.can);
  const company = useCompany();
  const defs = useQuery({ queryKey: ['reports'], queryFn: () => api<(Row & { id: string; filters: string[]; statusOptions: string[] })[]>('/reports') });
  const def = defs.data?.find((r) => r.id === id);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [printAll, setPrintAll] = useState(false);

  const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString();
  const report = useQuery({ queryKey: ['report', id, qs], queryFn: () => api<Row>(`/reports/${id}${qs ? `?${qs}` : ''}`), enabled: !!def });
  const r = report.data;
  const cols: Col[] = r?.columns ?? def?.columns ?? [];
  const set = (k: string) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const has = (k: string) => def?.filters.includes(k);

  useEffect(() => { if (printAll) { const t = setTimeout(() => { window.print(); setPrintAll(false); }, 50); return () => clearTimeout(t); } }, [printAll]);
  const rows: Row[] = r?.rows ?? [];
  const shown = printAll ? rows : rows.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));

  return (
    <div className="space-y-4">
      <style>{'@media print { @page { size: A4 landscape; margin: 10mm; } }'}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div><Link href="/reports" className="text-xs underline">← All reports</Link><h1 className="text-2xl font-semibold">{def?.title ?? 'Report'}</h1><p className="text-sm text-slate-600">{def?.description}</p></div>
        <div className="flex gap-2">
          {can('reports:export') && <Button variant="outline" onClick={() => void downloadFile(`/reports/${id}/excel${qs ? `?${qs}` : ''}`, `${id}.xlsx`)}>Export Excel</Button>}
          {can('reports:print') && <Button variant="outline" onClick={() => void downloadFile(`/reports/${id}/pdf${qs ? `?${qs}` : ''}`, `${id}.pdf`)}>Download PDF</Button>}
          {can('reports:print') && <Button variant="outline" onClick={() => setPrintAll(true)}>Print</Button>}
        </div>
      </div>
      <ErrorText error={defs.error} />
      {defs.data && !def && <p className="text-sm text-red-600">This report does not exist or you do not have access to it.</p>}

      {def && (
        <Card className="flex flex-wrap items-end gap-2 print:hidden">
          {has('from') && <label className="text-xs">From<Input type="date" className="w-40" value={draft.from ?? ''} onChange={(e) => set('from')(e.target.value)} /></label>}
          {has('to') && <label className="text-xs">To<Input type="date" className="w-40" value={draft.to ?? ''} onChange={(e) => set('to')(e.target.value)} /></label>}
          {has('product') && <label className="text-xs">Product<Input className="w-44" placeholder="Name or code" value={draft.product ?? ''} onChange={(e) => set('product')(e.target.value)} /></label>}
          {has('typeId') && <Remote label="Type" path="/types" value={draft.typeId ?? ''} onChange={set('typeId')} />}
          {has('groupId') && <Remote label="Group" path="/item-groups" value={draft.groupId ?? ''} onChange={set('groupId')} />}
          {has('supplierId') && <Remote label="Supplier" path="/suppliers" value={draft.supplierId ?? ''} onChange={set('supplierId')} />}
          {has('itemId') && <Remote label="Item" path="/items" value={draft.itemId ?? ''} onChange={set('itemId')} name={(i) => `${i.name} (${i.code})`} />}
          {has('status') && (
            <SelectBox aria-label="Status" className={sel} value={draft.status ?? ''} onChange={(e) => set('status')(e.target.value)}>
              <option value="">Status: all</option>{def.statusOptions.map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</option>)}
            </SelectBox>
          )}
          <Button onClick={() => { setApplied(draft); setPage(1); }}>Apply</Button>
          <Button variant="outline" onClick={() => { setDraft({}); setApplied({}); setPage(1); }}>Clear</Button>
        </Card>
      )}

      <ErrorText error={report.error} />
      {report.isLoading && <p className="text-sm text-slate-500 print:hidden">Running report…</p>}
      {r && (
        <div className="space-y-3">
          <div className="hidden print:block"><CompanyHeader company={company.data} /><h1 className="mt-2 text-lg font-semibold">{r.title}</h1>
            <p className="text-xs text-slate-600">{Object.entries(r.filters).map(([k, v]) => `${k.replace(/Id$/, '')}: ${k.endsWith('Id') ? '(selected)' : v}`).join(' | ') || 'No filters'} · generated {new Date(r.generatedAt).toLocaleString()}</p></div>
          {r.summary.length > 0 && <div className="flex flex-wrap gap-3">{r.summary.map((s: Row) => <Card key={s.label} className="px-3 py-2"><p className="text-xs text-slate-500">{s.label}</p><p className="font-semibold tabular-nums">{s.value}</p></Card>)}</div>}
          {r.truncated && <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800 print:hidden">Showing the first {rows.length} of {r.count} rows. Narrow the filters, or export to Excel for everything.</p>}
          <div className="overflow-x-auto rounded-lg border border-slate-200 print:border-0">
            <table className="w-full text-left text-sm print:text-[10px]">
              <thead className="bg-slate-50 text-slate-600 print:bg-transparent"><tr>{cols.map((c) => <th key={c.key} className={`whitespace-nowrap p-2 ${['money', 'qty', 'percent', 'int'].includes(c.type) ? 'text-right' : ''}`}>{c.header}</th>)}</tr></thead>
              <tbody>
                {shown.map((row, i) => (
                  <tr key={i} className="border-t border-slate-100">{cols.map((c) => <td key={c.key} className={`p-2 ${['money', 'qty', 'percent', 'int'].includes(c.type) ? 'text-right tabular-nums' : ''}`}>{fmt(c, row[c.key])}</td>)}</tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={cols.length} className="p-3 text-slate-500">No records match these filters.</td></tr>}
              </tbody>
              {rows.length > 0 && cols.some((c) => c.total) && (
                <tfoot><tr className="border-t-2 border-slate-800 font-semibold">{cols.map((c, i) => <td key={c.key} className={`p-2 ${c.total ? 'text-right tabular-nums' : ''}`}>{i === 0 ? 'Total' : c.total ? fmt(c, r.totals[c.key]) : ''}</td>)}</tr></tfoot>
              )}
            </table>
          </div>
          <div className="flex items-center gap-2 text-sm print:hidden">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page} of {pages} · {r.count} row(s)</span>
            <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
