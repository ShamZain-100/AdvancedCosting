'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { BLANK_COSTING, CostingEditor } from '@/components/costing-editor';
import { Button, Card, ErrorText, Field } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useDefaults } from '@/lib/use-defaults';
import { SelectBox } from '@/components/ui/select-box';

function NewCosting() {
  const router = useRouter();
  const params = useSearchParams();
  const templateId = params.get('template');
  const scratch = params.get('scratch') === '1';
  const [pick, setPick] = useState('');
  const app = useDefaults();
  const templates = useQuery({ queryKey: ['templates', 'active'], queryFn: () => api<{ items: Record<string, any>[] }>('/templates?all=true'), enabled: !templateId && !scratch });
  const draft = useQuery({ queryKey: ['costing-from-template', templateId], queryFn: () => api<Record<string, any>>(`/costings/from-template/${templateId}`), enabled: !!templateId, staleTime: 0, gcTime: 0 });

  if (scratch) {
    if (!app.data) return <p className="text-sm text-slate-500">Loading…</p>;
    const d = app.data.defaults;
    return <CostingEditor initial={{ ...BLANK_COSTING, costingDate: new Date().toISOString().slice(0, 10), gstPercent: d.gstPercent, wastagePercent: d.wastagePercent, markupPercent: d.markupPercent, unitId: d.unitId ?? '', dimensionUnitId: d.dimensionUnitId ?? '' }} />;
  }
  if (templateId) return (
    <>
      {draft.isLoading && <p className="text-sm text-slate-500">Loading template…</p>}
      <ErrorText error={draft.error} />
      {draft.data && <CostingEditor initial={draft.data} />}
    </>
  );
  return (
    <Card className="max-w-xl space-y-4">
      <h2 className="font-semibold">How do you want to start?</h2>
      <Field label="Option A: create from a template">
        <SelectBox className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Select a template…</option>
          {templates.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
        </SelectBox>
      </Field>
      <Button disabled={!pick} onClick={() => router.push(`/costings/new?template=${pick}`)}>Start from template</Button>
      <div className="border-t border-slate-200 pt-4">
        <p className="mb-2 text-sm font-medium text-slate-700">Option B: start from scratch</p>
        <Button variant="outline" onClick={() => router.push('/costings/new?scratch=1')}>New blank costing</Button>
      </div>
    </Card>
  );
}

export default function NewCostingPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New Costing</h1>
      <Suspense><NewCosting /></Suspense>
    </div>
  );
}
