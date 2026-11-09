'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { SelectBox } from '@/components/ui/select-box';

type Row = Record<string, any>;
const n = (v: unknown, dp = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: dp }));

function Pager({ page, total, size = 25, set }: { page: number; total: number; size?: number; set: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button variant="outline" disabled={page <= 1} onClick={() => set(page - 1)}>Previous</Button>
      <span>Page {page} of {pages} · {total} records</span>
      <Button variant="outline" disabled={page >= pages} onClick={() => set(page + 1)}>Next</Button>
    </div>
  );
}

function SupplierRates({ itemId }: { itemId: string }) {
  const q = useQuery({ queryKey: ['rates', 'suppliers', itemId], queryFn: () => api<Row[]>(`/purchase-rates/items/${itemId}/suppliers`) });
  if (!q.data) return <p className="p-3 text-xs text-slate-500">Loading…</p>;
  if (!q.data.length) return <p className="p-3 text-xs text-slate-500">No supplier rates yet.</p>;
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-slate-500"><th className="px-2 py-1 text-left">Supplier</th><th className="px-2 py-1 text-right">Current</th><th className="px-2 py-1 text-right">Min</th><th className="px-2 py-1 text-right">Max</th><th className="px-2 py-1 text-right">Avg</th><th className="px-2 py-1 text-right">Purchases</th></tr></thead>
      <tbody>{q.data.map((s) => (
        <tr key={s.supplier.id} className="border-t border-slate-100">
          <td className="px-2 py-1">{s.supplier.name} {s.isDefault && <Badge>Default</Badge>}</td>
          <td className="px-2 py-1 text-right">{n(s.currentRate)}</td><td className="px-2 py-1 text-right">{n(s.minRate)}</td>
          <td className="px-2 py-1 text-right">{n(s.maxRate)}</td><td className="px-2 py-1 text-right">{n(s.avgRate, 4)}</td><td className="px-2 py-1 text-right">{s.purchaseCount}</td>
        </tr>))}</tbody>
    </table>
  );
}

export function SummaryTab({ onChangeRate }: { onChangeRate: (itemId: string) => void }) {
  const can = useAuth((s) => s.can);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['rates', 'summary', search, page], queryFn: () => api<{ items: Row[]; total: number }>(`/purchase-rates/summary?page=${page}&search=${encodeURIComponent(search)}`) });
  return (
    <div className="space-y-3">
      <Input className="max-w-xs" placeholder="Search item…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      <ErrorText error={q.error} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2.5 py-1.5">Item</th><th className="px-2.5 py-1.5 text-right">Current rate</th><th className="px-2.5 py-1.5 text-right">Min</th><th className="px-2.5 py-1.5 text-right">Max</th><th className="px-2.5 py-1.5 text-right">Average</th><th className="px-2.5 py-1.5">Method</th><th className="px-2.5 py-1.5 text-right">Purchases</th><th className="px-2.5 py-1.5" /></tr></thead>
          <tbody>{q.data?.items.map((i) => (
            <>
              <tr key={i.id} className="border-t border-slate-100">
                <td className="px-2.5 py-1.5">{i.name} <span className="text-xs text-slate-500">{i.code}</span></td>
                <td className="px-2.5 py-1.5 text-right font-medium">{n(i.defaultPurchaseRate, 4)} <span className="text-xs text-slate-500">/{i.unit.symbol}</span></td>
                {i.hasRateRange ? (<><td className="px-2.5 py-1.5 text-right">{n(i.minRate, 4)}</td><td className="px-2.5 py-1.5 text-right">{n(i.maxRate, 4)}</td><td className="px-2.5 py-1.5 text-right">{n(i.avgRate, 4)}</td><td className="px-2.5 py-1.5">{String(i.rateMethod).replace('_', ' ').toLowerCase()}</td></>)
                  : (<td colSpan={4} className="p-3 text-xs text-slate-500">Standard rate only (Min/Max/Average not enabled for this item)</td>)}
                <td className="px-2.5 py-1.5 text-right">{i.purchaseCount}</td>
                <td className="whitespace-nowrap p-3 text-right">
                  <button className="mr-3 underline" onClick={() => setOpen(open === i.id ? null : i.id)}>Suppliers</button>
                  {can('purchase_rates:manage_rates') && <button className="underline" onClick={() => onChangeRate(i.id)}>Change rate</button>}
                </td>
              </tr>
              {open === i.id && <tr key={`${i.id}-s`} className="bg-slate-50"><td colSpan={8} className="p-2"><SupplierRates itemId={i.id} /></td></tr>}
            </>))}
            {q.data?.items.length === 0 && <tr><td colSpan={8} className="p-3 text-slate-500">No items found.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={q.data?.total ?? 0} set={setPage} />
    </div>
  );
}

export function HistoryTab() {
  const [page, setPage] = useState(1);
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const qs = new URLSearchParams({ page: String(page) });
  if (source) qs.set('source', source);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const q = useQuery({ queryKey: ['rates', 'history', qs.toString()], queryFn: () => api<{ items: Row[]; total: number }>(`/purchase-rates/history?${qs}`) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <SelectBox aria-label="Source" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}>
          <option value="">Source: all</option><option value="PURCHASE">Purchase</option><option value="PURCHASE_DELETED">Purchase removed</option><option value="MANUAL">Manual</option><option value="IMPORT">Import</option>
        </SelectBox>
        <Input type="date" aria-label="From" className="w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        <Input type="date" aria-label="To" className="w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
      </div>
      <ErrorText error={q.error} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2.5 py-1.5">When</th><th className="px-2.5 py-1.5">Item</th><th className="px-2.5 py-1.5 text-right">Old</th><th className="px-2.5 py-1.5 text-right">New</th><th className="px-2.5 py-1.5">Source</th><th className="px-2.5 py-1.5">By</th><th className="px-2.5 py-1.5">Affected</th><th className="px-2.5 py-1.5">Reason</th></tr></thead>
          <tbody>{q.data?.items.map((h) => (
            <tr key={h.id} className="border-t border-slate-100">
              <td className="whitespace-nowrap p-3">{new Date(h.changedAt).toLocaleString()}</td><td className="px-2.5 py-1.5">{h.item.name}</td>
              <td className="px-2.5 py-1.5 text-right">{n(h.oldRate, 4)}</td>
              <td className={`p-3 text-right font-medium ${Number(h.newRate) > Number(h.oldRate) ? 'text-red-700' : 'text-green-700'}`}>{n(h.newRate, 4)}</td>
              <td className="px-2.5 py-1.5">{String(h.source).replace('_', ' ').toLowerCase()}</td><td className="px-2.5 py-1.5">{h.changedByName ?? '—'}</td>
              <td className="px-2.5 py-1.5">{h.impact?.total ?? 0}</td><td className="px-2.5 py-1.5">{h.reason ?? ''}</td>
            </tr>))}
            {q.data?.items.length === 0 && <tr><td colSpan={8} className="p-3 text-slate-500">No rate changes recorded.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={q.data?.total ?? 0} set={setPage} />
    </div>
  );
}

export function ImpactTab({ initialItemId }: { initialItemId?: string }) {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const [itemId, setItemId] = useState(initialItemId ?? '');
  const [newRate, setNewRate] = useState('');
  const [reason, setReason] = useState('');
  const items = useQuery({ queryKey: ['options', '/items', null], queryFn: () => api<{ items: Row[] }>('/items?all=true') });
  const preview = useQuery({
    queryKey: ['rates', 'impact', itemId, newRate], enabled: !!itemId && /^\d+(\.\d+)?$/.test(newRate),
    queryFn: () => api<Row>(`/purchase-rates/items/${itemId}/impact?newRate=${newRate}`),
  });
  const apply = useMutation({
    mutationFn: () => api<Row>(`/purchase-rates/items/${itemId}/rate`, { method: 'PUT', json: { newRate, reason } }),
    onSuccess: () => { setNewRate(''); setReason(''); void qc.invalidateQueries({ queryKey: ['rates'] }); void qc.invalidateQueries({ queryKey: ['master', '/items'] }); },
  });
  const p = preview.data;
  return (
    <Card className="max-w-2xl space-y-3">
      <p className="text-sm text-slate-600">Preview what a rate change touches, then apply it as a manual change. Every change is logged with who, when and why. Costings that follow the new rate are queued on the <a className="underline" href="/recalculation">Rate Change Impact</a> screen, where you review and apply them.</p>
      <Field label="Item">
        <SelectBox className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Select…</option>{items.data?.items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
        </SelectBox>
      </Field>
      <Field label="New rate"><Input inputMode="decimal" value={newRate} onChange={(e) => setNewRate(e.target.value)} /></Field>
      <ErrorText error={preview.error} />
      {p && (
        <div className="rounded-md bg-slate-50 p-3 text-sm">
          <p className="font-medium">{p.message}</p>
          {p.changePercent !== null && <p className="text-slate-600">Change: {p.changePercent}% per {p.unit}</p>}
          {p.affected.length === 0 && <p className="mt-1 text-xs text-slate-500">No dependent modules are active yet (live costings, price lists and quotations register here as they are built).</p>}
          <ul className="mt-1 list-disc pl-5">{p.affected.map((a: Row) => <li key={a.label}>{a.count} {a.label}</li>)}</ul>
        </div>
      )}
      {can('purchase_rates:manage_rates') && p && (
        <>
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier price revision" /></Field>
          <ErrorText error={apply.error} />
          {apply.data && <p className="text-sm text-green-700">Rate updated.{apply.data.warning ? ` ${apply.data.warning}` : ''}</p>}
          <Button disabled={apply.isPending || reason.trim().length < 3} onClick={() => apply.mutate()}>Confirm and apply new rate</Button>
        </>
      )}
    </Card>
  );
}
