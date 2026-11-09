'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Controller, FormProvider, useFieldArray, useForm, useFormContext, useWatch } from 'react-hook-form';
import type { FieldDef, MasterPageConfig, RowsDef } from '@/components/master-page';
import { Combobox, type ComboboxProps, type ComboOption } from '@/components/ui/combobox';
import { Button, ErrorText, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { MASTER_CONFIGS } from '@/lib/masters';
import { cn } from '@/lib/utils';

type Row = Record<string, any>;

const isRows = (f: FieldDef | RowsDef): f is RowsDef => 'fields' in f;
const getPath = (o: any, path: string) => path.split('.').reduce((acc: any, k) => acc?.[k], o);

/** A code suggested from a name: upper case letters and digits joined by dashes, at most 30 characters ("Metal Pipe MAX" -> METAL-PIPE-MAX). */
export function suggestCode(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
}

/** Which master a "+ Add new" row creates, and what to fill in from the surrounding form (e.g. the chosen group for a new category). */
export interface QuickAddSpec { master: string; prefill?: Row; label?: string }

/**
 * A searchable dropdown that can also create the thing it lists. The "+ Add new" row (only shown with the master's create permission)
 * opens the master's own form in a dialog with the typed text as the name and a suggested code; the new record is selected on save.
 */
export function QuickAddCombobox({ addNew, onChange, options, ...rest }: Omit<ComboboxProps, 'addNew'> & { addNew?: QuickAddSpec }) {
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const cfg = addNew ? MASTER_CONFIGS[addNew.master] : undefined;
  const allowed = !!cfg && can(`${cfg.module}:create`);
  const [form, setForm] = useState<{ typed: string } | null>(null);
  const [created, setCreated] = useState<ComboOption | null>(null);
  // the list is refetched after a save; until then the new record is shown from what the server returned
  const merged = created && !options.some((o) => o.value === created.value) ? [...options, created] : options;
  return (
    <>
      <Combobox {...rest} options={merged} onChange={onChange}
        addNew={allowed ? { label: addNew!.label ?? cfg!.singular.toLowerCase(), onAdd: (typed) => setForm({ typed }) } : undefined} />
      {form && cfg && (
        <MasterForm variant="modal" cfg={cfg} editing={null}
          prefill={{ ...(form.typed ? { name: form.typed, code: suggestCode(form.typed) } : {}), ...addNew!.prefill }}
          onClose={() => setForm(null)}
          onSaved={(row) => {
            const opt: ComboOption = { value: row.id, label: row.name ?? row.code ?? row.id, row };
            setForm(null); setCreated(opt);
            void qc.invalidateQueries({ queryKey: ['options'] });
            onChange(row.id, opt);
          }} />
      )}
    </>
  );
}

/** Options of a form field: its static list plus, for a remote field, the records of that master (narrowed by a parent field). */
function useFieldOptions(field: FieldDef, scope: Row): { options: ComboOption[]; loading: boolean } {
  const r = field.remote;
  const filterValue = r?.filterBy ? scope[r.filterBy] : undefined;
  const q = useQuery({
    queryKey: ['options', r?.path, filterValue ?? null],
    queryFn: () => api<{ items: Row[] }>(`${r!.path}?all=true${filterValue ? `&${r!.filterParam ?? r!.filterBy}=${filterValue}` : ''}`),
    enabled: !!r && (!r.filterBy || !!filterValue),
  });
  return {
    options: [...(field.options ?? []), ...(q.data?.items.map((o) => ({ value: o.id as string, label: r!.label(o), row: o })) ?? [])],
    loading: q.isLoading,
  };
}

export function FieldInput({ field, prefix = '' }: { field: FieldDef; prefix?: string }) {
  const { control, register, setValue, formState: { errors } } = useFormContext();
  const values = useWatch({ control }) as Row;
  const name = `${prefix}${field.name}`;
  // dependent selects/showIf read siblings from the same scope (top-level form or the row)
  const scope: Row = prefix ? (getPath(values, prefix.slice(0, -1)) ?? {}) : values;
  const err = getPath(errors, name) as { message?: string } | undefined;
  const choices = useFieldOptions(field, scope);
  if (field.showIf && !field.showIf(scope)) return null;

  const r = field.remote;
  // "+ Add new" is offered when the field names a master, and (for a dependent field) once its parent has been chosen
  const addNew: QuickAddSpec | undefined = r?.master && (!r.filterBy || scope[r.filterBy])
    ? { master: r.master, prefill: r.filterBy ? { [r.filterParam ?? r.filterBy]: scope[r.filterBy] } : {} }
    : undefined;

  let input: ReactNode;
  if (field.type === 'textarea') input = <textarea rows={3} className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" {...register(name)} />;
  else if (field.type === 'checkbox') input = <input type="checkbox" className="h-4 w-4" {...register(name)} />;
  else if (field.type === 'select') {
    input = (
      <Controller control={control} name={name} render={({ field: f }) => (
        <QuickAddCombobox value={f.value ?? ''} options={choices.options} loading={choices.loading} aria-label={field.label} addNew={addNew}
          onChange={(v) => { f.onChange(v); field.resets?.forEach((x) => setValue(`${prefix}${x}`, '')); }} />
      )} />
    );
  } else {
    input = <Input type={field.type === 'email' ? 'email' : field.type === 'date' ? 'date' : 'text'} inputMode={field.type === 'decimal' || field.type === 'number' ? 'decimal' : undefined} {...register(name)} />;
  }
  return (
    <label className={cn('block space-y-0.5 text-sm', field.wide && 'sm:col-span-2', field.type === 'checkbox' && 'flex items-center gap-2 space-y-0')}>
      <span className="font-medium text-slate-700">{field.label}</span>
      {input}
      {field.hint && <span className="block text-xs text-slate-500">{field.hint}</span>}
      {err?.message && <span className="block text-xs text-red-600">{String(err.message)}</span>}
    </label>
  );
}

function RowsEditor({ def }: { def: RowsDef }) {
  const { control, formState: { errors } } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: def.name });
  const topErr = (errors as Row)[def.name]?.message as string | undefined;
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{def.label}</span>
        <Button type="button" variant="outline" className="h-7" onClick={() => append({ ...def.blank })}><Plus size={14} className="mr-1" />{def.addLabel}</Button>
      </div>
      {def.hint && <p className="text-xs text-slate-500">{def.hint}</p>}
      {fields.map((row, i) => (
        <div key={row.id} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-md border border-slate-200 p-1.5">
          <div className="grid gap-2 sm:grid-cols-3">
            {def.fields.map((f) => <FieldInput key={f.name} field={f} prefix={`${def.name}.${i}.`} />)}
          </div>
          <button type="button" aria-label="Remove row" className="mb-1 text-slate-500 hover:text-red-600" onClick={() => remove(i)}><Trash2 size={16} /></button>
        </div>
      ))}
      {topErr && <p className="text-xs text-red-600">{topErr}</p>}
    </div>
  );
}

/** Validation drops blank fields, so the fields the user emptied are sent as '' for the server to clear them. */
const emptied = (values: Row) => Object.fromEntries(Object.entries(values).filter(([, v]) => v === ''));

/**
 * The create / edit form of a master. On a master page it is a side drawer; as a quick add it is a compact dialog (`variant="modal"`)
 * drawn in a portal, so it can be opened from inside another form without becoming a nested <form>.
 */
export function MasterForm({ cfg, editing, prefill, variant = 'drawer', onClose, onSaved }: {
  cfg: MasterPageConfig; editing: Row | null; prefill?: Row; variant?: 'drawer' | 'modal'; onClose: () => void; onSaved: (row: Row) => void;
}) {
  const form = useForm<Row>({ resolver: zodResolver(cfg.schema as any) as any, defaultValues: editing ? (cfg.toForm?.(editing) ?? editing) : { ...cfg.defaults, ...prefill } });
  const save = useMutation({
    mutationFn: (v: Row) => (editing ? api<Row>(`${cfg.path}/${editing.id}`, { method: 'PUT', json: v }) : api<Row>(cfg.path, { method: 'POST', json: v })),
    onSuccess: onSaved,
  });
  const dialog = useRef<HTMLDivElement>(null);
  // a dialog takes the keyboard focus (so typing never lands in the form behind it) and closes on Escape
  useEffect(() => {
    if (variant === 'modal') dialog.current?.querySelector<HTMLElement>('input:not([type=checkbox]), button[role=combobox]')?.focus();
  }, [variant]);
  const content = (
    <>
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-base font-semibold">{editing ? `Edit ${cfg.singular}` : `New ${cfg.singular}`}</h2>
        <button type="button" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      <FormProvider {...form}>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.stopPropagation(); void form.handleSubmit((v) => save.mutate({ ...emptied(form.getValues()), ...v }))(e); }}>
          <div className="grid flex-1 content-start gap-2 overflow-y-auto p-3 sm:grid-cols-2">
            {cfg.fields.map((f) => (isRows(f) ? <RowsEditor key={f.name} def={f} /> : <FieldInput key={f.name} field={f} />))}
          </div>
          <div className="space-y-1.5 border-t border-slate-200 p-3">
            <ErrorText error={save.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        </form>
      </FormProvider>
    </>
  );
  if (variant === 'modal') {
    return createPortal(
      <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/40 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={dialog} role="dialog" aria-modal="true" aria-label={`New ${cfg.singular}`} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
          className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg bg-white shadow-xl">{content}</div>
      </div>,
      document.body,
    );
  }
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">{content}</div>
    </div>
  );
}
