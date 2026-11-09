'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, ErrorText } from '@/components/ui/primitives';
import { api } from '@/lib/api';

type Def = { id: string; title: string; group: string; description: string };
const ORDER = ['Costing Reports', 'Material Reports', 'Labour Reports', 'Supplier Reports', 'Profit Reports', 'Quotation Reports'];

export default function ReportsIndex() {
  const q = useQuery({ queryKey: ['reports'], queryFn: () => api<Def[]>('/reports') });
  const groups = ORDER.map((g) => [g, (q.data ?? []).filter((r) => r.group === g)] as const).filter(([, r]) => r.length);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <ErrorText error={q.error} />
      {q.data?.length === 0 && <p className="text-sm text-slate-500">You do not have access to any reports. They need the Reports view permission plus view access to the data they read.</p>}
      {groups.map(([g, list]) => (
        <section key={g} id={g.toLowerCase().replace(/ /g, '-')} className="scroll-mt-4 space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{g}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((r) => (
              <Link key={r.id} href={`/reports/${r.id}`}><Card className="h-full p-4 transition hover:border-slate-400"><h3 className="font-semibold">{r.title}</h3><p className="mt-1 text-xs text-slate-500">{r.description}</p></Card></Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
