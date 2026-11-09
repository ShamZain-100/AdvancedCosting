'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorText, Input } from '@/components/ui/primitives';
import { api, downloadFile } from '@/lib/api';

type Kind = { kind: string; label: string; description: string; external?: string };

export default function ExportPage() {
  const kinds = useQuery({ queryKey: ['export-kinds'], queryFn: () => api<Kind[]>('/data/export/kinds') });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const run = useMutation({
    mutationFn: async (k: Kind) => {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      if (status) qs.set('status', status);
      const q = qs.toString() ? `?${qs}` : '';
      await downloadFile(k.external ?? `/data/export/${k.kind}${['costings', 'quotations'].includes(k.kind) ? q : ''}`, `${k.kind}.xlsx`);
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Export Excel</h1>
      <p className="text-sm text-slate-600">Download formatted workbooks. Master exports use the import layout, so a file can be edited and imported again. Individual costings, price lists and quotations are exported from their own screens.</p>
      <Card className="flex flex-wrap items-end gap-3">
        <p className="w-full text-xs text-slate-500">Optional filters for costing and quotation exports</p>
        <label className="text-sm">From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">To<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="text-sm">Status<Input placeholder="e.g. APPROVED" value={status} onChange={(e) => setStatus(e.target.value.toUpperCase())} /></label>
      </Card>
      <ErrorText error={kinds.error ?? run.error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kinds.data?.map((k) => (
          <Card key={k.kind} className="flex flex-col justify-between gap-2">
            <div><h3 className="font-semibold">{k.label}</h3><p className="text-xs text-slate-500">{k.description}</p></div>
            <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate(k)}>Download .xlsx</Button>
          </Card>
        ))}
      </div>
      {kinds.data?.length === 0 && <p className="text-sm text-slate-500">You do not have permission to export any data.</p>}
    </div>
  );
}
