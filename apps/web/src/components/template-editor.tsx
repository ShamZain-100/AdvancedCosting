'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { templateSchema } from '@costing/validators';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Controller, FormProvider, useFieldArray, useForm, useFormContext, useWatch } from 'react-hook-form';
import { ImageManager } from '@/components/image-manager';
import { QuickAddCombobox, type QuickAddSpec } from '@/components/master-form';
import { SelectBox } from '@/components/ui/select-box';
import { Badge, Button, Card, ErrorText, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

type Row = Record<string, any>;
const get = (o: any, path: string) => path.split('.').reduce((a: any, k) => a?.[k], o);

export const BLANK_TEMPLATE: Row = {
  name: '', code: '', typeId: '', description: '', wastagePercent: '0', gstPercent: '0', markupPercent: '0', status: 'ACTIVE', groups: [], expenses: [],
};

export const sel = 'h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm disabled:bg-slate-50';

/** The units an item can be entered in: its base unit, its own conversions, and conversion rules that touch its base unit. */
export function useItemUnits(item?: Row): Row[] {
  const can = useAuth((a) => a.can);
  const rules = useOptions('/conversions', {}, can('conversions:view'));
  if (!item) return [];
  const fromRules = (rules.data?.items ?? [])
    .filter((r) => r.isActive !== false && r.formulaType === 'FIXED_FACTOR' && (!r.itemId || r.itemId === item.id))
    .flatMap((r) => (r.toUnitId === item.unitId ? [r.fromUnit] : r.fromUnitId === item.unitId ? [r.toUnit] : []));
  return [...new Map([item.unit, ...item.unitConversions.map((c: Row) => c.unit), ...fromRules].map((u: Row) => [u.id, u])).values()];
}

export function useOptions(path: string, params: Record<string, string | undefined> = {}, enabled = true) {
  const qs = new URLSearchParams({ all: 'true' });
  Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
  const needed = Object.entries(params).every(([, v]) => v !== '');
  return useQuery({
    queryKey: ['options', path, qs.toString()],
    queryFn: () => api<{ items: Row[] }>(`${path}?${qs}`),
    enabled: enabled && needed,
  });
}

export function Err({ name }: { name: string }) {
  const { formState: { errors } } = useFormContext();
  const m = get(errors, name)?.message ?? get(errors, `${name}.root`)?.message;
  return m ? <span className="block text-xs text-red-600">{String(m)}</span> : null;
}

export function Labeled({ label, name, children, className }: { label: string; name?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 text-sm ${className ?? ''}`}>
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
      {name && <Err name={name} />}
    </label>
  );
}

export type SelectOption = { value: string; label: string; hint?: string; row?: Row };

/** Searchable dropdown bound to a react-hook-form field. `addNew` adds a "+ Add new" row that opens the quick-add form of a master. */
export function Select({ name, label, options, onPick, className, addNew, placeholder }: { name: string; label: string; options: SelectOption[]; onPick?: (value: string, row?: Row) => void; className?: string; addNew?: QuickAddSpec; placeholder?: string }) {
  const { control } = useFormContext();
  return (
    <Labeled label={label} name={name} className={className}>
      <Controller control={control} name={name} render={({ field }) => (
        <QuickAddCombobox value={field.value ?? ''} options={options} placeholder={placeholder} aria-label={label} addNew={addNew}
          onChange={(v, option) => { field.onChange(v); onPick?.(v, option?.row); }} />
      )} />
    </Labeled>
  );
}

export function Num({ name, label, className }: { name: string; label: string; className?: string }) {
  const { register } = useFormContext();
  return <Labeled label={label} name={name} className={className}><Input inputMode="decimal" {...register(name)} /></Labeled>;
}

function ItemRow({ base, categoryId, onRemove }: { base: string; categoryId: string; onRemove: () => void }) {
  const { setValue, register } = useFormContext();
  const items = useOptions('/items', { categoryId });
  const itemId = useWatch({ name: `${base}.itemId` }) as string;
  const typeId = useWatch({ name: 'typeId' }) as string;
  const groupId = useWatch({ name: `${base.split('.categories')[0]}.groupId` }) as string;
  const item = items.data?.items.find((i) => i.id === itemId);
  const units = useItemUnits(item);
  return (
    <div className="grid items-end gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[2fr_1fr_1fr_1fr_2fr_auto]">
      <Select name={`${base}.itemId`} label="Item" options={(items.data?.items ?? []).map((i) => ({ value: i.id, label: i.name, hint: i.code, row: i }))}
        addNew={{ master: 'items', prefill: { typeId, groupId, categoryId } }} onPick={(_, row) => { if (row) setValue(`${base}.unitId`, row.unit.id, { shouldValidate: true }); }} />
      <Num name={`${base}.quantity`} label="Quantity" />
      <Select name={`${base}.unitId`} label="Unit" options={units.map((u: Row) => ({ value: u.id, label: u.symbol }))} />
      <Num name={`${base}.wastagePercent`} label="Wastage %" />
      <Labeled label="Notes" name={`${base}.notes`}><Input {...register(`${base}.notes`)} /></Labeled>
      <button type="button" aria-label="Remove item" className="mb-2 text-slate-500 hover:text-red-600" onClick={onRemove}><Trash2 size={16} /></button>
    </div>
  );
}

function CategoryBlock({ base, groupId, onRemove }: { base: string; groupId: string; onRemove: () => void }) {
  const { control } = useFormContext();
  const cats = useOptions('/item-categories', { groupId });
  const categoryId = useWatch({ name: `${base}.categoryId` }) as string;
  const { fields, append, remove } = useFieldArray({ control, name: `${base}.items` });
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_auto]">
        <Select name={`${base}.categoryId`} label="Category" options={(cats.data?.items ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code }))} addNew={{ master: 'item-categories', prefill: { groupId } }} />
        <Num name={`${base}.wastagePercent`} label="Category wastage %" />
        <button type="button" aria-label="Remove category" className="mb-2 text-slate-500 hover:text-red-600" onClick={onRemove}><Trash2 size={16} /></button>
      </div>
      {categoryId && fields.map((f, i) => <ItemRow key={f.id} base={`${base}.items.${i}`} categoryId={categoryId} onRemove={() => remove(i)} />)}
      <Err name={`${base}.items`} />
      {categoryId
        ? <Button type="button" variant="outline" className="h-8" onClick={() => append({ itemId: '', quantity: '1', unitId: '', wastagePercent: '', notes: '' })}><Plus size={14} className="mr-1" />Add item</Button>
        : <p className="text-xs text-slate-500">Choose a category to add items.</p>}
    </div>
  );
}

function LabourRow({ base, onRemove }: { base: string; onRemove: () => void }) {
  const { setValue } = useFormContext();
  const labour = useOptions('/labour');
  const units = useOptions('/units');
  return (
    <div className="grid items-end gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
      <Select name={`${base}.labourId`} label="Labour" options={(labour.data?.items ?? []).map((l) => ({ value: l.id, label: l.name, hint: String(Number(l.defaultRate)), row: l }))}
        addNew={{ master: 'labour' }} onPick={(_, row) => { if (row?.unitId) setValue(`${base}.unitId`, row.unitId); }} />
      <Num name={`${base}.quantity`} label="Quantity" />
      <Select name={`${base}.unitId`} label="Unit" options={(units.data?.items ?? []).map((u) => ({ value: u.id, label: u.symbol }))} />
      <Num name={`${base}.rate`} label="Rate override" />
      <button type="button" aria-label="Remove labour" className="mb-2 text-slate-500 hover:text-red-600" onClick={onRemove}><Trash2 size={16} /></button>
    </div>
  );
}

function GroupCard({ index, typeId, onRemove, groupOptions }: { index: number; typeId: string; onRemove: () => void; groupOptions: Row[] }) {
  const { control, setValue } = useFormContext();
  const base = `groups.${index}`;
  const groupId = useWatch({ name: `${base}.groupId` }) as string;
  const taken = (useWatch({ name: 'groups' }) as Row[]).map((g) => g.groupId).filter((id, i) => i !== index);
  const cats = useFieldArray({ control, name: `${base}.categories` });
  const labour = useFieldArray({ control, name: `${base}.labour` });
  return (
    <Card className="space-y-3">
      <div className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_auto]">
        <Select name={`${base}.groupId`} label="Item group" options={groupOptions.filter((g) => !taken.includes(g.id)).map((g) => ({ value: g.id, label: g.name, hint: g.code }))}
          addNew={{ master: 'item-groups', prefill: { typeId } }} onPick={() => { setValue(`${base}.categories`, []); }} />
        <Num name={`${base}.wastagePercent`} label="Group wastage %" />
        <Button type="button" variant="outline" className="mb-0.5 h-8" onClick={onRemove}>Remove group</Button>
      </div>
      {groupId && typeId && (
        <>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Categories & materials</h4>
            {cats.fields.map((f, i) => <CategoryBlock key={f.id} base={`${base}.categories.${i}`} groupId={groupId} onRemove={() => cats.remove(i)} />)}
            <Err name={`${base}.categories`} />
            <Button type="button" variant="outline" className="h-8" onClick={() => cats.append({ categoryId: '', wastagePercent: '', items: [] })}><Plus size={14} className="mr-1" />Add category</Button>
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Labour for this group</h4>
            {labour.fields.map((f, i) => <LabourRow key={f.id} base={`${base}.labour.${i}`} onRemove={() => labour.remove(i)} />)}
            <Button type="button" variant="outline" className="h-8" onClick={() => labour.append({ labourId: '', quantity: '1', unitId: '', rate: '' })}><Plus size={14} className="mr-1" />Add labour</Button>
          </div>
        </>
      )}
    </Card>
  );
}

function ExpensesCard({ groupOptions }: { groupOptions: Row[] }) {
  const { control } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: 'expenses' });
  const expenses = useOptions('/expenses');
  const groups = (useWatch({ name: 'groups' }) as Row[]) ?? [];
  const names = new Map(groupOptions.map((g) => [g.id, g.name]));
  const scopes = [{ value: '', label: 'Whole product' }, ...groups.filter((g) => g.groupId).map((g) => ({ value: g.groupId as string, label: names.get(g.groupId) ?? 'Group' }))];
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Other expenses</h3>
        <Button type="button" variant="outline" className="h-8" onClick={() => append({ expenseId: '', groupId: '', calculationMethod: '', value: '' })}><Plus size={14} className="mr-1" />Add expense</Button>
      </div>
      <p className="text-xs text-slate-500">Leave method and value blank to use the expense master defaults when costing.</p>
      {fields.map((f, i) => (
        <div key={f.id} className="grid items-end gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[2fr_1.5fr_1.5fr_1fr_auto]">
          <Select name={`expenses.${i}.expenseId`} label="Expense" options={(expenses.data?.items ?? []).map((e) => ({ value: e.id, label: e.name, hint: e.code }))} addNew={{ master: 'expenses' }} />
          <Select name={`expenses.${i}.groupId`} label="Applies to" options={scopes.filter((s) => s.value !== '')} />
          <Select name={`expenses.${i}.calculationMethod`} label="Method override" options={['FIXED', 'PERCENTAGE', 'QUANTITY_BASED'].map((m) => ({ value: m, label: m.replace('_', ' ').toLowerCase() }))} />
          <Num name={`expenses.${i}.value`} label="Value override" />
          <button type="button" aria-label="Remove expense" className="mb-2 text-slate-500 hover:text-red-600" onClick={() => remove(i)}><Trash2 size={16} /></button>
        </div>
      ))}
      <Err name="expenses" />
    </Card>
  );
}

function Versions({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['template-versions', id], queryFn: () => api<Row[]>(`/templates/${id}/versions`) });
  return (
    <Card className="space-y-1">
      <h3 className="font-semibold">Version history</h3>
      <p className="text-xs text-slate-500">Each save creates a new version. Costings copy a template when created, so earlier costings are never affected by later edits.</p>
      <ul className="text-sm">{q.data?.map((v) => <li key={v.version}>v{v.version} · {new Date(v.createdAt).toLocaleString()} · {v.createdByName ?? '—'}{v.note ? ` · ${v.note}` : ''}</li>)}</ul>
    </Card>
  );
}

export function TemplateEditor({ id, initial, meta }: { id?: string; initial: Row; meta?: { version: number; status: string } }) {
  const router = useRouter();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const [saved, setSaved] = useState(false);
  const form = useForm<Row>({ resolver: zodResolver(templateSchema as any) as any, defaultValues: initial });
  const typeId = useWatch({ control: form.control, name: 'typeId' }) as string;
  const types = useOptions('/types');
  const groups = useOptions('/item-groups', { typeId });
  const groupArray = useFieldArray({ control: form.control, name: 'groups' });
  const archived = meta?.status === 'ARCHIVED';
  const readOnly = archived || (id ? !can('templates:edit') : !can('templates:create'));

  const save = useMutation({
    mutationFn: (v: Row) => (id ? api<Row>(`/templates/${id}`, { method: 'PUT', json: v }) : api<Row>('/templates', { method: 'POST', json: v })),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['template-versions'] });
      setSaved(true);
      if (!id) router.replace(`/templates/${r.id}`);
    },
  });

  return (
    <FormProvider {...form}>
      <form className="space-y-4" onChange={() => setSaved(false)} onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        {archived && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">This template is archived and read-only. Restore it from the template list to edit.</p>}
        <fieldset disabled={readOnly} className="space-y-4">
          <Card className="grid gap-3 sm:grid-cols-3">
            <Labeled label="Template name" name="name"><Input {...form.register('name')} /></Labeled>
            <Labeled label="Template code" name="code"><Input {...form.register('code')} /></Labeled>
            <Select name="typeId" label="Type" options={(types.data?.items ?? []).map((t) => ({ value: t.id, label: t.name, hint: t.code }))} addNew={{ master: 'types' }}
              onPick={() => { if (groupArray.fields.length && confirm('Changing the type clears the groups below. Continue?')) form.setValue('groups', []); else if (groupArray.fields.length) form.setValue('typeId', typeId); }} />
            <Num name="wastagePercent" label="Default wastage %" />
            <Num name="gstPercent" label="GST %" />
            <Num name="markupPercent" label="Default markup %" />
            <Labeled label="Status" name="status">
              <Controller control={form.control} name="status" render={({ field }) => (
                <SelectBox className={sel} value={field.value} onChange={(e) => field.onChange(e.target.value)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></SelectBox>
              )} />
            </Labeled>
            <Labeled label="Description" name="description" className="sm:col-span-3"><textarea rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" {...form.register('description')} /></Labeled>
          </Card>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Groups</h2>
              <Button type="button" variant="outline" disabled={!typeId} onClick={() => groupArray.append({ groupId: '', wastagePercent: '', categories: [], labour: [] })}><Plus size={14} className="mr-1" />Add group</Button>
            </div>
            {!typeId && <p className="text-sm text-slate-500">Select a type to add its groups.</p>}
            {groupArray.fields.map((f, i) => <GroupCard key={f.id} index={i} typeId={typeId} groupOptions={groups.data?.items ?? []} onRemove={() => groupArray.remove(i)} />)}
            <Err name="groups" />
          </div>

          <ExpensesCard groupOptions={groups.data?.items ?? []} />
        </fieldset>

        {id
          ? <ImageManager ownerPath={`/templates/${id}`} editable={!archived && can('templates:edit')} title="Product reference images" />
          : <p className="text-sm text-slate-500">Save the template first, then add reference images.</p>}

        <ErrorText error={save.error} />
        {Object.keys(form.formState.errors).length > 0 && <p className="text-sm text-red-600">Some fields need attention (highlighted in red above).</p>}
        {saved && <p className="text-sm text-green-700">Saved.</p>}
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : id ? 'Save new version' : 'Create template'}</Button>}
          <Button type="button" variant="outline" onClick={() => router.push('/templates')}>Back to templates</Button>
          {meta && <Badge>Version {meta.version}</Badge>}
        </div>
      </form>
      {id && <div className="mt-6"><Versions id={id} /></div>}
    </FormProvider>
  );
}
