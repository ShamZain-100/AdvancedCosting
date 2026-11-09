'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { BLANK_TEMPLATE, TemplateEditor } from '@/components/template-editor';
import { ErrorText } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useDefaults } from '@/lib/use-defaults';

export default function TemplatePage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const app = useDefaults();
  const q = useQuery({ queryKey: ['template', id], queryFn: () => api<{ payload: Record<string, any>; version: number; status: string }>(`/templates/${id}`), enabled: !isNew, staleTime: 0, gcTime: 0 });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{isNew ? 'New Template' : 'Edit Template'}</h1>
      {isNew && !app.data && <p className="text-sm text-slate-500">Loading…</p>}
      {isNew && app.data && <TemplateEditor initial={{ ...BLANK_TEMPLATE, gstPercent: app.data.defaults.gstPercent, wastagePercent: app.data.defaults.wastagePercent, markupPercent: app.data.defaults.markupPercent }} />}
      {!isNew && q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      <ErrorText error={q.error} />
      {q.data && <TemplateEditor key={`${id}-${q.data.version}`} id={id} initial={q.data.payload} meta={{ version: q.data.version, status: q.data.status }} />}
    </div>
  );
}
