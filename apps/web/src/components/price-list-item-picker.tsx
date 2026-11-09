'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorText } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { SelectBox } from '@/components/ui/select-box';

type Row = Record<string, any>;
const money = (v: unknown) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Pick products from an ACTIVE price list (out-of-date items cannot be selected). */
export function PriceListItemPicker({ onConfirm, onCancel }: { onConfirm: (items: Row[]) => void; onCancel: () => void }) {
  const [listId, setListId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const lists = useQuery({ queryKey: ['price-lists', 'active'], queryFn: () => api<{ items: Row[] }>('/price-lists?status=ACTIVE&pageSize=200') });
  const list = useQuery({ queryKey: ['price-list', listId], queryFn: () => api<Row>(`/price-lists/${listId}`), enabled: !!listId });
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="space-y-3">
      <SelectBox aria-label="Price list" className="h-9 w-full max-w-md rounded-md border border-slate-300 bg-white px-2 text-sm" value={listId} onChange={(e) => { setListId(e.target.value); setPicked(new Set()); }}>
        <option value="">Select an active price list…</option>
        {lists.data?.items.map((l) => <option key={l.id} value={l.id}>{l.number} · {l.name}</option>)}
      </SelectBox>
      <ErrorText error={lists.error ?? list.error} />
      {list.data && (
        <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-slate-600"><tr><th className="px-2 py-1" /><th className="px-2 py-1">Product</th><th className="px-2 py-1 text-right">Price excl. GST</th><th className="px-2 py-1 text-right">GST %</th></tr></thead>
            <tbody>{list.data.items.map((i: Row) => (
              <tr key={i.id} className={`border-t border-slate-100 ${i.stale ? 'opacity-50' : 'cursor-pointer'}`} onClick={() => !i.stale && toggle(i.id)}>
                <td className="px-2 py-1"><input type="checkbox" disabled={i.stale} checked={picked.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${i.productName}`} /></td>
                <td className="px-2 py-1">{i.productName}{i.stale ? ' (out of date)' : ''}</td><td className="px-2 py-1 text-right tabular-nums">{money(i.effectiveExGst)}</td><td className="px-2 py-1 text-right">{Number(i.gstPercent)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" disabled={picked.size === 0} onClick={() => onConfirm(list.data!.items.filter((i: Row) => picked.has(i.id)))}>Add selected ({picked.size})</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
