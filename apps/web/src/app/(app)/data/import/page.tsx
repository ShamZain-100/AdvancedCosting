'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ImportWizard } from '@/components/import-wizard';
import { ErrorText } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { SelectBox } from '@/components/ui/select-box';

type Kind = { kind: string; label: string; notes: string[]; columns: { header: string; required: boolean; help: string; example: string }[] };
const PURCHASE_RATES: Kind = {
  kind: 'purchase-rates', label: 'Purchase rates', notes: ['Rates are converted to the item\'s base unit; items, suppliers and units are matched by code / symbol.'],
  columns: [
    { header: 'Item Code', required: true, help: 'Code from the Item Master.', example: 'MPM' }, { header: 'Supplier Code', required: false, help: 'Optional.', example: 'SUP01' }, { header: 'Unit', required: false, help: 'Unit symbol; blank = the item\'s base unit.', example: 'KG' },
    { header: 'Quantity', required: false, help: 'Blank = 1 (weights the average).', example: '20' }, { header: 'Rate', required: true, help: 'Price per the unit above.', example: '98' }, { header: 'Purchase Date', required: true, help: 'YYYY-MM-DD, not in the future.', example: '2026-01-15' },
  ],
};

export default function ImportPage() {
  const can = useAuth((s) => s.can);
  const kinds = useQuery({ queryKey: ['import-kinds'], queryFn: () => api<Kind[]>('/data/import/kinds') });
  const all = [...(kinds.data ?? []), ...(can('purchase_rates:import') ? [PURCHASE_RATES] : [])];
  const [kind, setKind] = useState('');
  const current = all.find((k) => k.kind === kind);
  const external = kind === 'purchase-rates';
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Import Excel</h1>
      <p className="text-sm text-slate-600">Import masters and documents from Excel. Suggested order: Types → Item groups → Item categories → Units → Suppliers → Items → Labour → Expenses → Templates → Purchase rates → Price lists.</p>
      <ErrorText error={kinds.error} />
      <SelectBox aria-label="What to import" className="h-9 w-full max-w-sm rounded-md border border-slate-300 bg-white px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="">Select what to import…</option>{all.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </SelectBox>
      {current && (
        <ImportWizard
          key={current.kind} label={current.label} columns={current.columns} notes={current.notes} templateName={`${current.kind}-template.xlsx`}
          templatePath={external ? '/purchase-rates/excel/template' : `/data/import/${current.kind}/template`}
          previewPath={external ? '/purchase-rates/excel/preview' : `/data/import/${current.kind}/preview`}
          confirmPath={external ? '/purchase-rates/excel/confirm' : `/data/import/${current.kind}/confirm`}
        />
      )}
      {!kinds.isLoading && all.length === 0 && <p className="text-sm text-slate-500">You do not have permission to import any data.</p>}
    </div>
  );
}
