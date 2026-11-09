'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { priceListSchema } from '@costing/validators';
import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { CostingPicker } from '@/components/costing-picker';
import { Labeled, Num, Select } from '@/components/template-editor';
import { Badge, Button, Card, ErrorText, Input } from '@/components/ui/primitives';
import { api, downloadFile, fileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

type Row = Record<string, any>;
const money = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const TONE = { DRAFT: 'gray', ACTIVE: 'green', ARCHIVED: 'amber' } as const;
const FLAG: Record<string, string> = { MAX_APPLIED: 'capped at max', MIN_APPLIED: 'raised to min', DISCOUNT_LIMITED: 'discount limited by min', BELOW_COST: 'below cost' };

export const BLANK_PRICE_LIST: Row = {
  name: '', effectiveDate: new Date().toISOString().slice(0, 10), costBase: 'BASIC_COST', gstTreatment: 'EXCLUSIVE', roundTo: '', defaultProfitMethod: 'PERCENT',
  defaultProfitValue: '20', defaultDiscountPercent: '', notes: '', items: [],
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function PriceListEditor({ id, initial, meta, serverItems }: { id?: string; initial: Row; meta?: { status: string; number: string }; serverItems?: Row[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  const form = useForm<Row>({ resolver: zodResolver(priceListSchema as any) as any, defaultValues: initial });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const values = useWatch({ control: form.control }) as Row;
  const status = meta?.status ?? 'DRAFT';
  const readOnly = status !== 'DRAFT' || (id ? !can('price_lists:edit') : !can('price_lists:create'));

  // costing names for display (from the saved list, or from the picker's approved list)
  const approved = useQuery({ queryKey: ['costings', 'approved', 'all'], queryFn: () => api<{ items: Row[] }>('/costings?status=APPROVED&pageSize=200') });
  const names = useMemo(() => {
    const m = new Map<string, Row>();
    approved.data?.items.forEach((c) => m.set(c.id, c));
    serverItems?.forEach((i) => m.set(i.costingId, { ...m.get(i.costingId), costingNumber: i.costingNumber, productName: i.productName }));
    return m;
  }, [approved.data, serverItems]);

  // live server-side preview of every row
  const sendable = useMemo(() => {
    const idx: number[] = [];
    const rows: Row[] = [];
    (values.items ?? []).forEach((it: Row, i: number) => {
      if (it?.costingId && it.profitValue !== '' && !Number.isNaN(Number(it.profitValue))) { idx.push(i); rows.push(it); }
    });
    return { idx, body: { ...values, items: rows } };
  }, [values]);
  const body = useDebounced(JSON.stringify(sendable.body), 450);
  const preview = useQuery({
    queryKey: ['price-preview', id ?? 'new', body],
    queryFn: () => api<{ items: Row[] }>('/price-lists/preview', { method: 'POST', json: JSON.parse(body) }),
    enabled: sendable.idx.length > 0 && status === 'DRAFT', placeholderData: keepPreviousData, retry: false,
  });
  const calc = (i: number) => {
    if (status !== 'DRAFT') return serverItems?.[i]; // active and archived lists show their saved prices
    const k = sendable.idx.indexOf(i);
    return k >= 0 ? preview.data?.items[k] : undefined;
  };

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['price-lists'] }); void qc.invalidateQueries({ queryKey: ['price-list', id] }); };
  const save = useMutation({
    mutationFn: (v: Row) => (id ? api<Row>(`/price-lists/${id}`, { method: 'PUT', json: v }) : api<Row>('/price-lists', { method: 'POST', json: v })),
    onSuccess: (r) => { invalidate(); setSaved(true); if (!id) router.replace(`/price-lists/${r.id}`); },
  });
  const act = useMutation({
    mutationFn: (a: { path: string; method?: string; json?: unknown }) => api(`/price-lists/${id}/${a.path}`, { method: a.method ?? 'POST', json: a.json ?? {} }),
    onSuccess: invalidate,
  });
  const del = useMutation({ mutationFn: () => api(`/price-lists/${id}`, { method: 'DELETE' }), onSuccess: () => { invalidate(); router.push('/price-lists'); } });

  const addCostings = (ids: string[]) => {
    const existing = new Set((values.items ?? []).map((i: Row) => i.costingId));
    ids.filter((c) => !existing.has(c)).forEach((costingId) => items.append({
      costingId, profitMethod: values.defaultProfitMethod, profitValue: values.defaultProfitValue, discountPercent: values.defaultDiscountPercent ?? '', discountAmount: '', minPrice: '', maxPrice: '', notes: '',
    }));
    setAdding(false);
  };
  const applyDefaults = () => (values.items ?? []).forEach((_: Row, i: number) => {
    form.setValue(`items.${i}.profitMethod`, values.defaultProfitMethod);
    form.setValue(`items.${i}.profitValue`, values.defaultProfitValue);
    form.setValue(`items.${i}.discountPercent`, values.defaultDiscountPercent ?? '');
  });
  const stale = (serverItems ?? []).filter((i) => i.stale);

  return (
    <FormProvider {...form}>
      <form className="space-y-4" onChange={() => setSaved(false)} onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        {meta && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <b>{meta.number}</b><Badge tone={TONE[status as keyof typeof TONE]}>{status.toLowerCase()}</Badge>
            {status !== 'DRAFT' && <span className="text-slate-500">Read-only. Revert to draft to edit.</span>}
          </div>
        )}
        {stale.length > 0 && (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            {stale.length} item(s) are priced from a costing that has changed ({stale.map((s) => s.productName).join(', ')}). {status === 'DRAFT' ? 'Use "Reprice from costings" to update them.' : 'Revert the list to draft and reprice before using it.'}
          </p>
        )}
        <fieldset disabled={readOnly} className="space-y-4">
          <Card className="grid gap-3 sm:grid-cols-4">
            <Labeled label="Price list name" name="name" className="sm:col-span-2"><Input {...form.register('name')} /></Labeled>
            <Labeled label="Effective date" name="effectiveDate"><Input type="date" {...form.register('effectiveDate')} /></Labeled>
            <Num name="roundTo" label="Round prices to nearest" />
            <Select name="costBase" label="Profit is added to" options={[{ value: 'BASIC_COST', label: 'Cost before GST' }, { value: 'TOTAL_COST', label: 'Cost incl. GST' }]} />
            <Select name="gstTreatment" label="GST treatment" options={[{ value: 'EXCLUSIVE', label: 'Prices exclude GST' }, { value: 'INCLUSIVE', label: 'Prices include GST' }, { value: 'NONE', label: 'No GST' }]} />
            <Select name="defaultProfitMethod" label="Default profit method" options={[{ value: 'PERCENT', label: 'Percentage' }, { value: 'FIXED', label: 'Fixed amount' }]} />
            <Num name="defaultProfitValue" label="Default profit (% or amount)" />
            <Num name="defaultDiscountPercent" label="Default discount %" />
            <Labeled label="Notes" name="notes" className="sm:col-span-3"><Input {...form.register('notes')} /></Labeled>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Products</h2>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={applyDefaults} disabled={items.fields.length === 0}>Apply defaults to all rows</Button>
              <Button type="button" onClick={() => setAdding((a) => !a)}>Add approved costings</Button>
            </div>
          </div>
          {adding && <Card><CostingPicker exclude={(values.items ?? []).map((i: Row) => i.costingId)} confirmLabel="Add to list" onConfirm={addCostings} onCancel={() => setAdding(false)} /></Card>}
          <ErrorText error={form.formState.errors.items?.message} />

          <div className="space-y-2">
            {items.fields.map((f, i) => {
              const r = calc(i);
              const cid = values.items?.[i]?.costingId as string;
              const info = names.get(cid);
              const flags: string[] = r?.flags ?? [];
              return (
                <Card key={f.id} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">{serverItems?.[i]?.image && /* eslint-disable-next-line @next/next/no-img-element */ <img src={fileUrl(serverItems[i].image.thumbUrl)} alt="" className="h-10 w-10 rounded object-cover" />}<span><b>{info?.productName ?? serverItems?.[i]?.productName ?? 'Product'}</b> <span className="text-slate-500">{info?.costingNumber}</span>
                      {serverItems?.[i]?.stale && <span className="ml-2"><Badge tone="red">out of date</Badge></span>}</span></div>
                    <button type="button" aria-label="Remove product" className="text-slate-500 hover:text-red-600" onClick={() => items.remove(i)}><Trash2 size={16} /></button>
                  </div>
                  <div className="grid items-end gap-2 sm:grid-cols-6">
                    <Select name={`items.${i}.profitMethod`} label="Profit" options={[{ value: 'PERCENT', label: '% of cost' }, { value: 'FIXED', label: 'Fixed amount' }]} />
                    <Num name={`items.${i}.profitValue`} label="Profit value" />
                    <Num name={`items.${i}.discountPercent`} label="Discount %" />
                    <Num name={`items.${i}.discountAmount`} label="or discount amount" />
                    <Num name={`items.${i}.minPrice`} label="Min price" />
                    <Num name={`items.${i}.maxPrice`} label="Max price" />
                  </div>
                  {r && (
                    <div className="grid gap-x-4 gap-y-1 rounded-md bg-slate-50 p-2 text-xs sm:grid-cols-4 lg:grid-cols-8">
                      <span>Cost base (1 unit) <b className="block text-sm">{money(r.costBaseAmount)}</b></span>
                      <span>Profit <b className="block text-sm">{money(r.profitAmount)}</b></span>
                      <span>Excl. GST <b className="block text-sm">{money(r.listPriceExGst)}</b></span>
                      <span>GST <b className="block text-sm">{money(r.gstAmount)}</b></span>
                      <span>Incl. GST <b className="block text-sm">{money(r.listPriceInclGst)}</b></span>
                      <span>Discount <b className="block text-sm">{money(r.discountApplied)}</b></span>
                      <span>Effective price <b className="block text-sm text-slate-900">{money(r.effectivePrice)}</b></span>
                      <span>Margin <b className="block text-sm">{Number(r.marginPercent)}%</b></span>
                      {flags.length > 0 && <span className="text-amber-700 sm:col-span-4 lg:col-span-8">{flags.map((x) => FLAG[x] ?? x).join(' · ')}</span>}
                    </div>
                  )}
                </Card>
              );
            })}
            {items.fields.length === 0 && <p className="text-sm text-slate-500">No products yet. Add approved costings to price them.</p>}
          </div>
        </fieldset>

        <ErrorText error={save.error ?? act.error ?? del.error ?? (status === 'DRAFT' ? preview.error as Error | null : null)} />
        {saved && <p className="text-sm text-green-700">Saved.</p>}
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : id ? 'Save price list' : 'Create price list'}</Button>}
          <Button type="button" variant="outline" onClick={() => router.push('/price-lists')}>Back</Button>
          {id && status === 'DRAFT' && can('price_lists:edit') && <Button type="button" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ path: 'reprice' })}>Reprice from costings</Button>}
          {id && status === 'DRAFT' && can('price_lists:edit') && <Button type="button" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ path: 'status', method: 'PATCH', json: { status: 'ACTIVE' } })}>Activate</Button>}
          {id && status === 'ACTIVE' && can('price_lists:edit') && <Button type="button" variant="outline" onClick={() => act.mutate({ path: 'status', method: 'PATCH', json: { status: 'DRAFT' } })}>Revert to draft</Button>}
          {id && status !== 'ARCHIVED' && can('price_lists:edit') && <Button type="button" variant="outline" onClick={() => act.mutate({ path: 'status', method: 'PATCH', json: { status: 'ARCHIVED' } })}>Archive</Button>}
          {id && status === 'ARCHIVED' && can('price_lists:edit') && <Button type="button" variant="outline" onClick={() => act.mutate({ path: 'status', method: 'PATCH', json: { status: 'DRAFT' } })}>Restore to draft</Button>}
          {id && can('price_lists:export') && <Button type="button" variant="outline" onClick={() => void downloadFile(`/price-lists/${id}/export`, `${meta?.number ?? 'price-list'}.xlsx`)}>Export Excel</Button>}
          {id && can('price_lists:print') && <Link href={`/price-lists/${id}/print`}><Button type="button" variant="outline">Print / PDF</Button></Link>}
          {id && status !== 'ACTIVE' && can('price_lists:delete') && <Button type="button" variant="danger" onClick={() => { if (confirm('Delete this price list?')) del.mutate(); }}>Delete</Button>}
        </div>
      </form>
    </FormProvider>
  );
}
