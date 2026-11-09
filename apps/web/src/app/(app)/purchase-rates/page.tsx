'use client';
import { useQueryClient } from '@tanstack/react-query';
import { purchaseRateSchema } from '@costing/validators';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { MasterPage, type MasterPageConfig } from '@/components/master-page';
import { Button } from '@/components/ui/primitives';
import { downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { ImportPanel } from './import-panel';
import { HistoryTab, ImpactTab, SummaryTab } from './tabs';

const n = (v: unknown, dp = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: dp }));
const itemRemote = { path: '/items', label: (i: any) => `${i.name} (${i.code})` };

const entriesConfig: MasterPageConfig = {
  title: 'Purchase Entries', singular: 'Purchase', path: '/purchase-rates', module: 'purchase_rates', schema: purchaseRateSchema,
  editable: false, hasStatus: false, searchHint: 'Search item or reference…',
  rowLabel: (r) => `${r.item.name} purchase of ${r.purchaseDate.slice(0, 10)}`,
  defaults: { itemId: '', supplierId: '', unitId: '', quantity: '', rate: '', purchaseDate: new Date().toISOString().slice(0, 10), referenceNo: '', notes: '' },
  fields: [
    { name: 'itemId', label: 'Item', type: 'select', remote: itemRemote, resets: ['unitId'], wide: true },
    { name: 'supplierId', label: 'Supplier', type: 'select', remote: { path: '/suppliers', label: (s: any) => s.name } },
    { name: 'unitId', label: 'Unit', type: 'select', remote: { path: '/purchase-rates/item-units', filterBy: 'itemId', label: (u: any) => `${u.name} (${u.symbol})` }, hint: 'Base unit and the item\'s converted units' },
    { name: 'quantity', label: 'Quantity', type: 'decimal', hint: 'Optional; weights the weighted-average rate (blank = 1)' },
    { name: 'rate', label: 'Rate (per selected unit)', type: 'decimal' },
    { name: 'purchaseDate', label: 'Purchase date', type: 'date' },
    { name: 'referenceNo', label: 'Reference / invoice no.', type: 'text' },
    { name: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ],
  columns: [
    { header: 'Date', sort: 'purchaseDate', cell: (r) => String(r.purchaseDate).slice(0, 10) },
    { header: 'Item', cell: (r) => r.item.name }, { header: 'Supplier', cell: (r) => r.supplier?.name ?? '—' },
    { header: 'Qty', cell: (r) => `${n(r.quantity, 4)} ${r.unit.symbol}` },
    { header: 'Rate', sort: 'rate', cell: (r) => `${n(r.rate, 4)} / ${r.unit.symbol}` },
    { header: 'Per base unit', cell: (r) => `${n(r.baseRate, 4)} / ${r.item.unit.symbol}` },
    { header: 'Reference', cell: (r) => r.referenceNo ?? '—' },
  ],
  filters: [{ param: 'itemId', label: 'Item', remote: itemRemote }, { param: 'supplierId', label: 'Supplier', remote: { path: '/suppliers', label: (s: any) => s.name } }],
};

const TABS = ['Rate Summary', 'Purchase Entries', 'Rate History', 'Rate Change Impact'] as const;

const TAB_PARAM: Record<string, (typeof TABS)[number]> = { summary: 'Rate Summary', entries: 'Purchase Entries', history: 'Rate History', impact: 'Rate Change Impact' };

export default function PurchaseRatesPage() {
  return <Suspense fallback={null}><PurchaseRates /></Suspense>;
}

function PurchaseRates() {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const [tab, setTab] = useState<(typeof TABS)[number]>(TAB_PARAM[useSearchParams().get('tab') ?? ''] ?? 'Rate Summary');
  const [importing, setImporting] = useState(false);
  const [impactItem, setImpactItem] = useState<string>();

  const actions = (
    <>
      {can('purchase_rates:export') && <Button variant="outline" onClick={() => void downloadFile('/purchase-rates/excel/export', 'purchase-rates.xlsx')}>Export Excel</Button>}
      {can('purchase_rates:import') && <Button variant="outline" onClick={() => setImporting((v) => !v)}>Import Excel</Button>}
    </>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Purchase & Rates</h1>
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('-mb-px border-b-2 px-3 py-2 text-sm', tab === t ? 'border-primary-600 font-semibold text-primary-700' : 'border-transparent text-slate-600')}>{t}</button>
        ))}
      </div>
      {tab === 'Rate Summary' && <SummaryTab onChangeRate={(id) => { setImpactItem(id); setTab('Rate Change Impact'); }} />}
      {tab === 'Purchase Entries' && (
        <div className="space-y-4">
          {importing && <ImportPanel onClose={() => setImporting(false)} onDone={() => { void qc.invalidateQueries({ queryKey: ['master', '/purchase-rates'] }); void qc.invalidateQueries({ queryKey: ['rates'] }); }} />}
          <MasterPage cfg={{ ...entriesConfig, headerActions: actions }} />
        </div>
      )}
      {tab === 'Rate History' && <HistoryTab />}
      {tab === 'Rate Change Impact' && <ImpactTab key={impactItem} initialItemId={impactItem} />}
    </div>
  );
}
