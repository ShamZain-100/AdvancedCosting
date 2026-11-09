'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Badge, Button, ErrorText, Input } from '@/components/ui/primitives';
import { api, fileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { columnKey } from '@costing/config';
import { SelectBox } from '@/components/ui/select-box';

type Row = Record<string, any>;
const TONE = { DRAFT: 'gray', PENDING_APPROVAL: 'amber', APPROVED: 'green', REJECTED: 'red' } as const;
const money = (v: unknown) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CostingsPage() {
  return <Suspense fallback={null}><Costings /></Suspense>;
}

function Costings() {
  const can = useAuth((s) => s.can);
  // the server leaves out columns this user may not see; the table just follows
  const show = (col: string) => can(columnKey('costings', col));
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(useSearchParams().get('status') ?? '');
  const [typeId, setTypeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page) });
  if (search) qs.set('search', search);
  if (status) qs.set('status', status);
  if (typeId) qs.set('typeId', typeId);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const list = useQuery({ queryKey: ['costings', qs.toString()], queryFn: () => api<{ items: Row[]; total: number }>(`/costings?${qs}`) });
  const types = useQuery({ queryKey: ['options', '/types', 'all=true'], queryFn: () => api<{ items: Row[] }>('/types?all=true') });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));
  const reset = (fn: () => void) => { fn(); setPage(1); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Costings</h1>
        {can('costing:create') && <Link href="/costings/new"><Button>New costing</Button></Link>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search product, code or number…" value={search} onChange={(e) => reset(() => setSearch(e.target.value))} />
        <SelectBox aria-label="Type" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={typeId} onChange={(e) => reset(() => setTypeId(e.target.value))}>
          <option value="">Type: all</option>{types.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectBox>
        <SelectBox aria-label="Status" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={status} onChange={(e) => reset(() => setStatus(e.target.value))}>
          <option value="">Status: all</option><option value="DRAFT">Draft</option><option value="PENDING_APPROVAL">Pending approval</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option>
        </SelectBox>
        <Input type="date" aria-label="From" className="w-40" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
        <Input type="date" aria-label="To" className="w-40" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
      </div>
      <ErrorText error={list.error} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2.5 py-1.5 w-14" />{show('costingNumber') && <th className="px-2.5 py-1.5">Number</th>}{show('productName') && <th className="px-2.5 py-1.5">Product</th>}{show('type') && <th className="px-2.5 py-1.5">Type</th>}{show('costingDate') && <th className="px-2.5 py-1.5">Date</th>}{show('basicCost') && <th className="px-2.5 py-1.5 text-right">Basic cost</th>}{show('sellingPrice') && <th className="px-2.5 py-1.5 text-right">Selling price</th>}{show('profitPercent') && <th className="px-2.5 py-1.5 text-right">Profit %</th>}{show('preparedBy') && <th className="px-2.5 py-1.5">Prepared by</th>}{show('status') && <th className="px-2.5 py-1.5">Status</th>}</tr></thead>
          <tbody>
            {list.data?.items.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-2 py-1">{c.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={fileUrl(c.image.thumbUrl)} alt="" loading="lazy" className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-slate-100" />}</td>
                {show('costingNumber') && <td className="px-2.5 py-1.5"><Link className="underline" href={`/costings/${c.id}`}>{c.costingNumber}</Link></td>}
                {show('productName') && <td className="px-2.5 py-1.5"><Link href={`/costings/${c.id}`}>{c.productName}</Link>{c.productCode ? <span className="text-xs text-slate-500"> {c.productCode}</span> : null}</td>}
                {show('type') && <td className="px-2.5 py-1.5">{c.type?.name}</td>}{show('costingDate') && <td className="whitespace-nowrap p-3">{String(c.costingDate).slice(0, 10)}</td>}
                {show('basicCost') && <td className="px-2.5 py-1.5 text-right tabular-nums">{money(c.basicCost)}</td>}{show('sellingPrice') && <td className="px-2.5 py-1.5 text-right font-medium tabular-nums">{money(c.sellingPrice)}</td>}
                {show('profitPercent') && <td className="px-2.5 py-1.5 text-right">{Number(c.profitPercent)}%</td>}{show('preparedBy') && <td className="px-2.5 py-1.5">{c.preparedBy?.name}</td>}
                {show('status') && <td className="px-2.5 py-1.5"><Badge tone={TONE[c.status as keyof typeof TONE]}>{String(c.status).replace('_', ' ').toLowerCase()}</Badge> <span className="text-xs text-slate-500">v{c.version}</span></td>}
              </tr>
            ))}
            {list.data?.items.length === 0 && <tr><td className="px-2.5 py-1.5 text-slate-500" colSpan={10}>No costings found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages} · {list.data?.total ?? 0} costings</span>
        <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
