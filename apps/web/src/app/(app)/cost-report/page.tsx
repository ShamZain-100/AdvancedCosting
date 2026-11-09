'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { DataTable, type Row, type TableColumn } from '@/components/data-table';
import { ErrorText } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

/** Every approved costing with its cost figures; the tick puts it on the dealers' price list. */
export default function CostReportPage() {
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const canPublish = can('price_lists:approve');
  const publish = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => api(`/costings/${id}/publish`, { method: 'PATCH', json: { published } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['table'] }); },
  });

  const cell = (c: TableColumn, r: Row) => {
    if (c.key === 'published') {
      return (
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={!!r.published} disabled={!canPublish || publish.isPending} aria-label={`Publish ${r.productName ?? r.costingNumber ?? 'costing'} to the price list`}
            onChange={(e) => publish.mutate({ id: r.id, published: e.target.checked })} />
          <span className="text-xs text-slate-500">{r.published ? 'On price list' : 'Not listed'}</span>
        </label>
      );
    }
    if (c.key === 'costingNumber') return <Link className="underline" href={`/costings/${r.id}`}>{r.costingNumber}</Link>;
    return undefined;
  };

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-semibold">Cost Report</h1>
        <p className="text-sm text-slate-500">Approved costings. Tick <b>Publish to price list</b> to show a product to every price list dealer, each at their own margin.</p>
      </div>
      <ErrorText error={publish.error} />
      <DataTable path="/cost-report" cell={cell} excel={can('costing:export') ? { path: '/cost-report/excel', filename: 'cost-report.xlsx' } : null} />
    </div>
  );
}
