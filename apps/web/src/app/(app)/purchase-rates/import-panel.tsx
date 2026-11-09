'use client';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorText } from '@/components/ui/primitives';
import { api, downloadFile } from '@/lib/api';

interface Preview {
  fileName: string; total: number; valid: number; invalid: number; duplicates: number;
  rows: { row: number; status: 'ok' | 'error' | 'duplicate'; errors: string[]; data: Record<string, string> }[];
}

export function ImportPanel({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; itemsWithRateChange: number } | null>(null);

  const form = () => { const f = new FormData(); f.append('file', file!); return f; };
  const check = useMutation({ mutationFn: () => api<Preview>('/purchase-rates/excel/preview', { method: 'POST', body: form() }), onSuccess: (p) => { setPreview(p); setResult(null); } });
  const confirm = useMutation({
    mutationFn: (skipInvalid: boolean) => api<NonNullable<typeof result>>(`/purchase-rates/excel/confirm?skipInvalid=${skipInvalid}`, { method: 'POST', body: form() }),
    onSuccess: (r) => { setResult(r); setPreview(null); onDone(); },
  });
  const problems = (preview?.invalid ?? 0) + (preview?.duplicates ?? 0);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Import purchase rates from Excel</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void downloadFile('/purchase-rates/excel/template', 'purchase-rates-template.xlsx')}>Download template</Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
      <input type="file" accept=".xlsx" className="text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); }} />
      <div><Button disabled={!file || check.isPending} onClick={() => check.mutate()}>{check.isPending ? 'Validating…' : 'Validate & preview'}</Button></div>
      <ErrorText error={check.error ?? confirm.error} />
      {result && <p className="text-sm text-green-700">Imported {result.imported} row(s){result.skipped ? `, skipped ${result.skipped}` : ''}; {result.itemsWithRateChange} item rate(s) changed.</p>}
      {preview && (
        <>
          <p className="text-sm">{preview.total} row(s): <b className="text-green-700">{preview.valid} valid</b>, <b className="text-red-700">{preview.invalid} invalid</b>, <b className="text-amber-700">{preview.duplicates} duplicate</b></p>
          <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50"><tr><th className="px-2 py-1">Row</th><th className="px-2 py-1">Item</th><th className="px-2 py-1">Supplier</th><th className="px-2 py-1">Qty</th><th className="px-2 py-1">Rate</th><th className="px-2 py-1">Date</th><th className="px-2 py-1">Result</th></tr></thead>
              <tbody>{preview.rows.map((r) => (
                <tr key={r.row} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1">{r.row}</td><td className="px-2 py-1">{r.data['Item Code']}</td><td className="px-2 py-1">{r.data['Supplier Code']}</td>
                  <td className="px-2 py-1">{r.data.Quantity}</td><td className="px-2 py-1">{r.data.Rate}</td><td className="px-2 py-1">{r.data['Purchase Date']}</td>
                  <td className="px-2 py-1">{r.status === 'ok' ? <Badge tone="green">OK</Badge> : <span className="text-red-700">{r.errors.join('; ')}</span>}</td>
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
