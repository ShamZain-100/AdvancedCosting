'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, ErrorText, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { SelectBox } from '@/components/ui/select-box';

type Row = Record<string, any>;
const TONE = { PENDING: 'amber', APPLYING: 'blue', PARTIAL: 'purple', APPLIED: 'green', DISMISSED: 'gray' } as const;
const KIND: Record<string, string> = { COMPANY_EXPENSE: 'Company expense', ITEM_RATE: 'Item rate', ITEM_GST: 'Item GST', ITEM_UNITS: 'Item units', LABOUR_RATE: 'Labour rate', EXPENSE_DEFAULT: 'Expense default', RULES: 'Calculation rules' };
const MODES: Record<string, string> = { CONFIRM: 'Ask an admin to confirm (recommended)', AUTO: 'Recalculate automatically', MANUAL: 'Never queue (refresh costings by hand)' };

export default function RecalculationPage() {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const batches = useQuery({ queryKey: ['recalc-batches', status, page], queryFn: () => api<{ items: Row[]; total: number }>(`/recalculation/batches?page=${page}${status ? `&status=${status}` : ''}`) });
  const flags = useQuery({ queryKey: ['recalc-flags'], queryFn: () => api<Row[]>('/recalculation/flags') });
  const policy = useQuery({ queryKey: ['recalc-policy'], queryFn: () => api<{ mode: string; flagThresholdPercent: number }>('/recalculation/policy') });
  const [draft, setDraft] = useState<{ mode: string; flagThresholdPercent: string } | null>(null);
  const savePolicy = useMutation({ mutationFn: (v: object) => api('/recalculation/policy', { method: 'PUT', json: v }), onSuccess: () => { setDraft(null); void qc.invalidateQueries({ queryKey: ['recalc-policy'] }); } });
  const resolve = useMutation({ mutationFn: (id: string) => api(`/recalculation/flags/${id}/resolve`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['recalc-flags'] }) });
  const pages = Math.max(1, Math.ceil((batches.data?.total ?? 0) / 25));
  const p = draft ?? (policy.data ? { mode: policy.data.mode, flagThresholdPercent: String(policy.data.flagThresholdPercent) } : null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Rate Change Impact</h1>
        <p className="text-sm text-slate-600">When a rate, labour rate, expense default, GST or unit conversion changes, the live costings that use it are listed here. Review the before / after figures, then apply. Approved costings are frozen and never change; quotations and price lists built on them are flagged for review instead.</p>
      </div>

      {p && (
        <Card className="flex flex-wrap items-end gap-3">
          <label className="text-sm">When something changes
            <SelectBox disabled={!can('settings:manage_settings')} className="ml-2 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={p.mode} onChange={(e) => setDraft({ ...p, mode: e.target.value })}>
              {Object.entries(MODES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectBox>
          </label>
          <label className="text-sm">Flag documents for changes of at least (%)<Input className="ml-2 inline-block w-20" disabled={!can('settings:manage_settings')} value={p.flagThresholdPercent} onChange={(e) => setDraft({ ...p, flagThresholdPercent: e.target.value })} /></label>
          {draft && <Button disabled={savePolicy.isPending} onClick={() => savePolicy.mutate({ mode: draft.mode, flagThresholdPercent: draft.flagThresholdPercent })}>Save policy</Button>}
          <ErrorText error={savePolicy.error} />
          {!can('settings:manage_settings') && <span className="text-xs text-slate-500">Only administrators can change this.</span>}
        </Card>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Recalculations</h2>
          <SelectBox aria-label="Status" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option><option value="PENDING">Waiting for confirmation</option><option value="PARTIAL">Partly applied</option><option value="APPLIED">Applied</option><option value="DISMISSED">Dismissed</option>
          </SelectBox>
        </div>
        <ErrorText error={batches.error} />
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2.5 py-1.5">When</th><th className="px-2.5 py-1.5">Change</th><th className="px-2.5 py-1.5">Type</th><th className="px-2.5 py-1.5 text-right">Live costings</th><th className="px-2.5 py-1.5 text-right">Documents to review</th><th className="px-2.5 py-1.5">Status</th><th className="px-2.5 py-1.5" /></tr></thead>
            <tbody>
              {batches.data?.items.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="whitespace-nowrap p-3">{new Date(b.createdAt).toLocaleString()}</td><td className="px-2.5 py-1.5">{b.summary}{b.changePercent !== null && <span className="ml-1 text-xs text-slate-500">({Number(b.changePercent) > 0 ? '+' : ''}{Number(b.changePercent)}%)</span>}</td>
                  <td className="px-2.5 py-1.5">{KIND[b.kind]}</td><td className="px-2.5 py-1.5 text-right">{b.costingCount}</td><td className="px-2.5 py-1.5 text-right">{b.flaggedCount}</td>
                  <td className="px-2.5 py-1.5"><Badge tone={TONE[b.status as keyof typeof TONE]}>{String(b.status).toLowerCase()}</Badge></td>
                  <td className="px-2.5 py-1.5 text-right"><Link className="underline" href={`/recalculation/${b.id}`}>{['PENDING', 'PARTIAL'].includes(b.status) ? 'Review' : 'Details'}</Link></td>
                </tr>
              ))}
              {batches.data?.items.length === 0 && <tr><td colSpan={7} className="p-3 text-slate-500">Nothing to recalculate.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Documents to review <span className="text-sm font-normal text-slate-500">({flags.data?.length ?? 0})</span></h2>
        <ErrorText error={flags.error ?? resolve.error} />
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <tbody>
              {flags.data?.map((f) => (
                <tr key={f.id} className="border-t border-slate-100 first:border-0">
                  <td className="px-2.5 py-1.5"><Link className="underline" href={f.document.type === 'QUOTATION' ? `/quotations/${f.document.id}` : `/price-lists/${f.document.id}`}>{f.document.number}</Link> <span className="text-slate-500">{f.document.title} · {String(f.document.status).toLowerCase()}</span></td>
                  <td className="px-2.5 py-1.5">{f.reason}</td>
                  <td className="whitespace-nowrap p-3 text-right"><Button variant="outline" className="h-7" disabled={resolve.isPending} onClick={() => resolve.mutate(f.id)}>Mark reviewed</Button></td>
                </tr>
              ))}
              {flags.data?.length === 0 && <tr><td className="px-2.5 py-1.5 text-slate-500">No quotation or price list needs review.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
