'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorText } from '@/components/ui/primitives';
import { api } from '@/lib/api';

/** "Something this document was priced from has changed" – informational; the document itself is never altered. */
export function ReviewFlags({ flags, canResolve, queryKey }: { flags: { id: string; reason: string; createdAt: string }[]; canResolve: boolean; queryKey: unknown[] }) {
  const qc = useQueryClient();
  const resolve = useMutation({ mutationFn: (id: string) => api(`/recalculation/flags/${id}/resolve`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey }) });
  if (!flags?.length) return null;
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">Needs review: an input behind this document's prices has changed</p>
      <ul className="space-y-1">
        {flags.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{f.reason} <span className="text-xs text-amber-700">· {new Date(f.createdAt).toLocaleDateString()}</span></span>
            {canResolve && <Button type="button" variant="outline" className="h-7" disabled={resolve.isPending} onClick={() => resolve.mutate(f.id)}>Mark reviewed</Button>}
          </li>
        ))}
      </ul>
      <p className="text-xs">The prices on this document were not changed. Reprice or revise it if you want the new rates, or mark it reviewed to keep the current prices.</p>
      <ErrorText error={resolve.error} />
    </div>
  );
}
