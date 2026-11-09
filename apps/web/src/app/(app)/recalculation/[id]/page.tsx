'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

type Row = Record<string, any>;
const money = (v: unknown) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const OUT: Record<string, { label: string; tone: 'green' | 'gray' | 'red' }> = { CHANGED: { label: 'will change', tone: 'green' }, UNCHANGED: { label: 'no change', tone: 'gray' }, SKIPPED: { label: 'skipped', tone: 'gray' }, FAILED: { label: 'failed', tone: 'red' } };

export default function RecalculationDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const [reason, setReason] = useState('');
  const batch = useQuery({ queryKey: ['recalc-batch', id], queryFn: () => api<Row>(`/recalculation/batches/${id}`) });
  const open = batch.data && ['PENDING', 'PARTIAL'].includes(batch.data.status);
  const preview = useQuery({ queryKey: ['recalc-preview', id], queryFn: () => api<Row>(`/recalculation/batches/${id}/preview`), enabled: !!open && can('costing:view') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['recalc-batch', id] }); void qc.invalidateQueries({ queryKey: ['recalc-preview', id] }); void qc.invalidateQueries({ queryKey: ['recalc-batches'] }); void qc.invalidateQueries({ queryKey: ['costings'] }); };
  const apply = useMutation({ mutationFn: () => api<Row>(`/recalculation/batches/${id}/apply`, { method: 'POST' }), onSuccess: refresh });
  const dismiss = useMutation({ mutationFn: () => api(`/recalculation/batches/${id}/dismiss`, { method: 'POST', json: { reason } }), onSuccess: refresh });
  const b = batch.data;
  const t = preview.data?.totals;

  return (
    <div className="space-y-4">
      <Link href="/recalculation" className="text-xs underline">← Rate Change Impact</Link>
      <ErrorText error={batch.error} />
      {b && (
        <>
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">{b.summary}</h1><Badge tone={b.status === 'APPLIED' ? 'green' : b.status === 'DISMISSED' ? 'red' : 'gray'}>{String(b.status).toLowerCase()}</Badge></div>
          <p className="text-sm text-slate-600">Raised {new Date(b.createdAt).toLocaleString()} · {b.costingCount} live costing(s), {b.flaggedCount} frozen document(s) flagged for review{b.appliedAt ? ` · applied ${new Date(b.appliedAt).toLocaleString()}` : ''}{b.dismissReason ? ` · dismissed: ${b.dismissReason}` : ''}</p>

          {open && (
            <Card className="space-y-3">
              <h2 className="font-semibold">Preview: what applying would do</h2>
              {!can('costing:view') && <p className="text-sm text-slate-500">You need costing view access to see the figures.</p>}
              {preview.isLoading && <p className="text-sm text-slate-500">Calculating…</p>}
              <ErrorText error={preview.error} />
              {t && (
                <p className="text-sm">
                  <b>{t.changed}</b> costing(s) will change (total selling price {Number(t.sellingPriceChange) >= 0 ? '+' : ''}{money(t.sellingPriceChange)}), {t.unchanged} unaffected, {t.skipped} skipped{t.failed ? `, ${t.failed} cannot be calculated` : ''}.
                  {preview.data?.truncated && ` Showing the first ${preview.data.rows.length} of ${preview.data.totalAffected}.`}
                </p>
              )}
              {preview.data && (
                <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-slate-600"><tr><th className="px-2 py-1">Costing</th><th className="px-2 py-1">Product</th><th className="px-2 py-1 text-right">Selling price now</th><th className="px-2 py-1 text-right">After</th><th className="px-2 py-1 text-right">Change</th><th className="px-2 py-1">Result</th></tr></thead>
                    <tbody>{preview.data.rows.map((r: Row) => {
                      const delta = r.before && r.after ? Number(r.after.selling) - Number(r.before.selling) : 0;
                      return (
                        <tr key={r.id} className="border-t border-slate-100 align-top">
                          <td className="px-2 py-1"><Link className="underline" href={`/costings/${r.id}`}>{r.number}</Link></td><td className="px-2 py-1">{r.product}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.before ? money(r.before.selling) : ''}</td><td className="px-2 py-1 text-right tabular-nums">{r.after ? money(r.after.selling) : ''}</td>
                          <td className={`p-2 text-right tabular-nums ${delta > 0 ? 'text-red-700' : delta < 0 ? 'text-green-700' : ''}`}>{r.outcome === 'CHANGED' ? `${delta > 0 ? '+' : ''}${money(delta)}` : ''}</td>
                          <td className="px-2 py-1"><Badge tone={OUT[r.outcome].tone}>{OUT[r.outcome].label}</Badge>{r.reason && <span className="ml-1 text-xs text-slate-500">{r.reason}</span>}</td>
                        </tr>);
                    })}</tbody>
                  </table>
                </div>
              )}
              <ErrorText error={apply.error ?? dismiss.error} />
              {can('purchase_rates:manage_rates') && (
                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <Button disabled={apply.isPending || (t && t.changed === 0)} onClick={() => { if (confirm(`Recalculate ${t?.changed ?? b.costingCount} costing(s)? Each gets a new saved version.`)) apply.mutate(); }}>{apply.isPending ? 'Applying…' : 'Apply recalculation'}</Button>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Or dismiss (reason required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier quote withdrawn" /></Field>
                    <Button variant="outline" disabled={reason.trim().length < 3 || dismiss.isPending} onClick={() => dismiss.mutate()}>Dismiss</Button>
                  </div>
                </div>
              )}
            </Card>
          )}
          {apply.data && <p className="text-sm text-green-700">Applied: {apply.data.applied} recalculated, {apply.data.unchanged} unchanged, {apply.data.skipped} skipped, {apply.data.failed} failed.</p>}

          <Card className="space-y-2">
            <h2 className="font-semibold">Recorded results</h2>
            <p className="text-xs text-slate-500">Applied {b.appliedCount} · skipped {b.skippedCount} · failed {b.failedCount}</p>
            <ul className="divide-y divide-slate-100 text-sm">
              {b.items?.map((i: Row) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span><Link className="underline" href={`/costings/${i.costingId}`}>{i.costing.costingNumber}</Link> {i.costing.productName}</span>
                  <span className="flex items-center gap-2">{i.sellingBefore !== null && <span className="tabular-nums text-slate-600">{money(i.sellingBefore)} → {money(i.sellingAfter)}</span>}<Badge tone={i.status === 'APPLIED' ? 'green' : i.status === 'FAILED' ? 'red' : 'gray'}>{String(i.status).toLowerCase()}</Badge>{i.reason && <span className="text-xs text-slate-500">{i.reason}</span>}</span>
                </li>
              ))}
              {b.items?.length === 0 && <li className="py-1.5 text-slate-500">Nothing has been applied yet.</li>}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
