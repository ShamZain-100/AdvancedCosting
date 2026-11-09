'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { quotationSchema } from '@costing/validators';
import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useFieldArray, useForm, useFormContext, useWatch } from 'react-hook-form';
import { CostingPicker } from '@/components/costing-picker';
import { PriceListItemPicker } from '@/components/price-list-item-picker';
import { Labeled, Num, Select, useOptions } from '@/components/template-editor';
import { Badge, Button, Card, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api, downloadFile, fileUrl } from '@/lib/api';
import { useDefaults } from '@/lib/use-defaults';
import { useAuth } from '@/lib/auth-store';

type Row = Record<string, any>;
const money = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const TONE = { DRAFT: 'gray', PENDING: 'amber', SENT: 'blue', APPROVED: 'green', REJECTED: 'red', EXPIRED: 'amber', CONVERTED: 'purple' } as const;
export const DEFAULT_TERMS = '1. Prices are in INR and exclude GST unless stated.\n2. Payment: 50% advance, balance before dispatch.\n3. Delivery within 3 weeks of confirmed order.\n4. This quotation is valid until the date shown above.';

export const BLANK_QUOTATION: Row = {
  customerId: '', customerName: '', customerMobile: '', customerEmail: '', customerAddress: '', customerGstin: '', customerState: '', quotationDate: new Date().toISOString().slice(0, 10),
  validityDays: 30, subject: '', terms: DEFAULT_TERMS, notes: '', discountPercent: '', discountAmount: '', roundGrandTotal: false, items: [],
};
const BLANK_LINE: Row = { source: 'MANUAL', costingId: '', priceListItemId: '', profitPercent: '', productName: '', productCode: '', description: '', quantity: '1', unitId: '', unitLabel: '', unitPrice: '', discountPercent: '', discountAmount: '', gstPercent: '18' };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

const positive = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? Number(v) > 0 : false;
const lineReady = (l: Row) => positive(l.quantity) && (l.source === 'MANUAL' ? !!l.productName && l.unitPrice !== '' && l.gstPercent !== '' && !Number.isNaN(Number(l.unitPrice)) : l.source === 'COSTING' ? !!l.costingId : !!l.priceListItemId);

function LineCard({ index, calc, locked, stale, image, onRemove }: { index: number; calc?: Row; locked: boolean; stale?: string | null; image?: string | null; onRemove: () => void }) {
  const { control, register } = useFormContext();
  const base = `items.${index}`;
  const l = useWatch({ control, name: base }) as Row;
  const units = useOptions('/units');
  const manual = l?.source === 'MANUAL';
  const badge = l?.source === 'COSTING' ? 'from costing' : l?.source === 'PRICE_LIST' ? 'from price list' : 'custom item';
  return (
    <Card className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">{image && /* eslint-disable-next-line @next/next/no-img-element */ <img src={fileUrl(image)} alt="" className="h-10 w-10 rounded object-cover" />}<span className="text-slate-500">#{index + 1}</span><b>{calc?.productName ?? l?.productName ?? ''}</b> <Badge>{badge}</Badge>
          {stale && <Badge tone="red">{stale}</Badge>}</div>
        {!locked && <button type="button" aria-label="Remove line" className="text-slate-500 hover:text-red-600" onClick={onRemove}><Trash2 size={16} /></button>}
      </div>
      <div className="grid items-end gap-2 sm:grid-cols-12">
        {manual
          ? <Labeled className="sm:col-span-4" label="Product / item" name={`${base}.productName`}><Input {...register(`${base}.productName`)} /></Labeled>
          : <Labeled className="sm:col-span-4" label="Name override (optional)" name={`${base}.productName`}><Input placeholder={calc?.productName} {...register(`${base}.productName`)} /></Labeled>}
        <Labeled className="sm:col-span-2" label="Code" name={`${base}.productCode`}><Input {...register(`${base}.productCode`)} /></Labeled>
        <Num className="sm:col-span-1" name={`${base}.quantity`} label="Qty" />
        <Select className="sm:col-span-1" name={`${base}.unitId`} label="Unit" options={(units.data?.items ?? []).map((u) => ({ value: u.id, label: u.symbol }))} />
        {manual
          ? <Num className="sm:col-span-2" name={`${base}.unitPrice`} label="Unit price (excl. GST)" />
          : <div className="pb-2 text-sm sm:col-span-2">Unit price <b className="block tabular-nums">{money(calc?.unitPrice)}</b></div>}
        {l?.source === 'COSTING' && <Num className="sm:col-span-2" name={`${base}.profitPercent`} label={`Profit % (blank = ${calc?.profitPercent ?? 'costing'})`} />}
        <Num className="sm:col-span-1" name={`${base}.discountPercent`} label="Disc %" />
        <Num className="sm:col-span-1" name={`${base}.discountAmount`} label="or amount" />
        <Num className="sm:col-span-1" name={`${base}.gstPercent`} label="GST %" />
        <div className="pb-2 text-right text-sm sm:col-span-2">Line total <b className="block tabular-nums">{money(calc?.lineTotal)}</b></div>
        <Labeled className="sm:col-span-12" label="Description / specification" name={`${base}.description`}><Input {...register(`${base}.description`)} /></Labeled>
      </div>
    </Card>
  );
}

export function QuotationEditor({ id, initial, meta, serverItems, stored }: {
  id?: string; initial: Row; serverItems?: Row[]; stored?: Row;
  meta?: { status: string; number: string; version: number; validUntil: string; needsReview: boolean; rejectionReason?: string | null; convertedRef?: string | null };
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const mustApprove = useDefaults().data?.approval.quotation.required ?? false;
  const [saved, setSaved] = useState(false);
  const [picker, setPicker] = useState<'costing' | 'pricelist' | null>(null);
  const [reason, setReason] = useState('');
  const [newLink, setNewLink] = useState<string | null>(null);
  const status = meta?.status ?? 'DRAFT';
  const readOnly = status !== 'DRAFT' || (id ? !can('quotations:edit') : !can('quotations:create'));
  // past draft the customer has seen these prices: show what was saved, never a new calculation
  const frozen = !!id && status !== 'DRAFT';
  const form = useForm<Row>({ resolver: zodResolver(quotationSchema as any) as any, defaultValues: initial });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const values = useWatch({ control: form.control }) as Row;
  const customers = useOptions('/customers');

  // live server-side totals (the browser does no money maths)
  const sendable = useMemo(() => {
    const idx: number[] = [];
    const rows: Row[] = [];
    (values.items ?? []).forEach((l: Row, i: number) => { if (l && lineReady(l)) { idx.push(i); rows.push(l); } });
    return { idx, body: { ...values, customerName: values.customerName || 'Customer', items: rows } };
  }, [values]);
  const body = useDebounced(JSON.stringify(sendable.body), 450);
  const preview = useQuery({
    queryKey: ['quotation-preview', id ?? 'new', body],
    queryFn: () => api<Row>('/quotations/preview', { method: 'POST', json: JSON.parse(body) }),
    enabled: sendable.idx.length > 0 && !frozen, placeholderData: keepPreviousData, retry: false,
  });
  const calcFor = (i: number) => { if (frozen) return serverItems?.[i]; const k = sendable.idx.indexOf(i); return k >= 0 ? preview.data?.lines[k] : undefined; };

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['quotations'] }); void qc.invalidateQueries({ queryKey: ['quotation', id] }); };
  const save = useMutation({
    mutationFn: (v: Row) => (id ? api<Row>(`/quotations/${id}`, { method: 'PUT', json: v }) : api<Row>('/quotations', { method: 'POST', json: v })),
    onSuccess: (r) => { refresh(); setSaved(true); if (!id) router.replace(`/quotations/${r.id}`); },
  });
  const act = useMutation({
    mutationFn: (a: { path: string; json?: unknown }) => api<Row>(`/quotations/${id}/${a.path}`, { method: 'POST', json: a.json ?? {} }),
    onSuccess: (r, a) => { refresh(); setReason(''); if (a.path === 'duplicate') router.push(`/quotations/${r.id}`); },
  });
  const share = useMutation({
    mutationFn: () => api<{ token: string; expiresAt: string }>(`/quotations/${id}/share`, { method: 'POST', json: {} }),
    onSuccess: (r) => { setNewLink(`${window.location.origin}/q/${r.token}`); void qc.invalidateQueries({ queryKey: ['quotation-shares', id] }); },
  });
  const shares = useQuery({ queryKey: ['quotation-shares', id], queryFn: () => api<Row[]>(`/quotations/${id}/shares`), enabled: !!id && ['SENT', 'APPROVED'].includes(status) });
  const revoke = useMutation({ mutationFn: (sid: string) => api(`/quotations/${id}/shares/${sid}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['quotation-shares', id] }) });
  const del = useMutation({ mutationFn: () => api(`/quotations/${id}`, { method: 'DELETE' }), onSuccess: () => { refresh(); router.push('/quotations'); } });

  const pickCustomer = (_: string, row?: Row) => {
    if (!row) return;
    const set = (k: string, v: unknown) => form.setValue(k, v ?? '', { shouldValidate: true });
    set('customerName', row.name); set('customerMobile', row.mobile); set('customerEmail', row.email); set('customerAddress', row.address); set('customerGstin', row.gstin); set('customerState', row.state);
  };
  const flagged = new Map((serverItems ?? []).map((i, n) => [n, i.staleReason as string | null]));
  const T = frozen ? stored : preview.data;
  const run = (path: string, json?: unknown) => act.mutate({ path, json });

  return (
    <FormProvider {...form}>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <form className="min-w-0 space-y-4" onChange={() => setSaved(false)} onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          {meta && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <b>{meta.number}</b><Badge tone={TONE[status as keyof typeof TONE]}>{status.toLowerCase()}</Badge><span className="text-slate-500">v{meta.version} · valid until {meta.validUntil}</span>
              {meta.convertedRef && <span>Converted: {meta.convertedRef}</span>}
            </div>
          )}
          {meta?.rejectionReason && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">Rejected: {meta.rejectionReason}</p>}
          {meta?.needsReview && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">This quotation needs review (see the notes above). If a costing it uses changed, {status === 'DRAFT' ? 'use "Reprice from sources" before sending' : 'revise the quotation to reprice it'}.</p>}
          {status !== 'DRAFT' && <p className="text-sm text-slate-500">The prices and customer details are locked as they were {status === 'SENT' || status === 'APPROVED' ? 'sent' : 'saved'}. Use Revise to edit.</p>}

          <fieldset disabled={readOnly} className="min-w-0 space-y-4">
            <Card className="grid gap-3 sm:grid-cols-3">
              <Select name="customerId" label="Existing customer (optional)" options={(customers.data?.items ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code, row: c }))} addNew={{ master: 'customers' }} onPick={pickCustomer} />
              <Labeled label="Customer name" name="customerName"><Input {...form.register('customerName')} /></Labeled>
              <Labeled label="Mobile" name="customerMobile"><Input {...form.register('customerMobile')} /></Labeled>
              <Labeled label="Email" name="customerEmail"><Input type="email" {...form.register('customerEmail')} /></Labeled>
              <Labeled label="GSTIN" name="customerGstin"><Input {...form.register('customerGstin')} /></Labeled>
              <Labeled label="State" name="customerState"><Input {...form.register('customerState')} /></Labeled>
              <Labeled label="Address" name="customerAddress" className="sm:col-span-3"><Input {...form.register('customerAddress')} /></Labeled>
              <Labeled label="Quotation date" name="quotationDate"><Input type="date" {...form.register('quotationDate')} /></Labeled>
              <Num name="validityDays" label="Valid for (days)" />
              <Labeled label="Subject" name="subject"><Input {...form.register('subject')} /></Labeled>
              <p className="text-xs text-slate-500 sm:col-span-3">Lines from a costing show that costing&apos;s main product image on the printed and shared quotation.</p>
            </Card>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Products</h2>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setPicker('costing')}>Add from approved costing</Button>
                <Button type="button" variant="outline" onClick={() => setPicker('pricelist')}>Add from price list</Button>
                <Button type="button" variant="outline" onClick={() => items.append({ ...BLANK_LINE })}>Add custom item</Button>
              </div>
            </div>
            {picker === 'costing' && <Card><CostingPicker confirmLabel="Add to quotation" onCancel={() => setPicker(null)} onConfirm={(ids) => { ids.forEach((costingId) => items.append({ ...BLANK_LINE, source: 'COSTING', costingId, gstPercent: '' })); setPicker(null); }} /></Card>}
            {picker === 'pricelist' && <Card><PriceListItemPicker onCancel={() => setPicker(null)} onConfirm={(rows) => { rows.forEach((r) => items.append({ ...BLANK_LINE, source: 'PRICE_LIST', priceListItemId: r.id, gstPercent: '' })); setPicker(null); }} /></Card>}
            <ErrorText error={form.formState.errors.items?.message} />
            <div className="space-y-2">
              {items.fields.map((f, i) => <LineCard key={f.id} index={i} calc={calcFor(i)} locked={readOnly} stale={flagged.get(i)} image={serverItems?.[i]?.image?.thumbUrl} onRemove={() => items.remove(i)} />)}
              {items.fields.length === 0 && <p className="text-sm text-slate-500">Add products from an approved costing, a price list, or as custom items.</p>}
            </div>

            <Card className="grid gap-3 sm:grid-cols-4">
              <Num name="discountPercent" label="Quotation discount %" />
              <Num name="discountAmount" label="or discount amount" />
              <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" {...form.register('roundGrandTotal')} />Round grand total</label>
              <Labeled label="Terms & conditions" name="terms" className="sm:col-span-4"><textarea rows={5} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" {...form.register('terms')} /></Labeled>
              <Labeled label="Internal / customer notes" name="notes" className="sm:col-span-4"><textarea rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" {...form.register('notes')} /></Labeled>
            </Card>
          </fieldset>

          <ErrorText error={save.error ?? act.error ?? share.error ?? del.error ?? (frozen ? null : preview.error as Error | null)} />
          {Object.keys(form.formState.errors).length > 0 && <p className="text-sm text-red-600">Some fields need attention (highlighted in red above).</p>}
          {saved && <p className="text-sm text-green-700">Saved. Totals were recalculated by the server.</p>}

          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : id ? 'Save quotation' : 'Create quotation'}</Button>}
            <Button type="button" variant="outline" onClick={() => router.push('/quotations')}>Back</Button>
            {id && status === 'DRAFT' && can('quotations:edit') && <Button type="button" variant="outline" disabled={act.isPending} onClick={() => run('reprice')}>Reprice from sources</Button>}
            {id && status === 'DRAFT' && can('quotations:edit') && <Button type="button" variant="outline" disabled={act.isPending} onClick={() => run('submit')}>Submit for approval</Button>}
            {id && (mustApprove ? status === 'APPROVED' : ['DRAFT', 'APPROVED'].includes(status)) && can('quotations:edit') && <Button type="button" disabled={act.isPending} onClick={() => run('send')}>Mark as sent</Button>}
            {id && status === 'PENDING' && can('quotations:edit') && <Button type="button" variant="outline" onClick={() => run('withdraw')}>Withdraw</Button>}
            {id && status === 'SENT' && can('quotations:edit') && <Button type="button" onClick={() => run('accept')}>Customer accepted</Button>}
            {id && can('quotations:create') && <Button type="button" variant="outline" onClick={() => run('duplicate')}>Duplicate</Button>}
            {id && can('quotations:print') && <Link href={`/quotations/${id}/print`}><Button type="button" variant="outline">Print / PDF</Button></Link>}
            {id && can('quotations:export') && <Button type="button" variant="outline" onClick={() => void downloadFile(`/quotations/${id}/export`, `${meta?.number ?? 'quotation'}.xlsx`)}>Download Excel</Button>}
            {id && ['DRAFT', 'REJECTED', 'EXPIRED'].includes(status) && can('quotations:delete') && <Button type="button" variant="danger" onClick={() => { if (confirm('Delete this quotation?')) del.mutate(); }}>Delete</Button>}
          </div>

          {id && (['PENDING', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED'].includes(status)) && (
            <Card className="space-y-2">
              <h3 className="font-semibold">Status actions</h3>
              <Field label="Reason / reference"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required for reject, decline, revise (sent / approved) and convert" /></Field>
              <div className="flex flex-wrap gap-2">
                {status === 'PENDING' && can('quotations:approve') && <Button type="button" onClick={() => run('approve')}>Approve</Button>}
                {status === 'PENDING' && can('quotations:approve') && <Button type="button" variant="danger" disabled={!reason} onClick={() => run('reject', { reason })}>Reject</Button>}
                {status === 'SENT' && <Button type="button" variant="danger" disabled={!reason} onClick={() => run('decline', { reason })}>Customer declined</Button>}
                {['APPROVED', 'SENT'].includes(status) && <Button type="button" variant="outline" disabled={!reason} onClick={() => run('convert', { reference: reason })}>Mark converted (reference)</Button>}
                {['REJECTED', 'EXPIRED', 'SENT', 'APPROVED'].includes(status) && <Button type="button" variant="outline" disabled={['SENT', 'APPROVED'].includes(status) && (!reason || !can('quotations:approve'))} onClick={() => run('revise', { reason })}>Revise (back to draft)</Button>}
              </div>
            </Card>
          )}

          {id && ['SENT', 'APPROVED'].includes(status) && can('quotations:edit') && (
            <Card className="space-y-2">
              <div className="flex items-center justify-between"><h3 className="font-semibold">Share with customer</h3><Button type="button" variant="outline" disabled={share.isPending} onClick={() => share.mutate()}>Create share link</Button></div>
              <p className="text-xs text-slate-500">A read-only page with prices, GST and terms (no costs or profit). The link works until the quotation validity ends or you revoke it. It is shown only once.</p>
              {newLink && <div className="flex gap-2"><Input readOnly value={newLink} onFocus={(e) => e.currentTarget.select()} /><Button type="button" variant="outline" onClick={() => void navigator.clipboard?.writeText(newLink)}>Copy</Button></div>}
              <ul className="text-sm">{shares.data?.map((s) => (
                <li key={s.id} className="flex items-center justify-between">
                  <span>Created {new Date(s.createdAt).toLocaleString()} · {s.revokedAt ? 'revoked' : new Date(s.expiresAt) < new Date() ? 'expired' : `expires ${new Date(s.expiresAt).toLocaleDateString()}`}</span>
                  {!s.revokedAt && new Date(s.expiresAt) >= new Date() && <button type="button" className="text-red-600 underline" onClick={() => revoke.mutate(s.id)}>Revoke</button>}
                </li>))}</ul>
            </Card>
          )}
        </form>

        <aside>
          <Card className="space-y-1 lg:sticky lg:top-4">
            <h3 className="font-semibold">Quotation total</h3>
            {!frozen && preview.isFetching && <p className="text-xs text-slate-500">Calculating…</p>}
            {!T && <p className="text-xs text-slate-500">Add products to see totals.</p>}
            {T && (
              <>
                {([['Subtotal', T.subtotal], ['Line discounts', T.lineDiscountTotal], ['Quotation discount', T.headerDiscount], ['Taxable amount', T.taxableAmount], ['GST', T.gstAmount]] as const).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm"><span>{k}</span><span className="tabular-nums">{money(v)}</span></div>
                ))}
                {Number(T.roundOff) !== 0 && <div className="flex justify-between text-sm"><span>Round off</span><span className="tabular-nums">{money(T.roundOff)}</span></div>}
                <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold"><span>Grand total</span><span className="tabular-nums">{money(T.grandTotal)}</span></div>
                {T.gstBreakdown.length > 0 && (
                  <details className="pt-2 text-xs text-slate-600"><summary className="cursor-pointer">GST by rate</summary>
                    {T.gstBreakdown.map((b: Row) => <div key={b.percent}>{Number(b.percent)}%: {money(b.taxable)} → {money(b.gst)}</div>)}
                  </details>
                )}
              </>
            )}
          </Card>
        </aside>
      </div>
    </FormProvider>
  );
}
