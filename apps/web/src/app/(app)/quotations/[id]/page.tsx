'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { QuotationEditor } from '@/components/quotation-editor';
import { ReviewFlags } from '@/components/review-flags';
import { useAuth } from '@/lib/auth-store';
import { ErrorText } from '@/components/ui/primitives';
import { api } from '@/lib/api';

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['quotation', id], queryFn: () => api<Record<string, any>>(`/quotations/${id}`), staleTime: 0, gcTime: 0 });
  const d = q.data;
  const can = useAuth((s) => s.can);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{d ? `${d.number} · ${d.customerName}` : 'Quotation'}</h1>
      {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      <ErrorText error={q.error} />
      {d && <ReviewFlags flags={d.reviewFlags} canResolve={can('quotations:edit')} queryKey={['quotation', id]} />}
      {d && (
        <QuotationEditor
          key={`${id}-${d.version}-${d.status}`} id={id} initial={d.payload} serverItems={d.items} stored={d}
          meta={{ status: d.status, number: d.number, version: d.version, validUntil: String(d.validUntil).slice(0, 10), needsReview: d.needsReview, rejectionReason: d.rejectionReason, convertedRef: d.convertedRef }}
        />
      )}
    </div>
  );
}
