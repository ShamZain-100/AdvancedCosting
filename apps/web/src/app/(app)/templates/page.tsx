'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { SelectBox } from '@/components/ui/select-box';

type Row = Record<string, any>;
const TONE = { ACTIVE: 'green', INACTIVE: 'gray', ARCHIVED: 'amber' } as const;

export default function TemplatesPage() {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [typeId, setTypeId] = useState('');
  const [page, setPage] = useState(1);
  const [dup, setDup] = useState<Row | null>(null);
  const [error, setError] = useState<unknown>(null);

  const qs = new URLSearchParams({ page: String(page) });
  if (search) qs.set('search', search);
  if (status) qs.set('status', status);
  if (typeId) qs.set('typeId', typeId);
  const list = useQuery({ queryKey: ['templates', qs.toString()], queryFn: () => api<{ items: Row[]; total: number }>(`/templates?${qs}`) });
  const types = useQuery({ queryKey: ['options', '/types', 'all=true'], queryFn: () => api<{ items: Row[] }>('/types?all=true') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['templates'] });
  const setStatusM = useMutation({ mutationFn: (v: { id: string; status: string }) => api(`/templates/${v.id}/status`, { method: 'PATCH', json: { status: v.status } }), onSuccess: refresh, onError: setError });
  const del = useMutation({ mutationFn: (id: string) => api(`/templates/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: setError });
  const copy = useMutation({
    mutationFn: (v: { id: string; name: string; code: string }) => api(`/templates/${v.id}/duplicate`, { method: 'POST', json: { name: v.name, code: v.code } }),
    onSuccess: () => { setDup(null); void refresh(); },
  });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Costing Templates</h1>
        {can('templates:create') && <Link href="/templates/new"><Button>New template</Button></Link>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name or code…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <SelectBox aria-label="Type" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={typeId} onChange={(e) => { setTypeId(e.target.value); setPage(1); }}>
          <option value="">Type: all</option>{types.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectBox>
        <SelectBox aria-label="Status" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Status: all</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ARCHIVED">Archived</option>
        </SelectBox>
      </div>
      <ErrorText error={list.error ?? error} />
      {dup && (
        <Card>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); copy.mutate({ id: dup.id, name: String(f.get('name')), code: String(f.get('code')) }); }}>
            <Field label={`Duplicate "${dup.name}" as`}><Input name="name" defaultValue={`${dup.name} (Copy)`} required /></Field>
            <Field label="New code"><Input name="code" defaultValue={`${dup.code}-COPY`} required /></Field>
            <Button type="submit" disabled={copy.isPending}>Create copy</Button>
            <Button type="button" variant="outline" onClick={() => setDup(null)}>Cancel</Button>
          </form>
          <ErrorText error={copy.error} />
        </Card>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2.5 py-1.5">Name</th><th className="px-2.5 py-1.5">Code</th><th className="px-2.5 py-1.5">Type</th><th className="px-2.5 py-1.5 text-right">Groups</th><th className="px-2.5 py-1.5 text-right">Items</th><th className="px-2.5 py-1.5 text-right">Markup</th><th className="px-2.5 py-1.5">Version</th><th className="px-2.5 py-1.5">Status</th><th className="px-2.5 py-1.5" /></tr></thead>
          <tbody>
            {list.data?.items.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-2.5 py-1.5"><Link className="underline" href={`/templates/${t.id}`}>{t.name}</Link></td><td className="px-2.5 py-1.5">{t.code}</td><td className="px-2.5 py-1.5">{t.type.name}</td>
                <td className="px-2.5 py-1.5 text-right">{t.groupCount}</td><td className="px-2.5 py-1.5 text-right">{t.itemCount}</td><td className="px-2.5 py-1.5 text-right">{Number(t.markupPercent)}%</td>
                <td className="px-2.5 py-1.5">v{t.version}</td><td className="px-2.5 py-1.5"><Badge tone={TONE[t.status as keyof typeof TONE]}>{String(t.status).toLowerCase()}</Badge></td>
                <td className="whitespace-nowrap p-3 text-right">
                  <Link className="mr-3 underline" href={`/templates/${t.id}`}>{t.status === 'ARCHIVED' ? 'View' : 'Edit'}</Link>
                  {can('templates:create') && <button className="mr-3 underline" onClick={() => setDup(t)}>Duplicate</button>}
                  {can('templates:edit') && (t.status === 'ARCHIVED'
                    ? <button className="mr-3 underline" onClick={() => setStatusM.mutate({ id: t.id, status: 'ACTIVE' })}>Restore</button>
                    : <button className="mr-3 underline" onClick={() => setStatusM.mutate({ id: t.id, status: 'ARCHIVED' })}>Archive</button>)}
                  {can('templates:delete') && <button className="text-red-600 underline" onClick={() => { if (confirm(`Delete template "${t.name}"? Existing costings are not affected.`)) del.mutate(t.id); }}>Delete</button>}
                </td>
              </tr>
            ))}
            {list.data?.items.length === 0 && <tr><td className="px-2.5 py-1.5 text-slate-500" colSpan={9}>No templates found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages} · {list.data?.total ?? 0} templates</span>
        <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
