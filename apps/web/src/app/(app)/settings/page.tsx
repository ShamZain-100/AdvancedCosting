'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { SelectBox } from '@/components/ui/select-box';

type Row = Record<string, any>;
const sel = 'h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm disabled:bg-slate-50';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Section({ title, hint, children, onSave, saving, error, saved, canEdit }: { title: string; hint?: string; children: ReactNode; onSave: () => void; saving: boolean; error: unknown; saved: boolean; canEdit: boolean }) {
  return (
    <Card id={title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')} className="scroll-mt-4 space-y-3">
      <div><h2 className="font-semibold">{title}</h2>{hint && <p className="text-xs text-slate-500">{hint}</p>}</div>
      <fieldset disabled={!canEdit} className="space-y-3">{children}</fieldset>
      <ErrorText error={error} />
      {saved && <p className="text-sm text-green-700">Saved.</p>}
      {canEdit && <Button type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</Button>}
    </Card>
  );
}

export default function SettingsPage() {
  const can = useAuth((s) => s.can);
  const canEdit = can('settings:manage_settings');
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Row>('/settings') });
  const units = useQuery({ queryKey: ['options', '/units', 'all=true'], queryFn: () => api<{ items: Row[] }>('/units?all=true') });
  const rules = useQuery({ queryKey: ['costing-rules'], queryFn: () => api<Row>('/costing-settings'), enabled: can('costing:view') });
  const policy = useQuery({ queryKey: ['recalc-policy'], queryFn: () => api<Row>('/recalculation/policy'), enabled: can('purchase_rates:view') });
  const s = settings.data;

  // each section keeps its own draft so editing one never disturbs another
  const [fy, setFy] = useState<number | null>(null);
  const [numbering, setNumbering] = useState<Row | null>(null);
  const [defaults, setDefaults] = useState<Row | null>(null);
  const [print, setPrint] = useState<Row | null>(null);
  const [approval, setApproval] = useState<Row | null>(null);
  const [calc, setCalc] = useState<Row | null>(null);
  const [recalc, setRecalc] = useState<Row | null>(null);
  const qc = useQueryClient();
  useEffect(() => { if (s) { setFy(s.financialYearStartMonth); setNumbering(s.numbering); setDefaults(s.defaults); setPrint(s.print); setApproval(s.approval); } }, [s]);
  useEffect(() => { if (rules.data) setCalc(rules.data); }, [rules.data]);
  useEffect(() => { if (policy.data) setRecalc(policy.data); }, [policy.data]);

  const [section, setSection] = useState('');
  const [savedSection, setSavedSection] = useState('');
  const refreshAll = () => { for (const k of ['settings', 'settings-defaults', 'costing-rules', 'recalc-policy']) void qc.invalidateQueries({ queryKey: [k] }); };
  const put = (path: string) => useMutation({
    mutationFn: (v: { section: string; body: Row }) => api(path, { method: 'PUT', json: v.body }),
    onMutate: () => setSavedSection(''), onSuccess: (_r, v) => { setSavedSection(v.section); refreshAll(); },
  });
  const saveApp = put('/settings');
  const saveCalc = put('/costing-settings');
  const saveRecalc = put('/recalculation/policy');
  const run = (key: string, m: { mutate: (v: { section: string; body: Row }) => void }, body: Row) => { setSection(key); m.mutate({ section: key, body }); };
  const flag = (key: string) => savedSection === key;
  const errFor = (key: string, m: { error: unknown }) => (section === key ? m.error : null);

  const preview = (kind: string, n: Row) => <NumberPreview kind={kind} format={n.format} reset={n.reset} fy={fy ?? 4} />;
  const unitOptions = units.data?.items ?? [];

  return (
    <div className="max-w-4xl space-y-5">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <ErrorText error={settings.error} />
      {!canEdit && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">You can view these settings but only administrators can change them.</p>}

      <Card className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-semibold">Company</h2><p className="text-xs text-slate-500">Name, address, GSTIN, currency, logo and footer shown on every printed document.</p></div>
        <Link href="/settings/company"><Button variant="outline">Company details</Button></Link>
      </Card>

      {s && fy !== null && numbering && (
        <Section title="Financial year and document numbers" hint="{YYYY} year · {YY} 2-digit year · {MM} month · {FY} financial year (2026-27) · {SEQ:4} running number (required). Changing a format never repeats a number that is already used."
          canEdit={canEdit} saving={saveApp.isPending} error={errFor('numbering', saveApp)} saved={flag('numbering')} onSave={() => run('numbering', saveApp, { financialYearStartMonth: fy, numbering })}>
          <Field label="Financial year starts in">
            <SelectBox className={sel} value={fy} onChange={(e) => setFy(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</SelectBox>
          </Field>
          {(['costing', 'quotation', 'priceList'] as const).map((k) => (
            <div key={k} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1.2fr]">
              <Field label={`${{ costing: 'Costing', quotation: 'Quotation', priceList: 'Price list' }[k]} number format`}><Input value={numbering[k].format} onChange={(e) => setNumbering({ ...numbering, [k]: { ...numbering[k], format: e.target.value } })} /></Field>
              <Field label="Restart numbering">
                <SelectBox className={sel} value={numbering[k].reset} onChange={(e) => setNumbering({ ...numbering, [k]: { ...numbering[k], reset: e.target.value } })}>
                  <option value="YEARLY">Every calendar year</option><option value="FINANCIAL_YEAR">Every financial year</option><option value="NEVER">Never</option>
                </SelectBox>
              </Field>
              {preview(k, numbering[k])}
            </div>
          ))}
        </Section>
      )}

      {s && defaults && (
        <Section title="Defaults for new documents" hint="Used to pre-fill new costings, templates, quotations and price lists. They can still be changed on each document."
          canEdit={canEdit} saving={saveApp.isPending} error={errFor('defaults', saveApp)} saved={flag('defaults')} onSave={() => run('defaults', saveApp, { defaults })}>
          <div className="grid gap-3 sm:grid-cols-3">
            {([['gstPercent', 'GST %'], ['wastagePercent', 'Wastage %'], ['markupPercent', 'Markup %']] as const).map(([k, l]) => (
              <Field key={k} label={l}><Input inputMode="decimal" value={defaults[k]} onChange={(e) => setDefaults({ ...defaults, [k]: e.target.value })} /></Field>
            ))}
            <Field label="Price list profit method"><SelectBox className={sel} value={defaults.profitMethod} onChange={(e) => setDefaults({ ...defaults, profitMethod: e.target.value })}><option value="PERCENT">Percentage</option><option value="FIXED">Fixed amount</option></SelectBox></Field>
            <Field label="Price list profit (% or amount)"><Input inputMode="decimal" value={defaults.profitValue} onChange={(e) => setDefaults({ ...defaults, profitValue: e.target.value })} /></Field>
            <Field label="Quotation validity (days)"><Input inputMode="numeric" value={defaults.quotationValidityDays} onChange={(e) => setDefaults({ ...defaults, quotationValidityDays: e.target.value })} /></Field>
            <Field label="Default product unit"><SelectBox className={sel} value={defaults.unitId ?? ''} onChange={(e) => setDefaults({ ...defaults, unitId: e.target.value })}><option value="">None</option>{unitOptions.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}</SelectBox></Field>
            <Field label="Default dimension unit"><SelectBox className={sel} value={defaults.dimensionUnitId ?? ''} onChange={(e) => setDefaults({ ...defaults, dimensionUnitId: e.target.value })}><option value="">None</option>{unitOptions.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}</SelectBox></Field>
          </div>
          <Field label="Default quotation terms & conditions"><textarea rows={5} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={defaults.quotationTerms} onChange={(e) => setDefaults({ ...defaults, quotationTerms: e.target.value })} /></Field>
        </Section>
      )}

      {s && print && (
        <Section title="Printing" hint="Starting choices on the print preview pages."
          canEdit={canEdit} saving={saveApp.isPending} error={errFor('print', saveApp)} saved={flag('print')} onSave={() => run('print', saveApp, { print })}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Paper"><SelectBox className={sel} value={print.orientation} onChange={(e) => setPrint({ ...print, orientation: e.target.value })}><option value="portrait">A4 portrait</option><option value="landscape">A4 landscape</option></SelectBox></Field>
            <Field label="Costing layout">
              <SelectBox className={sel} value={print.costingMode} onChange={(e) => setPrint({ ...print, costingMode: e.target.value })}>
                <option value="detailed">Detailed costing sheet</option><option value="summary">Costing summary</option><option value="product">Product costing with image</option><option value="materials">Material details</option><option value="labour">Labour details</option>
              </SelectBox>
            </Field>
          </div>
        </Section>
      )}

      {s && approval && (
        <Section title="Approval workflow" hint="Who has to sign off before a document is final. Approving needs the Approve permission on that module (Roles & Permissions)."
          canEdit={canEdit} saving={saveApp.isPending} error={errFor('approval', saveApp)} saved={flag('approval')} onSave={() => run('approval', saveApp, { approval })}>
          {([['costing', 'Costings'], ['quotation', 'Quotations']] as const).map(([k, l]) => (
            <div key={k} className="space-y-1 rounded-md border border-slate-200 p-3 text-sm">
              <p className="font-medium">{l}</p>
              <label className="flex items-center gap-2"><input type="checkbox" checked={approval[k].required} onChange={(e) => setApproval({ ...approval, [k]: { ...approval[k], required: e.target.checked } })} />
                {k === 'costing' ? 'Costings must be submitted and approved by an approver (otherwise an approver may approve a draft directly)' : 'Quotations must be approved before they can be sent'}</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={approval[k].allowSelfApproval} onChange={(e) => setApproval({ ...approval, [k]: { ...approval[k], allowSelfApproval: e.target.checked } })} />
                Approvers may approve documents they prepared themselves</label>
            </div>
          ))}
        </Section>
      )}

      {calc && (
        <Section title="Calculation rules" hint="How costings are calculated. A costing keeps the rules it was calculated with until it is recalculated; live costings can be updated from the Rate Change Impact screen."
          canEdit={canEdit} saving={saveCalc.isPending} error={errFor('calc', saveCalc)} saved={flag('calc')} onSave={() => run('calc', saveCalc, calc)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Decimal places (0 to 2)"><Input inputMode="numeric" value={calc.decimals} onChange={(e) => setCalc({ ...calc, decimals: e.target.value })} /></Field>
            <Field label="Rounding"><SelectBox className={sel} value={calc.rounding} onChange={(e) => setCalc({ ...calc, rounding: e.target.value })}><option value="HALF_UP">Half up (1.005 → 1.01)</option><option value="HALF_DOWN">Half down</option><option value="UP">Always up</option><option value="DOWN">Always down</option></SelectBox></Field>
            <Field label="GST applied"><SelectBox className={sel} value={calc.gstMode} onChange={(e) => setCalc({ ...calc, gstMode: e.target.value })}><option value="COSTING">One GST % for the costing</option><option value="ITEM">Item GST % on materials</option></SelectBox></Field>
            <Field label="Wastage levels"><SelectBox className={sel} value={calc.wastageMode} onChange={(e) => setCalc({ ...calc, wastageMode: e.target.value })}><option value="MOST_SPECIFIC">Most specific level only (never double counted)</option><option value="CUMULATIVE">Add all levels together</option></SelectBox></Field>
            <Field label="Markup is calculated on"><SelectBox className={sel} value={calc.markupBase} onChange={(e) => setCalc({ ...calc, markupBase: e.target.value })}><option value="TOTAL_COST">Total cost including GST</option><option value="BASIC_COST">Basic cost before GST</option></SelectBox></Field>
            <Field label="Profit % is measured against"><SelectBox className={sel} value={calc.profitBase} onChange={(e) => setCalc({ ...calc, profitBase: e.target.value })}><option value="BASIC_COST">Basic cost</option><option value="TOTAL_COST">Total cost</option></SelectBox></Field>
          </div>
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            {([['roundLines', 'Round every line (not only the totals)'], ['materialRatesIncludeGst', 'Material rates already include GST'], ['labourRatesIncludeGst', 'Labour rates already include GST'], ['expenseRatesIncludeGst', 'Expense amounts already include GST']] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!calc[k]} onChange={(e) => setCalc({ ...calc, [k]: e.target.checked })} />{l}</label>
            ))}
          </div>
        </Section>
      )}

      {recalc && (
        <Section title="Rate update policy" hint="What happens to live costings when a rate, labour rate, expense, GST or conversion changes. Approved costings are never changed."
          canEdit={canEdit} saving={saveRecalc.isPending} error={errFor('recalc', saveRecalc)} saved={flag('recalc')} onSave={() => run('recalc', saveRecalc, { mode: recalc.mode, flagThresholdPercent: recalc.flagThresholdPercent })}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="When something changes"><SelectBox className={sel} value={recalc.mode} onChange={(e) => setRecalc({ ...recalc, mode: e.target.value })}><option value="CONFIRM">Ask an admin to review and confirm</option><option value="AUTO">Recalculate automatically</option><option value="MANUAL">Never queue (refresh by hand)</option></SelectBox></Field>
            <Field label="Flag quotations and price lists for changes of at least (%)"><Input inputMode="decimal" value={recalc.flagThresholdPercent} onChange={(e) => setRecalc({ ...recalc, flagThresholdPercent: e.target.value })} /></Field>
          </div>
          <Link href="/recalculation" className="text-sm underline">Open Rate Change Impact</Link>
        </Section>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-semibold">Users, roles and permissions</h2><p className="text-xs text-slate-500">Who can view, create, edit, delete, approve, export, import, print and manage rates in each module.</p></div>
        <div className="flex gap-2">{can('users:view') && <Link href="/users"><Button variant="outline">Users</Button></Link>}{can('roles:view') && <Link href="/roles"><Button variant="outline">Roles & permissions</Button></Link>}</div>
      </Card>
    </div>
  );
}

function NumberPreview({ kind, format, reset, fy }: { kind: string; format: string; reset: string; fy: number }) {
  const q = useQuery({
    queryKey: ['numbering-preview', kind, format, reset, fy], retry: false,
    queryFn: () => api<{ next: string; examples: string[] }>('/settings/numbering/preview', { method: 'POST', json: { kind, format, reset, financialYearStartMonth: fy } }),
  });
  return (
    <div className="pb-2 text-xs text-slate-600">
      {q.error ? <span className="text-red-600">{(q.error as Error).message}</span> : q.data ? <>Next number: <b>{q.data.next}</b><br />Examples: {q.data.examples.join(', ')}</> : 'Checking…'}
    </div>
  );
}
