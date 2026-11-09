'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ColumnAccess, PermissionMatrix, type CatalogEntry, type Cell } from '@/components/permission-matrix';
import { Badge, Button, Card, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

interface UserDetail {
  id: string; name: string; email: string; isActive: boolean; isSuperAdmin: boolean;
  roles: { id: string; name: string }[]; dealers: { id: string; name: string }[]; overrides: { key: string; effect: 'ALLOW' | 'DENY' }[];
}
interface Role { id: string; name: string; permissionKeys: string[] }

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const canManage = can('users:manage_settings');
  const user = useQuery({ queryKey: ['user', id], queryFn: () => api<UserDetail>(`/users/${id}`) });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles'), enabled: can('roles:view') });
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogEntry[]>('/permissions'), enabled: can('roles:view') });
  const activity = useQuery({ queryKey: ['activity', id], queryFn: () => api<{ items: { id: string; action: string; entity: string; createdAt: string }[] }>(`/users/${id}/activity?pageSize=10`) });

  const groups = useQuery({ queryKey: ['options', '/price-list-dealers', null], queryFn: () => api<{ items: { id: string; name: string }[] }>('/price-list-dealers?all=true'), enabled: can('price_list_dealers:view') });
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  useEffect(() => {
    if (!user.data) return;
    setRoleIds(user.data.roles.map((r) => r.id));
    setGroupIds(user.data.dealers.map((g) => g.id));
    setCells(Object.fromEntries(user.data.overrides.map((o) => [o.key, o.effect === 'ALLOW' ? 'allow' : 'deny'])));
  }, [user.data]);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['user', id] }); void qc.invalidateQueries({ queryKey: ['users'] }); void qc.invalidateQueries({ queryKey: ['activity', id] }); };
  const saveRoles = useMutation({ mutationFn: () => api(`/users/${id}/roles`, { method: 'PUT', json: { roleIds } }), onSuccess: refresh });
  const saveGroups = useMutation({ mutationFn: () => api(`/users/${id}/dealers`, { method: 'PUT', json: { dealerIds: groupIds } }), onSuccess: refresh });
  const saveOverrides = useMutation({
    mutationFn: () => api(`/users/${id}/permissions`, {
      method: 'PUT',
      json: { overrides: Object.entries(cells).filter(([, c]) => c !== 'none').map(([key, c]) => ({ key, effect: c === 'allow' ? 'ALLOW' : 'DENY' })) },
    }),
    onSuccess: refresh,
  });
  const setStatus = useMutation({ mutationFn: (isActive: boolean) => api(`/users/${id}/status`, { method: 'PATCH', json: { isActive } }), onSuccess: refresh });
  const reset = useMutation({
    mutationFn: (newPassword: string) => api(`/users/${id}/reset-password`, { method: 'POST', json: { newPassword } }),
    onSuccess: refresh,
  });

  const unlock = useMutation({ mutationFn: () => api(`/users/${id}/unlock`, { method: 'POST' }) });

  if (user.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!user.data) return <ErrorText error={user.error} />;
  const u = user.data;
  const inherited = new Set(roles.data?.filter((r) => roleIds.includes(r.id)).flatMap((r) => r.permissionKeys));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{u.name}</h1>
        <Badge tone={u.isActive ? 'green' : 'red'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
        {u.isSuperAdmin && <Badge>Super admin</Badge>}
        {can('users:edit') && <Button variant="outline" onClick={() => setStatus.mutate(!u.isActive)}>{u.isActive ? 'Deactivate' : 'Activate'}</Button>}
      </div>
      <p className="text-sm text-slate-600">{u.email}</p>
      <ErrorText error={setStatus.error} />

      <Card className="space-y-3">
        <h2 className="font-semibold">Roles</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          {roles.data?.map((r) => (
            <label key={r.id} className="inline-flex items-center gap-1">
              <input type="checkbox" disabled={!canManage} checked={roleIds.includes(r.id)}
                onChange={(e) => setRoleIds((cur) => (e.target.checked ? [...cur, r.id] : cur.filter((x) => x !== r.id)))} />{r.name}
            </label>
          ))}
        </div>
        <ErrorText error={saveRoles.error} />
        {canManage && <Button onClick={() => saveRoles.mutate()} disabled={saveRoles.isPending}>Save roles</Button>}
      </Card>

      <Card className="space-y-3">
        <div>
          <h2 className="font-semibold">Price list dealers</h2>
          <p className="text-xs text-slate-500">Tick the dealer(s) this user belongs to: they then see only those dealers' prices. Leave all unticked for staff; staff see every dealer only if their role may view dealers.</p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          {groups.data?.items.map((g) => (
            <label key={g.id} className="inline-flex items-center gap-1">
              <input type="checkbox" disabled={!canManage} checked={groupIds.includes(g.id)}
                onChange={(e) => setGroupIds((cur) => (e.target.checked ? [...cur, g.id] : cur.filter((x) => x !== g.id)))} />{g.name}
            </label>
          ))}
          {groups.data?.items.length === 0 && <span className="text-slate-500">No price list dealers yet. An administrator creates them under Price List → Price List Dealers.</span>}
        </div>
        <ErrorText error={saveGroups.error} />
        {canManage && <Button onClick={() => saveGroups.mutate()} disabled={saveGroups.isPending}>Save dealers</Button>}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Individual permissions</h2>
        <p className="text-xs text-slate-500">Click to cycle: – none, ✓ extra allow, ✕ deny (deny overrides roles). Dotted • marks access inherited from roles.{u.isSuperAdmin && ' Super admins always have full access.'}</p>
        {catalog.data && <PermissionMatrix catalog={catalog.data} value={cells} mode="override" inherited={inherited} disabled={!canManage}
          onChange={(k, c) => setCells((cur) => ({ ...cur, [k]: c }))} />}
        <h3 className="pt-2 text-sm font-semibold">Column access</h3>
        <ColumnAccess value={cells} mode="override" inherited={inherited} disabled={!canManage} onChange={(k, c) => setCells((cur) => ({ ...cur, [k]: c }))} />
        <ErrorText error={saveOverrides.error} />
        {canManage && <Button onClick={() => saveOverrides.mutate()} disabled={saveOverrides.isPending}>Save permissions</Button>}
      </Card>

      {canManage && (
        <Card>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); reset.mutate(String(f.get('pw'))); e.currentTarget.reset(); }}>
            <Field label="Reset password (user must change at next login)"><Input name="pw" type="password" minLength={8} required autoComplete="new-password" /></Field>
            <Button type="submit" variant="danger" disabled={reset.isPending}>Reset password</Button>
          </form>
          <ErrorText error={reset.error} />
          {reset.isSuccess && <p className="mt-2 text-sm text-green-700">Password reset; all sessions revoked.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
            <Button type="button" variant="outline" disabled={unlock.isPending} onClick={() => unlock.mutate()}>Clear sign-in lockout</Button>
            <span className="text-xs text-slate-500">Lets this user try signing in again straight away after too many failed attempts.</span>
          </div>
          <ErrorText error={unlock.error} />
          {unlock.isSuccess && <p className="mt-2 text-sm text-green-700">Lockout cleared.</p>}
        </Card>
      )}

      <Card>
        <h2 className="mb-2 font-semibold">Recent activity</h2>
        <ul className="space-y-1 text-sm">
          {activity.data?.items.map((a) => <li key={a.id}>{new Date(a.createdAt).toLocaleString()} — {a.action} {a.entity}</li>)}
          {activity.data?.items.length === 0 && <li className="text-slate-500">No activity.</li>}
        </ul>
      </Card>
    </div>
  );
}
