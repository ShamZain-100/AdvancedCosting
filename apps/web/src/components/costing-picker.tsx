'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorText, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { SelectBox } from '@/components/ui/select-box';

type Row = Record<string, any>;
const money = (v: unknown) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Multi-select of APPROVED costings (the only ones that can be priced). */
export function CostingPicker({ exclude = [], confirmLabel, onConfirm, onCancel }: { exclude?: string[]; confirmLabel: string; onConfirm: (ids: string[]) => void; onCancel?: () => void }) {
  const [search, setSearch] = useState('');
  const [typeId, setTypeId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const qs = new URLSearchParams({ status: 'APPROVED', pageSize: '200' });
  if (search) qs.set('search', search);
  if (typeId) qs.set('typeId', typeId);
  const list = useQuery({ queryKey: ['costings', 'approved', qs.toString()], queryFn: () => api<{ items: Row[] }>(`/costings?${qs}`) });
  const types = useQuery({ queryKey: ['options', '/types', 'all=true'], queryFn: () => api<{ items: Row[] }>('/types?all=true') });
  const rows = (list.data?.items ?? []).filter((c) => !exclude.includes(c.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search product or number…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <SelectBox aria-label="Type" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">Type: all</option>{types.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectBox>
        <Button type="button" variant="outline" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>Select all ({rows.length})</Button>
        <Button type="button" variant="outline" onClick={() => setPicked(new Set())}>Clear</Button>
      </div>
      <ErrorText error={list.error} />
      <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-slate-600"><tr><th className="px-2 py-1" /><th className="px-2 py-1">Costing</th><th className="px-2 py-1">Product</th><th className="px-2 py-1 text-right">Basic cost</th><th className="px-2 py-1 text-right">Total incl. GST</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="cursor-pointer border-t border-slate-100" onClick={() => toggle(c.id)}>
                <td className="px-2 py-1"><input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.productName}`} /></td>
                <td className="px-2 py-1">{c.costingNumber}</td><td className="px-2 py-1">{c.productName}</td>
                <td className="px-2 py-1 text-right tabular-nums">{money(c.basicCost)}</td><td className="px-2 py-1 text-right tabular-nums">{money(c.totalCostInclGst)}</td>
              </tr>
            ))}
            {!list.isLoading && rows.length === 0 && <tr><td colSpan={5} className="p-3 text-slate-500">No approved costings available.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button type="button" disabled={picked.size === 0} onClick={() => onConfirm([...picked])}>{confirmLabel} ({picked.size})</Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}
