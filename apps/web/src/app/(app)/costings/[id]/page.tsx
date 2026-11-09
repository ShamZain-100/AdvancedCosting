'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { CostingEditor } from '@/components/costing-editor';
import { ErrorText } from '@/components/ui/primitives';
import { api } from '@/lib/api';

export default function CostingPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['costing', id], queryFn: () => api<Record<string, any>>(`/costings/${id}`), staleTime: 0, gcTime: 0 });
  const c = q.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{c ? `${c.costingNumber} · ${c.payload.productName}` : 'Costing'}</h1>
      {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      <ErrorText error={q.error} />
      {c && (
        <CostingEditor
          key={`${id}-${c.version}-${c.status}`} id={id} initial={c.payload} stored={c.summary}
          meta={{ status: c.status, version: c.version, number: c.costingNumber, pricingMode: c.pricingMode, rejectionReason: c.rejectionReason, approvedAt: c.approvedAt }}
        />
      )}
    </div>
  );
}
