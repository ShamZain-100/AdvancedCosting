'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { companySettingsSchema } from '@costing/validators';
import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Button, Card, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api, fileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

type Row = Record<string, any>;

export default function CompanySettingsPage() {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const editable = can('settings:manage_settings');
  const file = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['company'], queryFn: () => api<Row>('/company-settings') });
  const c = q.data;
  const form = useForm<Row>({
    resolver: zodResolver(companySettingsSchema as never) as never, values: c && {
      name: c.name, address: c.address ?? '', phone: c.phone ?? '', email: c.email ?? '', gstin: c.gstin ?? '', state: c.state ?? '', website: c.website ?? '', currencyCode: c.currencyCode, currencySymbol: c.currencySymbol, footerNote: c.footerNote ?? '',
    },
  });
  const done = () => qc.invalidateQueries({ queryKey: ['company'] });
  const save = useMutation({ mutationFn: (v: Row) => api('/company-settings', { method: 'PUT', json: v }), onSuccess: done });
  const upload = useMutation({ mutationFn: (f: File) => { const d = new FormData(); d.append('file', f); return api('/company-settings/logo', { method: 'POST', body: d }); }, onSuccess: done });
  const remove = useMutation({ mutationFn: () => api('/company-settings/logo', { method: 'DELETE' }), onSuccess: done });
  const err = form.formState.errors;
  const f = (name: string, label: string, type = 'text') => (
    <Field label={label} error={(err[name]?.message as string | undefined)}><Input type={type} disabled={!editable} {...form.register(name)} /></Field>
  );
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Company Settings</h1>
      <p className="text-sm text-slate-600">Shown on the letterhead of printed and PDF costing sheets, quotations and price lists. More settings arrive in the settings phase.</p>
      <ErrorText error={q.error} />
      <Card className="space-y-3">
        <h2 className="font-semibold">Logo</h2>
        <div className="flex items-center gap-4">
          {c?.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={fileUrl(c.logoUrl)} alt="Company logo" className="h-16 w-auto max-w-[160px] rounded border border-slate-200 object-contain" /> : <div className="flex h-16 w-24 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">No logo</div>}
          {editable && (
            <div className="flex gap-2">
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) upload.mutate(x); if (file.current) file.current.value = ''; }} />
              <Button type="button" variant="outline" disabled={upload.isPending} onClick={() => file.current?.click()}>{c?.logoUrl ? 'Replace logo' : 'Upload logo'}</Button>
              {c?.logoUrl && <Button type="button" variant="outline" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>}
            </div>
          )}
        </div>
        <ErrorText error={upload.error ?? remove.error} />
      </Card>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <Card className="grid gap-3 sm:grid-cols-2">
          {f('name', 'Company name')}{f('gstin', 'GSTIN')}
          {f('phone', 'Phone')}{f('email', 'Email', 'email')}
          {f('state', 'State')}{f('website', 'Website')}
          {f('currencyCode', 'Currency code (3 letters)')}{f('currencySymbol', 'Currency symbol')}
          <div className="sm:col-span-2">{f('address', 'Address')}</div>
          <div className="sm:col-span-2">{f('footerNote', 'Footer note on printed documents')}</div>
          <div className="space-y-2 sm:col-span-2">
            <ErrorText error={save.error} />
            {save.isSuccess && <p className="text-sm text-green-700">Saved.</p>}
            {editable ? <Button type="submit" disabled={save.isPending}>Save company details</Button> : <p className="text-xs text-slate-500">You can view but not change these settings.</p>}
          </div>
        </Card>
      </form>
    </div>
  );
}
