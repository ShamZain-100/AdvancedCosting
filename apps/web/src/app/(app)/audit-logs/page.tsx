'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorText } from '@/components/ui/primitives';
import { api } from '@/lib/api';

interface Log { id: string; action: string; entity: string; entityId: string | null; createdAt: string; ip: string | null; user: { name: string; email: string } | null }

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const logs = useQuery({ queryKey: ['audit', page], queryFn: () => api<{ items: Log[]; total: number; pageSize: number }>(`/audit-logs?page=${page}&pageSize=50`) });
  const pages = Math.max(1, Math.ceil((logs.data?.total ?? 0) / 50));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit Logs</h1>
      <ErrorText error={logs.error} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2.5 py-1.5">When</th><th className="px-2.5 py-1.5">User</th><th className="px-2.5 py-1.5">Action</th><th className="px-2.5 py-1.5">Entity</th><th className="px-2.5 py-1.5">IP</th></tr></thead>
          <tbody>{logs.data?.items.map((l) => (
            <tr key={l.id} className="border-t border-slate-100">
              <td className="px-2.5 py-1.5">{new Date(l.createdAt).toLocaleString()}</td><td className="px-2.5 py-1.5">{l.user?.name ?? '—'}</td>
              <td className="px-2.5 py-1.5">{l.action}</td><td className="px-2.5 py-1.5">{l.entity}</td><td className="px-2.5 py-1.5">{l.ip ?? ''}</td>
            </tr>))}</tbody>
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
