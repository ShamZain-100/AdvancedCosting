'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { PriceListEditor } from '@/components/price-list-editor';
import { ReviewFlags } from '@/components/review-flags';
import { useAuth } from '@/lib/auth-store';
import { ErrorText } from '@/components/ui/primitives';
import { api } from '@/lib/api';

export default function PriceListPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['price-list', id], queryFn: () => api<Record<string, any>>(`/price-lists/${id}`), staleTime: 0, gcTime: 0 });
  const l = q.data;
  const can = useAuth((s) => s.can);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{l ? l.name : 'Price List'}</h1>
      {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      <ErrorText error={q.error} />
      {l && <ReviewFlags flags={l.reviewFlags} canResolve={can('price_lists:edit')} queryKey={['price-list', id]} />}
      {l && <PriceListEditor key={`${id}-${l.updatedAt}-${l.status}`} id={id} initial={l.payload} serverItems={l.items} meta={{ status: l.status, number: l.number }} />}
    </div>
  );
}
