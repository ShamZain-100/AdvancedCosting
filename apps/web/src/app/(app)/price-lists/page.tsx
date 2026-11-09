'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, ErrorText, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { SelectBox } from '@/components/ui/select-box';

type Row = Record<string, any>;
const TONE = { DRAFT: 'gray', ACTIVE: 'green', ARCHIVED: 'amber' } as const;

export default function PriceListsPage() {
  const can = useAuth((s) => s.can);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page) });
  if (search) qs.set('search', search);
  if (status) qs.set('status', status);
  const list = useQuery({ queryKey: ['price-lists', qs.toString()], queryFn: () => api<{ items: Row[]; total: number }>(`/price-lists?${qs}`) });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Price Lists</h1>
        {can('price_lists:create') && (
          <div className="flex gap-2">
            <Link href="/price-lists/generate"><Button variant="outline">Generate for many products</Button></Link>
            <Link href="/price-lists/new"><Button>New price list</Button></Link>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name or number…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <SelectBox aria-label="Status" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Status: all</option><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option>
        </SelectBox>
      </div>
      <ErrorText error={list.error} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2.5 py-1.5">Number</th><th className="px-2.5 py-1.5">Name</th><th className="px-2.5 py-1.5">Effective</th><th className="px-2.5 py-1.5 text-right">Products</th><th className="px-2.5 py-1.5">GST</th><th className="px-2.5 py-1.5">Status</th></tr></thead>
          <tbody>
            {list.data?.items.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-2.5 py-1.5"><Link className="underline" href={`/price-lists/${l.id}`}>{l.number}</Link></td><td className="px-2.5 py-1.5">{l.name}</td>
                <td className="px-2.5 py-1.5">{String(l.effectiveDate).slice(0, 10)}</td><td className="px-2.5 py-1.5 text-right">{l.itemCount}</td>
                <td className="px-2.5 py-1.5">{l.gstTreatment === 'EXCLUSIVE' ? 'excl.' : l.gstTreatment === 'INCLUSIVE' ? 'incl.' : 'none'}</td>
                <td className="px-2.5 py-1.5"><Badge tone={TONE[l.status as keyof typeof TONE]}>{String(l.status).toLowerCase()}</Badge></td>
              </tr>
            ))}
            {list.data?.items.length === 0 && <tr><td colSpan={6} className="p-3 text-slate-500">No price lists found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages} · {list.data?.total ?? 0} price lists</span>
        <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
