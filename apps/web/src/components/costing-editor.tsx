'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { costingSchema } from '@costing/validators';
import { Copy, Lock, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useFieldArray, useForm, useFormContext, useWatch } from 'react-hook-form';
import { ImageManager } from '@/components/image-manager';
import { Err, Labeled, Num, Select, useItemUnits, useOptions } from '@/components/template-editor';
import { Badge, Button, Card, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api, downloadFile } from '@/lib/api';
import { useDefaults } from '@/lib/use-defaults';
import { useAuth } from '@/lib/auth-store';
import { cn } from '@/lib/utils';

type Row = Record<string, any>;

export const BLANK_COSTING: Row = {
  productName: '', productCode: '', typeId: '', templateId: '', description: '', length: '', width: '', height: '', dimensionUnitId: '', quantity: '1', unitId: '',
  costingDate: new Date().toISOString().slice(0, 10), notes: '', wastagePercent: '0', gstPercent: '0', markupPercent: '0', extraPercent: '0', groups: [], expenses: [],
};

const money = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const STATUS_TONE = { DRAFT: 'gray', PENDING_APPROVAL: 'amber', APPROVED: 'green', REJECTED: 'red' } as const;

// ───────── live preview (server-calculated; the browser does no money maths) ─────────

const filled = (v: unknown) => typeof v === 'string' && v.trim() !== '';

/** Drop half-filled rows so the server can calculate while the user is still typing. */
function sanitize(v: Row) {
  const keyMap = { materials: new Map<string, string>(), labour: new Map<string, string>(), expenses: new Map<string, string>() };
  const groups: Row[] = [];
  (v.groups ?? []).forEach((g: Row, gi: number) => {
    if (!filled(g.groupId)) return;
    const ng = groups.length;
    const categories: Row[] = [];
    (g.categories ?? []).forEach((c: Row, ci: number) => {
      if (!filled(c.categoryId)) return;
      const nc = categories.length;
      const materials: Row[] = [];
      (c.materials ?? []).forEach((m: Row, mi: number) => {
        if (!filled(m.itemId) || !filled(m.unitId) || !(Number(m.quantity) > 0)) return;
        if (m.rateBasis === 'CUSTOM' && !filled(m.rate)) return;
        if (m.rateBasis === 'SUPPLIER' && !filled(m.supplierId)) return;
        keyMap.materials.set(`m${gi}.${ci}.${mi}`, `m${ng}.${nc}.${materials.length}`);
        materials.push(m);
      });
      categories.push({ ...c, materials });
    });
    const labour: Row[] = [];
    (g.labour ?? []).forEach((l: Row, li: number) => {
      if (!filled(l.labourId) || !(Number(l.quantity) > 0)) return;
      keyMap.labour.set(`l${gi}.${li}`, `l${ng}.${labour.length}`);
      labour.push(l);
    });
    groups.push({ ...g, categories, labour });
  });
  const gids = new Set(groups.map((g) => g.groupId));
  const expenses: Row[] = [];
  (v.expenses ?? []).forEach((e: Row, ei: number) => {
    if (!filled(e.expenseId)) return;
    keyMap.expenses.set(`e${ei}`, `e${expenses.length}`);
    expenses.push({ ...e, groupId: gids.has(e.groupId) ? e.groupId : '' });
  });
  return { payload: { ...v, groups, expenses }, keyMap };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// ───────── rows ─────────

interface Calc { rows: Row; keyMap: ReturnType<typeof sanitize>['keyMap']; companyExpenses?: Row[] }

function MaterialRow({ base, sl, categoryId, ids, calc, onRemove, onCopy }: { base: string; sl: number; categoryId: string; ids: [number, number, number]; calc?: Calc; onRemove: () => void; onCopy: () => void }) {
  const { setValue, register, control } = useFormContext();
  const can = useAuth((s) => s.can);
  const items = useOptions('/items', { categoryId });
  const suppliers = useOptions('/suppliers');
  const v = useWatch({ control, name: base }) as Row;
  const typeId = useWatch({ control, name: 'typeId' }) as string;
  const groupId = useWatch({ control, name: `groups.${ids[0]}.groupId` }) as string;
  const item = items.data?.items.find((i) => i.id === v?.itemId);
  const units = useItemUnits(item);
  const basis = ['STANDARD', ...(item?.hasRateRange ? ['MIN', 'MAX', 'AVERAGE'] : []), ...(item?.suppliers?.length ? ['SUPPLIER'] : []), ...(can('costing:manage_rates') || v?.rateBasis === 'CUSTOM' ? ['CUSTOM'] : [])];
  const res = calc?.rows.materials?.[calc.keyMap.materials.get(`m${ids[0]}.${ids[1]}.${ids[2]}`) ?? ''];
  return (
    <div className="grid items-end gap-2 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-12">
      <div className="text-sm text-slate-500 sm:col-span-1 sm:pb-2">#{sl}</div>
      <Select className="sm:col-span-3" name={`${base}.itemId`} label="Item" options={(items.data?.items ?? []).map((i) => ({ value: i.id, label: i.name, hint: i.code, row: i }))}
        addNew={{ master: 'items', prefill: { typeId, groupId, categoryId } }} onPick={(_, row) => { if (row) { setValue(`${base}.unitId`, row.unit.id, { shouldValidate: true }); setValue(`${base}.rateBasis`, 'STANDARD'); } }} />
      <Num className="sm:col-span-1" name={`${base}.quantity`} label="Qty" />
      <Select className="sm:col-span-1" name={`${base}.unitId`} label="Unit" options={units.map((u: Row) => ({ value: u.id, label: u.symbol }))} />
      <Select className="sm:col-span-2" name={`${base}.rateBasis`} label="Rate" options={basis.map((b) => ({ value: b, label: b === 'STANDARD' ? 'Standard' : b.charAt(0) + b.slice(1).toLowerCase() }))} />
      <div className="sm:col-span-1 sm:pb-2 text-right text-sm">
        {v?.rateBasis === 'CUSTOM' ? <Input inputMode="decimal" aria-label="Custom rate" {...register(`${base}.rate`)} /> : <span title="Rate from masters">{res ? money(res.rate) : '—'}</span>}
      </div>
      <div className="sm:col-span-2 sm:pb-2 text-right text-sm font-medium" title={res?.formula}>{res ? money(res.total) : '—'}</div>
      <div className="flex gap-2 sm:col-span-1 sm:pb-2">
        <button type="button" aria-label="Duplicate row" className="text-slate-500 hover:text-slate-900" onClick={onCopy}><Copy size={16} /></button>
        <button type="button" aria-label="Remove row" className="text-slate-500 hover:text-red-600" onClick={onRemove}><Trash2 size={16} /></button>
      </div>
      {v?.rateBasis === 'SUPPLIER' && (
        <Select className="sm:col-span-4 sm:col-start-2" name={`${base}.supplierId`} label="Supplier" options={(suppliers.data?.items ?? []).filter((s) => item?.suppliers?.some((x: Row) => x.supplierId === s.id)).map((s) => ({ value: s.id, label: s.name }))} />
      )}
      <div className="grid gap-2 sm:col-span-12 sm:grid-cols-[1fr_1fr_1fr_2fr]">
        <Select name={`${base}.wastageMode`} label="Wastage type" options={[{ value: 'PERCENT', label: 'Percentage' }, { value: 'QUANTITY', label: 'Quantity' }]} />
        {v?.wastageMode === 'QUANTITY' ? <Num name={`${base}.wastageQuantity`} label="Wastage qty" /> : <Num name={`${base}.wastagePercent`} label="Wastage % (blank = inherit)" />}
        <div className="text-xs text-slate-500 sm:pt-6">{res && Number(res.wastageQuantity) > 0 ? `Effective qty ${Number(res.effectiveQuantity)} (incl. ${Number(res.wastageQuantity)} wastage)` : ''}</div>
        <Labeled label="Notes / specification" name={`${base}.notes`}><Input {...register(`${base}.notes`)} /></Labeled>
      </div>
    </div>
  );
}

function CategoryBlock({ base, gi, ci, groupId, slStart, calc, onRemove }: { base: string; gi: number; ci: number; groupId: string; slStart: number; calc?: Calc; onRemove: () => void }) {
  const { control } = useFormContext();
  const cats = useOptions('/item-categories', { groupId });
  const categoryId = useWatch({ control, name: `${base}.categoryId` }) as string;
  const { fields, append, remove } = useFieldArray({ control, name: `${base}.materials` });
  const rows = useWatch({ control, name: `${base}.materials` }) as Row[];
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_auto]">
        <Select name={`${base}.categoryId`} label="Category" options={(cats.data?.items ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code }))} addNew={{ master: 'item-categories', prefill: { groupId } }} />
        <Num name={`${base}.wastagePercent`} label="Category wastage %" />
        <button type="button" aria-label="Remove category" className="mb-2 text-slate-500 hover:text-red-600" onClick={onRemove}><Trash2 size={16} /></button>
      </div>
      {categoryId && fields.map((f, i) => (
        <MaterialRow key={f.id} base={`${base}.materials.${i}`} sl={slStart + i} categoryId={categoryId} ids={[gi, ci, i]} calc={calc} onRemove={() => remove(i)} onCopy={() => append({ ...rows[i] })} />
      ))}
      <Err name={`${base}.materials`} />
      {categoryId
        ? <Button type="button" variant="outline" className="h-8" onClick={() => append({ itemId: '', notes: '', quantity: '1', unitId: '', wastageMode: 'PERCENT', wastagePercent: '', wastageQuantity: '', rateBasis: 'STANDARD', supplierId: '', rate: '' })}><Plus size={14} className="mr-1" />Add material</Button>
        : <p className="text-xs text-slate-500">Choose a category to add materials.</p>}
    </div>
  );
}

function LabourRow({ base, ids, calc, onRemove }: { base: string; ids: [number, number]; calc?: Calc; onRemove: () => void }) {
  const can = useAuth((s) => s.can);
  const { setValue } = useFormContext();
  const labour = useOptions('/labour');
  const units = useOptions('/units');
  const res = calc?.rows.labour?.[calc.keyMap.labour.get(`l${ids[0]}.${ids[1]}`) ?? ''];
  return (
    <div className="grid items-end gap-2 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-[3fr_1fr_1fr_1.2fr_1.2fr_auto]">
      <Select name={`${base}.labourId`} label="Labour" options={(labour.data?.items ?? []).map((l) => ({ value: l.id, label: l.name, hint: String(Number(l.defaultRate)), row: l }))}
        addNew={{ master: 'labour' }} onPick={(_, row) => { if (row?.unitId) setValue(`${base}.unitId`, row.unitId); setValue(`${base}.rate`, ''); }} />
      <Num name={`${base}.quantity`} label="Qty" />
      <Select name={`${base}.unitId`} label="Unit" options={(units.data?.items ?? []).map((u) => ({ value: u.id, label: u.symbol }))} />
      {can('costing:manage_rates') ? <Num name={`${base}.rate`} label={res ? `Rate (master ${money(res.custom ? '' : res.rate)})` : 'Rate override'} /> : <div className="pb-2 text-right text-sm">{res ? money(res.rate) : '—'}</div>}
      <div className="pb-2 text-right text-sm font-medium">{res ? money(res.total) : '—'}</div>
      <button type="button" aria-label="Remove labour" className="mb-2 text-slate-500 hover:text-red-600" onClick={onRemove}><Trash2 size={16} /></button>
    </div>
  );
}

function GroupCard({ index, slStart, groupOptions, calc, onRemove }: { index: number; slStart: number; groupOptions: Row[]; calc?: Calc; onRemove: () => void }) {
  const { control, setValue } = useFormContext();
  const base = `groups.${index}`;
  const typeId = useWatch({ control, name: 'typeId' }) as string;
  const groupId = useWatch({ control, name: `${base}.groupId` }) as string;
  const all = (useWatch({ control, name: 'groups' }) as Row[]) ?? [];
  const taken = all.map((g) => g.groupId).filter((_, i) => i !== index);
  const cats = useFieldArray({ control, name: `${base}.categories` });
  const labour = useFieldArray({ control, name: `${base}.labour` });
  const counts = (all[index]?.categories ?? []).map((c: Row) => c.materials?.length ?? 0);
  const starts: number[] = []; counts.reduce((s: number, n: number) => { starts.push(s); return s + n; }, slStart);
  const gres = calc?.rows.groups?.find((g: Row) => g.id === `g${index}`);
  return (
    <Card className="space-y-3">
      <div className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_auto_auto]">
        <Select name={`${base}.groupId`} label="Item group" options={groupOptions.filter((g) => !taken.includes(g.id)).map((g) => ({ value: g.id, label: g.name, hint: g.code }))} addNew={{ master: 'item-groups', prefill: { typeId } }} onPick={() => setValue(`${base}.categories`, [])} />
        <Num name={`${base}.wastagePercent`} label="Group wastage %" />
        <div className="pb-2 text-sm text-slate-600">{gres ? `Material ${money(gres.materialCost)} · Labour ${money(gres.labourCost)}` : ''}</div>
        <Button type="button" variant="outline" className="mb-0.5 h-8" onClick={onRemove}>Remove group</Button>
      </div>
      {groupId && (
        <>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Materials</h4>
            {cats.fields.map((f, i) => <CategoryBlock key={f.id} base={`${base}.categories.${i}`} gi={index} ci={i} groupId={groupId} slStart={starts[i] ?? slStart} calc={calc} onRemove={() => cats.remove(i)} />)}
            <Err name={`${base}.categories`} />
            <Button type="button" variant="outline" className="h-8" onClick={() => cats.append({ categoryId: '', wastagePercent: '', materials: [] })}><Plus size={14} className="mr-1" />Add category</Button>
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Labour</h4>
            {labour.fields.map((f, i) => <LabourRow key={f.id} base={`${base}.labour.${i}`} ids={[index, i]} calc={calc} onRemove={() => labour.remove(i)} />)}
            <Button type="button" variant="outline" className="h-8" onClick={() => labour.append({ labourId: '', quantity: '1', unitId: '', rate: '' })}><Plus size={14} className="mr-1" />Add labour</Button>
          </div>
        </>
      )}
    </Card>
  );
}

function ExpensesCard({ groupOptions, calc }: { groupOptions: Row[]; calc?: Calc }) {
  const { control } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: 'expenses' });
  const expenses = useOptions('/expenses');
  const groups = (useWatch({ control, name: 'groups' }) as Row[]) ?? [];
  const names = new Map(groupOptions.map((g) => [g.id, g.name]));
  const scopes = groups.filter((g) => g.groupId).map((g) => ({ value: g.groupId as string, label: `Only ${names.get(g.groupId) ?? 'group'}` }));
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Other expenses</h3>
        <Button type="button" variant="outline" className="h-8" onClick={() => append({ expenseId: '', groupId: '', calculationMethod: '', value: '', quantity: '', applyTiming: '' })}><Plus size={14} className="mr-1" />Add expense</Button>
      </div>
      <p className="text-xs text-slate-500">Blank method / value / timing use the expense master. Percentages apply to material + labour of the whole product, or of the chosen group.</p>
      {fields.map((f, i) => {
        const r = calc?.rows.expenses?.[calc.keyMap.expenses.get(`e${i}`) ?? ''];
        return (
          <div key={f.id} className="grid items-end gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[2fr_1.5fr_1.4fr_1fr_1fr_1.2fr_auto]">
            <Select name={`expenses.${i}.expenseId`} label="Expense" options={(expenses.data?.items ?? []).map((e) => ({ value: e.id, label: e.name, hint: e.code }))} addNew={{ master: 'expenses' }} />
            <Select name={`expenses.${i}.groupId`} label="Applies to" options={[{ value: '', label: 'Whole product' }, ...scopes]} />
            <Select name={`expenses.${i}.calculationMethod`} label="Method" options={['FIXED', 'PERCENTAGE', 'QUANTITY_BASED'].map((m) => ({ value: m, label: m.replace('_', ' ').toLowerCase() }))} />
            <Num name={`expenses.${i}.value`} label={r ? `Value (${Number(r.value)})` : 'Value'} />
            <Num name={`expenses.${i}.quantity`} label="Qty" />
            <div className="pb-2 text-right text-sm font-medium">{r ? `${money(r.amount)}${r.timing === 'AFTER_GST' ? ' (after GST)' : ''}` : '—'}</div>
            <button type="button" aria-label="Remove expense" className="mb-2 text-slate-500 hover:text-red-600" onClick={() => remove(i)}><Trash2 size={16} /></button>
          </div>
        );
      })}
      {(calc?.companyExpenses ?? []).length > 0 && (
        <div className="space-y-1 pt-2">
          <p className="flex items-center gap-1 text-xs font-medium text-slate-600"><Lock size={12} />Company expenses (added automatically, set by an administrator)</p>
          {calc!.companyExpenses!.map((c) => (
            <div key={c.expenseId} className="flex items-center justify-between gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm">
              <span className="flex items-center gap-2"><Lock size={14} className="text-slate-400" /><b>{c.name}</b>
                <span className="text-xs text-slate-500">{String(c.method).replace('_', ' ').toLowerCase()} · {c.method === 'PERCENTAGE' ? `${Number(c.value)}%` : money(c.value)}</span></span>
              <span className="font-medium tabular-nums">{money(c.amount)}{c.timing === 'AFTER_GST' ? ' (after GST)' : ''}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SummaryPanel({ data, frozen, loading, error, status, version }: { data?: Row; frozen?: boolean; loading: boolean; error: unknown; status?: string; version?: number }) {
  const line = (label: string, v: unknown, strong = false) => (
    <div className={cn('flex justify-between gap-2 py-1 text-sm', strong && 'border-t border-slate-200 pt-2 font-semibold')}><span>{label}</span><span className="tabular-nums">{money(v)}</span></div>
  );
  return (
    <Card className="space-y-1 lg:sticky lg:top-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Costing summary</h3>
        {status && <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE]}>{status.replace('_', ' ').toLowerCase()}{version ? ` · v${version}` : ''}</Badge>}
      </div>
      {frozen && <p className="text-xs text-slate-500">Saved figures. They do not change when rates change.</p>}
      {loading && <p className="text-xs text-slate-500">Calculating…</p>}
      {Boolean(error) && <p className="text-xs text-amber-700">Complete the required fields to see totals.</p>}
      {data && (
        <>
          {line('Total material cost', data.materialCost)}
          <div className="pl-3 text-xs text-slate-500">{line('of which wastage', data.materialWastage)}</div>
          {line('Total labour cost', data.labourCost)}
          {line('Other expenses', data.expenseCost)}
          {Number(data.companyExpenseCost) > 0 && <div className="pl-3 text-xs text-slate-500">{line('of which company expenses', data.companyExpenseCost)}</div>}
          {data.groups?.filter((g: Row) => g.wastagePercent !== null).length > 0 && (
            <div className="pt-1 text-xs text-slate-500">{data.groups.filter((g: Row) => g.wastagePercent !== null).map((g: Row) => <div key={g.id}>Group wastage {g.id}: {Number(g.wastagePercent)}%</div>)}</div>
          )}
          {line('Basic cost (before GST)', data.basicCost, true)}
          {line('GST', data.gstAmount)}
          {line('Total cost incl. GST', data.totalCostInclGst, true)}
          {Number(data.extraAmount) > 0 && line(data.breakdown?.find((b: Row) => b.key === 'extra')?.label ?? 'Extra', data.extraAmount)}
          {line('Markup', data.markupAmount)}
          {line('Selling price', data.sellingPrice, true)}
          {line('Profit amount', data.profitAmount)}
          <div className="flex justify-between py-1 text-sm"><span>Profit %</span><span>{Number(data.profitPercent)}%</span></div>
          {line('Net basic rate (per unit)', data.netBasicRate)}
          {line('Net selling price (per unit)', data.netSellingPrice)}
          {data.warnings?.map((w: string) => <p key={w} className="text-xs text-amber-700">{w}</p>)}
          {data.rules && (
            <details className="pt-2 text-xs text-slate-600">
              <summary className="cursor-pointer">Calculation rules in effect</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>{data.rules.decimals} decimals, round {String(data.rules.rounding).replace('_', ' ').toLowerCase()}, {data.rules.roundLines ? 'each line rounded' : 'only totals rounded'}</li>
                <li>Rates entered: material {data.rules.materialRatesIncludeGst ? 'incl.' : 'excl.'} GST, labour {data.rules.labourRatesIncludeGst ? 'incl.' : 'excl.'}, expenses {data.rules.expenseRatesIncludeGst ? 'incl.' : 'excl.'}</li>
                <li>GST: {data.rules.gstMode === 'ITEM' ? 'item % on materials, costing % otherwise' : 'costing-level %'}</li>
                <li>Wastage: {data.rules.wastageMode === 'MOST_SPECIFIC' ? 'most specific level only (item, category, group, overall)' : 'all levels added'}</li>
                <li>Markup on {data.rules.markupBase === 'BASIC_COST' ? 'basic cost (before GST)' : 'total cost incl. GST'}; profit % of {data.rules.profitBase === 'BASIC_COST' ? 'basic cost' : 'total cost'}</li>
              </ul>
            </details>
          )}
          <details className="pt-2 text-xs text-slate-600">
            <summary className="cursor-pointer">Calculation breakdown</summary>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">{data.breakdown?.map((b: Row) => <li key={b.key}>{b.label}: <b>{money(b.amount)}</b>{b.note ? <span className="text-slate-500"> ({b.note})</span> : null}</li>)}</ol>
          </details>
        </>
      )}
    </Card>
  );
}

// ───────── editor ─────────

export function CostingEditor({ id, initial, stored, meta }: { id?: string; initial: Row; stored?: Row; meta?: { status: string; version: number; number: string; pricingMode: string; rejectionReason?: string | null; approvedAt?: string | null } }) {
  const router = useRouter();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const appSettings = useDefaults().data;
  const approvalRequired = appSettings?.approval.costing.required ?? true;
  const [saved, setSaved] = useState(false);
  const [reason, setReason] = useState('');
  const [tpl, setTpl] = useState<{ name: string; code: string } | null>(null);
  const form = useForm<Row>({ resolver: zodResolver(costingSchema as any) as any, defaultValues: initial });
  const values = useWatch({ control: form.control }) as Row;
  const typeId = values.typeId as string;
  const types = useOptions('/types');
  const units = useOptions('/units');
  const groups = useOptions('/item-groups', { typeId });
  const groupArray = useFieldArray({ control: form.control, name: 'groups' });

  const status = meta?.status ?? 'DRAFT';
  const editable = status === 'DRAFT' || status === 'REJECTED';
  const readOnly = !editable || (id ? !can('costing:edit') : !can('costing:create'));
  // waiting for approval or approved: show what was saved, never a recalculation from today's rates
  const frozen = !!id && !editable;

  const { payload, keyMap } = useMemo(() => sanitize(values), [values]);
  const body = useDebounced(JSON.stringify(payload), 450);
  const preview = useQuery({
    queryKey: ['costing-preview', id ?? 'new', body],
    queryFn: () => api<Row>(`/costings/preview${id ? `?costingId=${id}` : ''}`, { method: 'POST', json: JSON.parse(body) }),
    enabled: !!typeId && !frozen, placeholderData: keepPreviousData, retry: false,
  });
  const figures = frozen ? stored : preview.data;
  const calc: Calc | undefined = figures ? { rows: { ...figures.rows, groups: figures.groups }, keyMap, companyExpenses: figures.companyExpenses } : undefined;

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['costings'] }); void qc.invalidateQueries({ queryKey: ['costing', id] }); void qc.invalidateQueries({ queryKey: ['costing-revisions', id] }); };
  const save = useMutation({
    mutationFn: (v: Row) => (id ? api<Row>(`/costings/${id}`, { method: 'PUT', json: v }) : api<Row>('/costings', { method: 'POST', json: v })),
    onSuccess: (r) => { invalidate(); setSaved(true); if (!id) router.replace(`/costings/${r.id}`); },
  });
  const act = useMutation({
    mutationFn: (a: { path: string; json?: unknown }) => api(`/costings/${id}/${a.path}`, { method: 'POST', json: a.json ?? {} }),
    onSuccess: () => { invalidate(); setReason(''); },
  });
  const asTemplate = useMutation({
    mutationFn: (v: { name: string; code: string }) => api<Row>(`/costings/${id}/save-as-template`, { method: 'POST', json: v }),
    onSuccess: (r) => { setTpl(null); router.push(`/templates/${r.id}`); },
  });
  const del = useMutation({ mutationFn: () => api(`/costings/${id}`, { method: 'DELETE' }), onSuccess: () => { invalidate(); router.push('/costings'); } });

  let sl = 1;
  return (
    <FormProvider {...form}>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <form className="min-w-0 space-y-4" onChange={() => setSaved(false)} onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          {meta?.status === 'REJECTED' && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">Rejected: {meta.rejectionReason ?? 'no reason given'}. Edit and resubmit.</p>}
          {meta?.status === 'APPROVED' && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">Approved{meta.approvedAt ? ` on ${new Date(meta.approvedAt).toLocaleDateString()}` : ''}. Rates are frozen (snapshot) and the costing is locked.</p>}
          {meta?.status === 'PENDING_APPROVAL' && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Waiting for approval. The costing is locked until it is approved or rejected.</p>}
          <fieldset disabled={readOnly} className="min-w-0 space-y-4">
            <Card className="grid gap-3 sm:grid-cols-3">
              {meta && <div className="text-sm sm:col-span-3"><span className="text-slate-500">Costing no.</span> <b>{meta.number}</b> <span className="ml-3 text-slate-500">Pricing</span> <b>{meta.pricingMode === 'LIVE' ? 'Live (follows master rates)' : 'Snapshot (frozen)'}</b></div>}
              <Labeled label="Product name" name="productName"><Input {...form.register('productName')} /></Labeled>
              <Labeled label="Product code" name="productCode"><Input {...form.register('productCode')} /></Labeled>
              <Select name="typeId" label="Type" options={(types.data?.items ?? []).map((t) => ({ value: t.id, label: t.name, hint: t.code }))} addNew={{ master: 'types' }}
                onPick={() => { if (groupArray.fields.length) { if (confirm('Changing the type clears the groups below. Continue?')) form.setValue('groups', []); else form.setValue('typeId', typeId); } }} />
              <Num name="quantity" label="Quantity" />
              <Select name="unitId" label="Unit" options={(units.data?.items ?? []).map((u) => ({ value: u.id, label: u.symbol }))} />
              <Labeled label="Costing date" name="costingDate"><Input type="date" {...form.register('costingDate')} /></Labeled>
              <Num name="length" label="Length" /><Num name="width" label="Width" /><Num name="height" label="Height" />
              <Select name="dimensionUnitId" label="Dimension unit" options={(units.data?.items ?? []).map((u) => ({ value: u.id, label: u.symbol }))} />
              <Num name="wastagePercent" label="Overall wastage %" /><Num name="gstPercent" label="GST %" /><Num name="markupPercent" label="Markup %" />
              <Num name="extraPercent" label="Extra % (on total cost, before markup)" />
              <Labeled label="Description" name="description" className="sm:col-span-3"><textarea rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" {...form.register('description')} /></Labeled>
              <Labeled label="Notes" name="notes" className="sm:col-span-3"><textarea rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" {...form.register('notes')} /></Labeled>
            </Card>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Groups</h2>
                <Button type="button" variant="outline" disabled={!typeId} onClick={() => groupArray.append({ groupId: '', wastagePercent: '', categories: [], labour: [] })}><Plus size={14} className="mr-1" />Add group</Button>
              </div>
              {!typeId && <p className="text-sm text-slate-500">Select a type to add its groups.</p>}
              {groupArray.fields.map((f, i) => {
                const start = sl;
                sl += ((values.groups?.[i]?.categories ?? []) as Row[]).reduce((n, c) => n + (c.materials?.length ?? 0), 0);
                return <GroupCard key={f.id} index={i} slStart={start} groupOptions={groups.data?.items ?? []} calc={calc} onRemove={() => groupArray.remove(i)} />;
              })}
              <Err name="groups" />
            </div>
            <ExpensesCard groupOptions={groups.data?.items ?? []} calc={calc} />
          </fieldset>

          {id
            ? <ImageManager ownerPath={`/costings/${id}`} editable={editable && can('costing:edit')} />
            : <p className="text-sm text-slate-500">Save the costing first, then add product images.</p>}

          <ErrorText error={save.error ?? act.error ?? asTemplate.error ?? del.error} />
          {Object.keys(form.formState.errors).length > 0 && <p className="text-sm text-red-600">Some fields need attention (highlighted in red above).</p>}
          {saved && <p className="text-sm text-green-700">Saved. Totals were recalculated by the server.</p>}
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : id ? 'Save costing' : 'Create costing'}</Button>}
            <Button type="button" variant="outline" onClick={() => router.push('/costings')}>Back</Button>
            {id && editable && can('costing:edit') && meta?.pricingMode === 'LIVE' && <Button type="button" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ path: 'refresh-rates' })}>Refresh rates</Button>}
            {id && editable && can('costing:edit') && <Button type="button" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ path: 'submit' })}>Submit for approval</Button>}
            {id && can('costing:print') && <Link href={`/costings/${id}/print`}><Button type="button" variant="outline">Print / PDF</Button></Link>}
            {id && can('costing:export') && <Button type="button" variant="outline" onClick={() => void downloadFile(`/data/export/costing/${id}`, `${meta?.number ?? 'costing'}.xlsx`)}>Export Excel</Button>}
            {id && can('templates:create') && <Button type="button" variant="outline" onClick={() => setTpl({ name: `${values.productName ?? ''} template`, code: '' })}>Save as template</Button>}
            {id && editable && can('costing:delete') && <Button type="button" variant="danger" onClick={() => { if (confirm('Delete this costing?')) del.mutate(); }}>Delete</Button>}
          </div>
          {id && can('costing:approve') && (status === 'PENDING_APPROVAL' || status === 'APPROVED' || (!approvalRequired && (status === 'DRAFT' || status === 'REJECTED'))) && (
            <Card className="space-y-2">
              <h3 className="font-semibold">Approval</h3>
              <Field label={status === 'APPROVED' ? 'Reason for reopening' : 'Reason (required to reject)'}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="flex gap-2">
                {(status === 'PENDING_APPROVAL' || !approvalRequired) && status !== 'APPROVED' && <Button type="button" disabled={act.isPending} onClick={() => act.mutate({ path: 'approve' })}>Approve & freeze rates</Button>}
                {status === 'PENDING_APPROVAL' && <Button type="button" variant="danger" disabled={act.isPending || !reason} onClick={() => act.mutate({ path: 'reject', json: { reason } })}>Reject</Button>}
                {status === 'APPROVED' && <Button type="button" variant="outline" disabled={act.isPending || !reason} onClick={() => act.mutate({ path: 'reopen', json: { reason } })}>Reopen for editing</Button>}
              </div>
            </Card>
          )}
          {tpl && (
            <Card className="flex flex-wrap items-end gap-3">
              <Field label="Template name"><Input value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} /></Field>
              <Field label="Template code"><Input value={tpl.code} onChange={(e) => setTpl({ ...tpl, code: e.target.value })} /></Field>
              <Button type="button" disabled={!tpl.name || !tpl.code || asTemplate.isPending} onClick={() => asTemplate.mutate(tpl)}>Create template</Button>
              <Button type="button" variant="outline" onClick={() => setTpl(null)}>Cancel</Button>
            </Card>
          )}
          {id && <Revisions id={id} />}
        </form>
        <aside><SummaryPanel data={figures} frozen={frozen} loading={!frozen && preview.isFetching} error={frozen ? null : preview.error} status={meta?.status} version={meta?.version} /></aside>
      </div>
    </FormProvider>
  );
}

function Revisions({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['costing-revisions', id], queryFn: () => api<Row[]>(`/costings/${id}/revisions`) });
  return (
    <Card className="space-y-1">
      <h3 className="font-semibold">Version history</h3>
      <ul className="text-sm">{q.data?.map((v) => (
        <li key={v.version}>v{v.version} · {new Date(v.createdAt).toLocaleString()} · {v.createdByName ?? '—'}{v.totals ? ` · selling ${money(v.totals.sellingPrice)}` : ''}{v.note ? ` · ${v.note}` : ''}</li>
      ))}</ul>
    </Card>
  );
}

