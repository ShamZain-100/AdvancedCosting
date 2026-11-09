'use client';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorText } from '@/components/ui/primitives';
import { api, downloadFile } from '@/lib/api';

export interface ImportPreview {
  fileName: string; total: number; valid: number; invalid: number; duplicates: number; ignoredColumns?: string[];
  rows: { row: number; status: 'ok' | 'error' | 'duplicate'; errors: string[]; data: Record<string, string> }[];
}

/** Upload → validate & preview → confirm. Nothing is saved until the user confirms, and problem rows are never imported silently. */
export function ImportWizard({ label, templatePath, previewPath, confirmPath, templateName, columns, notes, onDone }: {
  label: string; templatePath: string; previewPath: string; confirmPath: string; templateName: string;
  columns?: { header: string; required: boolean; help: string; example: string }[]; notes?: string[]; onDone?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; records?: number } | null>(null);
  const form = () => { const f = new FormData(); f.append('file', file!); return f; };

  const check = useMutation({ mutationFn: () => api<ImportPreview>(previewPath, { method: 'POST', body: form() }), onSuccess: (p) => { setPreview(p); setResult(null); } });
  const confirm = useMutation({
    mutationFn: (skipInvalid: boolean) => api<NonNullable<typeof result>>(`${confirmPath}${confirmPath.includes('?') ? '&' : '?'}skipInvalid=${skipInvalid}`, { method: 'POST', body: form() }),
    onSuccess: (r) => { setResult(r); setPreview(null); setFile(null); onDone?.(); },
  });
  // the server returns the validation summary inside the error when it refuses to import
  const refused = (confirm.error as { message?: string } | null)?.message;
  const problems = (preview?.invalid ?? 0) + (preview?.duplicates ?? 0);
  const cols = preview ? Object.keys(preview.rows[0]?.data ?? {}).slice(0, 6) : [];

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Import {label}</h2>
        <Button type="button" variant="outline" onClick={() => void downloadFile(templatePath, templateName)}>Download template</Button>
      </div>
      {notes && notes.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      {columns && (
        <details className="text-xs text-slate-600"><summary className="cursor-pointer">Columns ({columns.length})</summary>
          <table className="mt-1 w-full text-left"><tbody>{columns.map((c) => <tr key={c.header} className="border-t border-slate-100"><td className="py-0.5 pr-2 font-medium">{c.header}{c.required ? ' *' : ''}</td><td className="py-0.5 pr-2">{c.help}</td><td className="py-0.5 text-slate-400">{c.example}</td></tr>)}</tbody></table>
        </details>
      )}
      <input type="file" accept=".xlsx" className="text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); confirm.reset(); }} />
      <div><Button disabled={!file || check.isPending} onClick={() => check.mutate()}>{check.isPending ? 'Validating…' : 'Validate & preview'}</Button></div>
      <ErrorText error={check.error ?? confirm.error} />
      {refused && /nothing was imported/.test(refused) && <p className="text-xs text-slate-500">Upload the file again after fixing it, or validate it and choose to skip the problem rows.</p>}
      {result && <p className="text-sm text-green-700">Imported {result.records ?? result.imported} record(s){result.skipped ? `; skipped ${result.skipped} row(s) with problems` : ''}.</p>}
      {preview && (
        <>
          <p className="text-sm">{preview.fileName}: {preview.total} row(s) — <b className="text-green-700">{preview.valid} valid</b>, <b className="text-red-700">{preview.invalid} invalid</b>, <b className="text-amber-700">{preview.duplicates} duplicate</b></p>
          {!!preview.ignoredColumns?.length && <p className="text-xs text-slate-500">Ignored columns: {preview.ignoredColumns.join(', ')}</p>}
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50"><tr><th className="px-2 py-1">Row</th>{cols.map((c) => <th key={c} className="p-2">{c}</th>)}<th className="px-2 py-1">Result</th></tr></thead>
              <tbody>{preview.rows.map((r) => (
                <tr key={r.row} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1">{r.row}</td>{cols.map((c) => <td key={c} className="p-2">{r.data[c]}</td>)}
                  <td className="px-2 py-1">{r.status === 'ok' ? <Badge tone="green">OK</Badge> : <span className={r.status === 'duplicate' ? 'text-amber-700' : 'text-red-700'}>{r.errors.join('; ')}</span>}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={problems > 0 || confirm.isPending} onClick={() => confirm.mutate(false)}>Import all {preview.total} rows</Button>
            {problems > 0 && preview.valid > 0 && <Button variant="outline" disabled={confirm.isPending} onClick={() => confirm.mutate(true)}>Import {preview.valid} valid row(s), skip {problems}</Button>}
          </div>
          {problems > 0 && <p className="text-xs text-slate-500">Rows with problems are never imported silently: fix the file, or explicitly skip them.</p>}
        </>
      )}
    </Card>
  );
}
