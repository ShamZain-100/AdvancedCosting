'use client';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CostingPicker } from '@/components/costing-picker';
import { Button, Card, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { SelectBox } from '@/components/ui/select-box';

const sel = 'h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm';

export default function GeneratePriceListPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '', effectiveDate: new Date().toISOString().slice(0, 10), costBase: 'BASIC_COST', gstTreatment: 'EXCLUSIVE', profitMethod: 'PERCENT', profitValue: '20',
    discountPercent: '', minPrice: '', maxPrice: '', roundTo: '', notes: '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const gen = useMutation({ mutationFn: (costingIds: string[]) => api<{ id: string }>('/price-lists/generate', { method: 'POST', json: { ...form, costingIds } }), onSuccess: (r) => router.push(`/price-lists/${r.id}`) });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Generate Price List</h1>
      <p className="text-sm text-slate-600">Price many approved costings at once with the same profit and discount rules. You can fine-tune each product afterwards.</p>
      <Card className="grid gap-3 sm:grid-cols-4">
        <Field label="Price list name"><Input value={form.name} onChange={set('name')} /></Field>
        <Field label="Effective date"><Input type="date" value={form.effectiveDate} onChange={set('effectiveDate')} /></Field>
        <Field label="Profit added to"><SelectBox className={sel} value={form.costBase} onChange={set('costBase')}><option value="BASIC_COST">Cost before GST</option><option value="TOTAL_COST">Cost incl. GST</option></SelectBox></Field>
        <Field label="GST treatment"><SelectBox className={sel} value={form.gstTreatment} onChange={set('gstTreatment')}><option value="EXCLUSIVE">Prices exclude GST</option><option value="INCLUSIVE">Prices include GST</option><option value="NONE">No GST</option></SelectBox></Field>
        <Field label="Profit method"><SelectBox className={sel} value={form.profitMethod} onChange={set('profitMethod')}><option value="PERCENT">Percentage</option><option value="FIXED">Fixed amount</option></SelectBox></Field>
        <Field label="Profit (% or amount)"><Input inputMode="decimal" value={form.profitValue} onChange={set('profitValue')} /></Field>
        <Field label="Discount %"><Input inputMode="decimal" value={form.discountPercent} onChange={set('discountPercent')} /></Field>
        <Field label="Round to nearest"><Input inputMode="decimal" value={form.roundTo} onChange={set('roundTo')} /></Field>
        <Field label="Min price (all)"><Input inputMode="decimal" value={form.minPrice} onChange={set('minPrice')} /></Field>
        <Field label="Max price (all)"><Input inputMode="decimal" value={form.maxPrice} onChange={set('maxPrice')} /></Field>
      </Card>
      <ErrorText error={gen.error} />
      <Card><CostingPicker confirmLabel="Generate price list" onConfirm={(ids) => gen.mutate(ids)} /></Card>
    </div>
  );
}
