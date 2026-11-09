'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

interface UserRow { id: string; name: string; email: string; isActive: boolean; roles: { id: string; name: string }[] }
interface Role { id: string; name: string }

export default function UsersPage() {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const users = useQuery({ queryKey: ['users', search, page], queryFn: () => api<{ items: UserRow[]; total: number; pageSize: number }>(`/users?page=${page}&search=${encodeURIComponent(search)}`) });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles'), enabled: showForm });
  const dealers = useQuery({ queryKey: ['options', '/price-list-dealers', null], queryFn: () => api<{ items: { id: string; name: string }[] }>('/price-list-dealers?all=true'), enabled: showForm && can('price_list_dealers:view') });
  const create = useMutation({
    mutationFn: (v: unknown) => api('/users', { method: 'POST', json: v }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['users'] }); setShowForm(false); },
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({ name: f.get('name'), email: f.get('email'), password: f.get('password'), roleIds: f.getAll('roleIds'), dealerIds: f.getAll('dealerIds') });
  }

  const pages = Math.max(1, Math.ceil((users.data?.total ?? 0) / (users.data?.pageSize ?? 25)));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Users</h1>
        {can('users:create') && <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : 'New user'}</Button>}
      </div>
      {showForm && (
        <Card>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input name="name" required /></Field>
            <Field label="Email"><Input name="email" type="email" required /></Field>
            <Field label="Temporary password (min 8)"><Input name="password" type="password" minLength={8} required autoComplete="new-password" /></Field>
            <fieldset className="text-sm"><legend className="mb-1 font-medium text-slate-700">Roles</legend>
              {roles.data?.map((r) => <label key={r.id} className="mr-4 inline-flex items-center gap-1"><input type="checkbox" name="roleIds" value={r.id} />{r.name}</label>)}
            </fieldset>
            {(dealers.data?.items.length ?? 0) > 0 && (
              <fieldset className="text-sm"><legend className="mb-1 font-medium text-slate-700">Price list dealer (for a dealer login)</legend>
                {dealers.data!.items.map((d) => <label key={d.id} className="mr-4 inline-flex items-center gap-1"><input type="checkbox" name="dealerIds" value={d.id} />{d.name}</label>)}
              </fieldset>
            )}
            <div className="sm:col-span-2 space-y-2"><ErrorText error={create.error} /><Button type="submit" disabled={create.isPending}>Create user</Button></div>
          </form>
        </Card>
      )}
      <Input placeholder="Search name or email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" />
      <ErrorText error={users.error} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2.5 py-1.5">Name</th><th className="px-2.5 py-1.5">Email</th><th className="px-2.5 py-1.5">Roles</th><th className="px-2.5 py-1.5">Status</th></tr></thead>
          <tbody>
            {users.data?.items.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-2.5 py-1.5"><Link className="underline" href={`/users/${u.id}`}>{u.name}</Link></td>
                <td className="px-2.5 py-1.5">{u.email}</td>
                <td className="px-2.5 py-1.5">{u.roles.map((r) => r.name).join(', ')}</td>
                <td className="px-2.5 py-1.5"><Badge tone={u.isActive ? 'green' : 'red'}>{u.isActive ? 'Active' : 'Inactive'}</Badge></td>
              </tr>
            ))}
            {users.data?.items.length === 0 && <tr><td className="px-2.5 py-1.5 text-slate-500" colSpan={4}>No users found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages}</span>
        <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
