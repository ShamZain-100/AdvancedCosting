'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Boxes, Calculator, CheckCircle2, Clock, FileStack, FileText, Package, RefreshCw, Truck, type LucideIcon } from 'lucide-react';
import { ACCENT_CHIP, Badge, Card, ErrorText, type Accent, type Tone } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

type Row = Record<string, any>;
const money = (v: unknown) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const label = (s: string) => s.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const TONE = { APPROVED: 'green', CONVERTED: 'purple', SENT: 'blue', PENDING: 'amber', PENDING_APPROVAL: 'amber', REJECTED: 'red', EXPIRED: 'amber' } as Record<string, Tone>;

const STATS: { key: string; title: string; href?: string; icon: LucideIcon; accent: Accent }[] = [
  { key: 'products', title: 'Products', href: '/costings', icon: Package, accent: 'primary' },
  { key: 'costings', title: 'Costing records', href: '/costings', icon: Calculator, accent: 'secondary' },
  { key: 'templates', title: 'Templates', href: '/templates', icon: FileStack, accent: 'info' },
  { key: 'suppliers', title: 'Suppliers', href: '/masters/suppliers', icon: Truck, accent: 'warning' },
  { key: 'items', title: 'Items', href: '/masters/items', icon: Boxes, accent: 'primary' },
  { key: 'quotations', title: 'Quotations', href: '/quotations', icon: FileText, accent: 'secondary' },
  { key: 'pendingRecalculations', title: 'Recalculations waiting', href: '/recalculation', icon: RefreshCw, accent: 'warning' },
  { key: 'pendingQuotations', title: 'Pending quotations', href: '/quotations', icon: Clock, accent: 'info' },
  { key: 'approvedQuotations', title: 'Approved quotations', href: '/quotations', icon: CheckCircle2, accent: 'success' },
];

function Bars({ data, total }: { data: Record<string, number>; total: number }) {
  return (
    <div className="space-y-1.5">
      {Object.entries(data).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
        <div key={k} className="text-xs">
          <div className="mb-0.5 flex justify-between"><span>{label(k)}</span><span className="tabular-nums">{n}</span></div>
          <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-primary-600" style={{ width: `${total ? (n / total) * 100 : 0}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const me = useAuth((s) => s.me);
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Row>('/dashboard'), refetchInterval: 60_000 });
  const d = q.data;
  const sum = (o: Record<string, number> | null) => (o ? Object.values(o).reduce((a, b) => a + b, 0) : 0);

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-primary-600 px-4 py-3 text-white">
        <h1 className="text-2xl font-semibold text-white!">Welcome, {me?.name}</h1>
        <p className="text-sm text-primary-100">Overview · updated {d ? new Date(d.generatedAt).toLocaleTimeString() : '…'}</p>
      </div>
      <ErrorText error={q.error} />
      {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {d && (
        <>
          <div id="statistics" className="scroll-mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {STATS.filter((s) => d.counts[s.key] !== null && d.counts[s.key] !== undefined).map((s) => (
              <Link key={s.key} href={s.href ?? '#'} className="group">
                <Card accent={s.accent} className="flex items-center gap-2.5 p-3 transition-colors group-hover:border-slate-300">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${ACCENT_CHIP[s.accent]}`}><s.icon size={18} /></span>
                  <span className="min-w-0"><span className="block truncate text-xs text-slate-500">{s.title}</span><span className="block text-xl font-semibold tabular-nums text-slate-900">{d.counts[s.key]}</span></span>
                </Card>
              </Link>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {d.costingsByStatus && <Card className="space-y-2"><h2 className="font-semibold">Costings by status</h2><Bars data={d.costingsByStatus} total={sum(d.costingsByStatus)} /></Card>}
            {d.quotationsByStatus && (
              <Card className="space-y-2"><h2 className="font-semibold">Quotations by status</h2><Bars data={d.quotationsByStatus} total={sum(d.quotationsByStatus)} />
                <p className="pt-1 text-xs text-slate-500">Value: {Object.entries(d.quotationValueByStatus ?? {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${label(k)} ${money(v)}`).join(' · ') || '—'}</p></Card>
            )}
            {d.recentCostings && (
              <Card className="space-y-2"><div className="flex justify-between"><h2 className="font-semibold">Recent costings</h2><Link className="text-xs underline" href="/costings">All</Link></div>
                <ul className="divide-y divide-slate-100 text-sm">{d.recentCostings.map((c: Row) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0 truncate"><Link className="underline" href={`/costings/${c.id}`}>{c.costingNumber}</Link> {c.productName}</span>
                    <span className="flex shrink-0 items-center gap-2"><span className="tabular-nums">{money(c.sellingPrice)}</span><Badge tone={TONE[c.status] ?? 'gray'}>{label(c.status)}</Badge></span></li>))}
                  {d.recentCostings.length === 0 && <li className="py-1.5 text-slate-500">No costings yet.</li>}</ul></Card>
            )}
            {d.recentRateChanges && (
              <Card className="space-y-2"><div className="flex justify-between"><h2 className="font-semibold">Recent rate changes</h2><Link className="text-xs underline" href="/purchase-rates">Rates</Link></div>
                <ul className="divide-y divide-slate-100 text-sm">{d.recentRateChanges.map((r: Row) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{r.item.name} <span className="text-xs text-slate-500">{label(r.source)}</span></span>
                    <span className="shrink-0 tabular-nums"><span className="text-slate-500">{money(r.oldRate)} →</span> <b className={Number(r.newRate) > Number(r.oldRate) ? 'text-red-700' : 'text-green-700'}>{money(r.newRate)}</b> /{r.item.unit.symbol}</span></li>))}
                  {d.recentRateChanges.length === 0 && <li className="py-1.5 text-slate-500">No rate changes yet.</li>}</ul></Card>
            )}
            {d.recentQuotations && (
              <Card className="space-y-2"><div className="flex justify-between"><h2 className="font-semibold">Recent quotations</h2><Link className="text-xs underline" href="/quotations">All</Link></div>
                <ul className="divide-y divide-slate-100 text-sm">{d.recentQuotations.map((x: Row) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0 truncate"><Link className="underline" href={`/quotations/${x.id}`}>{x.number}</Link> {x.customerName}</span>
                    <span className="flex shrink-0 items-center gap-2"><span className="tabular-nums">{money(x.grandTotal)}</span><Badge tone={TONE[x.status] ?? 'gray'}>{label(x.status)}</Badge></span></li>))}
                  {d.recentQuotations.length === 0 && <li className="py-1.5 text-slate-500">No quotations yet.</li>}</ul></Card>
            )}
            {d.recentActivity && (
              <Card id="recent-activity" className="scroll-mt-4 space-y-2"><div className="flex justify-between"><h2 className="font-semibold">Recent activity</h2><Link className="text-xs underline" href="/audit-logs">Audit log</Link></div>
                <ul className="divide-y divide-slate-100 text-sm">{d.recentActivity.map((a: Row) => (
                  <li key={a.id} className="flex justify-between gap-2 py-1.5"><span>{a.user?.name ?? 'System'} · {label(a.action)} {a.entity}</span><span className="shrink-0 text-xs text-slate-500">{new Date(a.createdAt).toLocaleString()}</span></li>))}</ul></Card>
            )}
          </div>
          {Object.values(d.counts).every((v) => v === null) && <p className="text-sm text-slate-500">Your account does not have access to any dashboard figures. Ask an administrator for view permissions.</p>}
        </>
      )}
    </div>
  );
}
