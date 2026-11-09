'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, ErrorText, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { SelectBox } from '@/components/ui/select-box';

type Row = Record<string, any>;
const TONE = { DRAFT: 'gray', PENDING: 'amber', SENT: 'blue', APPROVED: 'green', REJECTED: 'red', EXPIRED: 'amber', CONVERTED: 'purple' } as const;
const money = (v: unknown) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function QuotationsPage() {
  const can = useAuth((s) => s.can);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page) });
  if (search) qs.set('search', search);
  if (status) qs.set('status', status);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const list = useQuery({ queryKey: ['quotations', qs.toString()], queryFn: () => api<{ items: Row[]; total: number }>(`/quotations?${qs}`) });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));
  const reset = (fn: () => void) => { fn(); setPage(1); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Quotations</h1>
        {can('quotations:create') && <Link href="/quotations/new"><Button>New quotation</Button></Link>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search number, customer, subject…" value={search} onChange={(e) => reset(() => setSearch(e.target.value))} />
        <SelectBox aria-label="Status" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={status} onChange={(e) => reset(() => setStatus(e.target.value))}>
          <option value="">Status: all</option>{['DRAFT', 'PENDING', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONVERTED'].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
        </SelectBox>
        <Input type="date" aria-label="From" className="w-40" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
        <Input type="date" aria-label="To" className="w-40" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
      </div>
      <ErrorText error={list.error} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2.5 py-1.5">Number</th><th className="px-2.5 py-1.5">Customer</th><th className="px-2.5 py-1.5">Date</th><th className="px-2.5 py-1.5">Valid until</th><th className="px-2.5 py-1.5 text-right">Products</th><th className="px-2.5 py-1.5 text-right">Total</th><th className="px-2.5 py-1.5">Prepared by</th><th className="px-2.5 py-1.5">Status</th></tr></thead>
          <tbody>
            {list.data?.items.map((q) => (
              <tr key={q.id} className="border-t border-slate-100">
                <td className="px-2.5 py-1.5"><Link className="underline" href={`/quotations/${q.id}`}>{q.number}</Link></td>
                <td className="px-2.5 py-1.5">{q.customerName}{q.subject ? <span className="block text-xs text-slate-500">{q.subject}</span> : null}</td>
                <td className="whitespace-nowrap p-3">{String(q.quotationDate).slice(0, 10)}</td><td className="whitespace-nowrap p-3">{String(q.validUntil).slice(0, 10)}</td>
                <td className="px-2.5 py-1.5 text-right">{q.itemCount}</td><td className="px-2.5 py-1.5 text-right font-medium tabular-nums">{money(q.grandTotal)}</td><td className="px-2.5 py-1.5">{q.preparedBy.name}</td>
                <td className="px-2.5 py-1.5"><Badge tone={TONE[q.status as keyof typeof TONE]}>{String(q.status).toLowerCase()}</Badge>{q.needsReview && <span className="ml-1"><Badge tone="red">review</Badge></span>}</td>
              </tr>
            ))}
            {list.data?.items.length === 0 && <tr><td className="px-2.5 py-1.5 text-slate-500" colSpan={8}>No quotations found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages} · {list.data?.total ?? 0} quotations</span>
        <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
