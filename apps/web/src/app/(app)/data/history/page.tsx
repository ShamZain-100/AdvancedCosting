'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, ErrorText } from '@/components/ui/primitives';
import { api } from '@/lib/api';

type Row = Record<string, any>;

export default function ImportHistoryPage() {
  const q = useQuery({ queryKey: ['import-history'], queryFn: () => api<Row[]>('/data/import/history') });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Import History</h1>
      <ErrorText error={q.error} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2.5 py-1.5">When</th><th className="px-2.5 py-1.5">Type</th><th className="px-2.5 py-1.5">File</th><th className="px-2.5 py-1.5 text-right">Rows</th><th className="px-2.5 py-1.5 text-right">Imported</th><th className="px-2.5 py-1.5 text-right">Skipped</th><th className="px-2.5 py-1.5">By</th></tr></thead>
          <tbody>
            {q.data?.map((h) => (
              <>
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="whitespace-nowrap p-3">{new Date(h.createdAt).toLocaleString()}</td><td className="px-2.5 py-1.5">{String(h.kind).replace(/[-_]/g, ' ')}</td><td className="px-2.5 py-1.5">{h.fileName}</td>
                  <td className="px-2.5 py-1.5 text-right">{h.totalRows}</td><td className="px-2.5 py-1.5 text-right"><Badge tone="green">{h.successRows}</Badge></td>
                  <td className="px-2.5 py-1.5 text-right">{h.failedRows ? <button className="underline" onClick={() => setOpen(open === h.id ? null : h.id)}>{h.failedRows}</button> : 0}</td><td className="px-2.5 py-1.5">{h.createdByName ?? '—'}</td>
                </tr>
                {open === h.id && (
                  <tr key={`${h.id}-e`} className="bg-slate-50"><td colSpan={7} className="p-3 text-xs">
                    <ul className="space-y-0.5">{(h.errors as { row: number; errors: string[] }[] | null)?.map((e) => <li key={e.row}>Row {e.row}: {e.errors.join('; ')}</li>)}</ul>
                  </td></tr>
                )}
              </>
            ))}
            {q.data?.length === 0 && <tr><td colSpan={7} className="p-3 text-slate-500">No imports yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
