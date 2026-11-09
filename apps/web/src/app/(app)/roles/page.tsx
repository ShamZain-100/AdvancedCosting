'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ColumnAccess, PermissionMatrix, type CatalogEntry, type Cell } from '@/components/permission-matrix';
import { Badge, Button, Card, ErrorText, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

interface Role { id: string; name: string; description: string | null; isSystem: boolean; userCount: number; permissionKeys: string[] }

export default function RolesPage() {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogEntry[]>('/permissions') });
  const [selected, setSelected] = useState<string | null>(null);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const role = roles.data?.find((r) => r.id === selected);

  useEffect(() => { if (!selected && roles.data?.[0]) setSelected(roles.data[0].id); }, [roles.data, selected]);
  useEffect(() => { if (role) setCells(Object.fromEntries(role.permissionKeys.map((k) => [k, 'allow' as Cell]))); }, [role]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['roles'] });
  const save = useMutation({
    mutationFn: () => api(`/roles/${selected}/permissions`, { method: 'PUT', json: { permissionKeys: Object.entries(cells).filter(([, c]) => c === 'allow').map(([k]) => k) } }),
    onSuccess: invalidate,
  });
  const create = useMutation({ mutationFn: (name: string) => api('/roles', { method: 'POST', json: { name } }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: () => api(`/roles/${selected}`, { method: 'DELETE' }), onSuccess: () => { setSelected(null); void invalidate(); } });
  const canEdit = can('roles:edit');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Roles & Permissions</h1>
      <ErrorText error={roles.error} />
      <div className="flex flex-wrap items-center gap-2">
        {roles.data?.map((r) => (
          <Button key={r.id} variant={r.id === selected ? 'primary' : 'outline'} onClick={() => setSelected(r.id)}>{r.name} <span className="ml-1 opacity-60">({r.userCount})</span></Button>
        ))}
      </div>
      {can('roles:create') && (
        <form className="flex max-w-sm gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); create.mutate(String(f.get('name'))); e.currentTarget.reset(); }}>
          <Input name="name" placeholder="New role name" required /><Button type="submit">Add</Button>
        </form>
      )}
      <ErrorText error={create.error} />
      {role && catalog.data && (
        <Card className="space-y-3">
          <div className="flex items-center gap-2"><h2 className="font-semibold">{role.name}</h2>{role.isSystem && <Badge>System</Badge>}</div>
          <PermissionMatrix catalog={catalog.data} value={cells} mode="grant" disabled={!canEdit} onChange={(k, c) => setCells((cur) => ({ ...cur, [k]: c }))} />
          <h3 className="pt-2 text-sm font-semibold">Column access</h3>
          <ColumnAccess value={cells} mode="grant" disabled={!canEdit} onChange={(k, c) => setCells((cur) => ({ ...cur, [k]: c }))} />
          <ErrorText error={save.error ?? remove.error} />
          <div className="flex gap-2">
            {canEdit && <Button onClick={() => save.mutate()} disabled={save.isPending}>Save permissions</Button>}
            {can('roles:delete') && !role.isSystem && <Button variant="danger" onClick={() => remove.mutate()}>Delete role</Button>}
          </div>
          {save.isSuccess && <p className="text-sm text-green-700">Saved.</p>}
        </Card>
      )}
    </div>
  );
}
