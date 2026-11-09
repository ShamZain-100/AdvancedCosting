'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CompanyHeader, Orientation, PrintShell, money, num } from '@/components/print-kit';
import { ErrorText } from '@/components/ui/primitives';
import { api, fileUrl } from '@/lib/api';
import { useDefaults } from '@/lib/use-defaults';
import { SelectBox } from '@/components/ui/select-box';

type M = Record<string, any>;
const MODES = [
  ['detailed', 'Detailed costing sheet'], ['summary', 'Costing summary'], ['product', 'Product costing with image'], ['materials', 'Material details'], ['labour', 'Labour details'],
] as const;

const th = 'border-b border-slate-800 px-1 py-1 text-left font-semibold';
const td = 'border-b border-slate-200 px-1 py-1 align-top';

export default function CostingPrintPage() {
  const { id } = useParams<{ id: string }>();
  const app = useDefaults();
  const [mode, setMode] = useState<(typeof MODES)[number][0]>('detailed');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [started, setStarted] = useState(false);
  // start from the configured layout and paper, then let the user change them freely
  if (app.data && !started) { setStarted(true); setMode(app.data.print.costingMode); setOrientation(app.data.print.orientation); }
  const q = useQuery({ queryKey: ['print-costing', id], queryFn: () => api<M>(`/print/costings/${id}`) });
  const m = q.data;
  const s = m?.summary;

  const summaryBlock = s && (
    <div className="ml-auto w-full max-w-xs space-y-0.5 text-sm">
      {([['Material cost', s.materialCost], ['  of which wastage', s.materialWastage], ['Labour cost', s.labourCost], ['Other expenses', s.expenseCost]] as const).map(([k, v]) => <Row key={k} k={k} v={money(v)} />)}
      {Number(s.companyExpenseCost) > 0 && <Row k="  of which company expenses" v={money(s.companyExpenseCost)} />}
      <Row k="Basic cost (before GST)" v={money(s.basicCost)} strong />
      <Row k={`GST ${num(s.gstPercent)}%`} v={money(s.gstAmount)} />
      <Row k="Total cost incl. GST" v={money(s.totalCostInclGst)} strong />
      {Number(s.extraAmount) > 0 && <Row k={`Extra ${num(s.extraPercent)}%`} v={money(s.extraAmount)} />}
      <Row k={`Markup ${num(s.markupPercent)}%`} v={money(s.markupAmount)} />
      <Row k="Selling price" v={money(s.sellingPrice)} strong />
      <Row k="Profit" v={`${money(s.profitAmount)} (${num(s.profitPercent)}%)`} />
      <Row k="Net basic rate / unit" v={money(s.netBasicRate)} />
      <Row k="Net selling price / unit" v={money(s.netSellingPrice)} />
    </div>
  );

  const product = m && (
    <section className="flex items-start gap-3 py-2 text-sm">
      <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-0.5">
        {([['Product', m.product.name], ['Code', m.product.code], ['Type', m.product.type], ['Quantity', `${num(m.product.quantity)} ${m.product.unit}`],
          ['Dimensions (LxWxH)', m.product.length || m.product.width || m.product.height ? `${num(m.product.length)} x ${num(m.product.width)} x ${num(m.product.height)} ${m.product.dimensionUnit}` : '-'], ['Template', m.doc.template ?? '-']] as const).map(([k, v]) => (
          <p key={k}><span className="text-slate-500">{k}: </span><b>{v || '-'}</b></p>
        ))}
        {m.product.description && <p className="col-span-2 text-slate-600">{m.product.description}</p>}
      </div>
      {m.image && /* eslint-disable-next-line @next/next/no-img-element */ <img src={fileUrl(mode === 'product' ? m.image.url : m.image.thumbUrl)} alt={m.product.name} className={`rounded border border-slate-200 object-contain ${mode === 'product' ? 'h-64 w-64' : 'h-24 w-24'}`} />}
    </section>
  );

  return (
    <PrintShell
      orientation={orientation} onOrientation={setOrientation} backHref={`/costings/${id}`}
      pdfPath={`/print/costings/${id}/pdf?mode=${mode}`} pdfName={`${m?.doc.number ?? 'costing'}-${mode}.pdf`}
      extra={<label className="text-sm">Layout <SelectBox className="ml-2 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectBox></label>}
    >
      <ErrorText error={q.error} />
      {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {m && (
        <article className="space-y-3 text-xs">
          <CompanyHeader company={m.company} />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h1 className="text-lg font-semibold">{MODES.find(([k]) => k === mode)![1]}</h1>
            <div className="text-right text-xs">
              <p>Costing no. <b>{m.doc.number}</b> · {m.doc.date}</p>
              <p>Status <b>{String(m.doc.status).replace('_', ' ').toLowerCase()}</b>{m.doc.approvedAt ? ` (${m.doc.approvedAt})` : ''} · v{m.doc.version} · {m.doc.pricingMode === 'LIVE' ? 'live rates' : 'frozen rates'}</p>
              <p>Prepared by <b>{m.doc.preparedBy}</b></p>
            </div>
          </div>
          {product}

          {mode === 'detailed' && m.groups.map((g: M) => (
            <section key={g.name} className="space-y-1 break-inside-avoid">
              <h2 className="text-sm font-semibold">{g.name}{g.wastagePercent !== null ? <span className="font-normal text-slate-500"> (wastage {num(g.wastagePercent)}%)</span> : null}</h2>
              {g.materials.length > 0 && (
                <table className="w-full border-collapse">
                  <thead><tr><th className={th}>SL</th><th className={th}>Category</th><th className={th}>Item</th><th className={th}>Notes</th><th className={`${th} text-right`}>Qty</th><th className={th}>Unit</th><th className={`${th} text-right`}>Waste</th><th className={`${th} text-right`}>Rate</th><th className={`${th} text-right`}>Total</th></tr></thead>
                  <tbody>{g.materials.map((x: M) => <tr key={x.sl}><td className={td}>{x.sl}</td><td className={td}>{x.category}</td><td className={td}>{x.item}</td><td className={td}>{x.notes}</td><td className={`${td} text-right`}>{num(x.qty)}</td><td className={td}>{x.unit}</td><td className={`${td} text-right`}>{x.wastage ? num(x.wastage) : ''}</td><td className={`${td} text-right`}>{money(x.rate)}</td><td className={`${td} text-right`}>{money(x.total)}</td></tr>)}
                    <tr><td colSpan={8} className="px-1 py-1 text-right font-semibold">Material</td><td className="px-1 py-1 text-right font-semibold">{money(g.materialTotal)}</td></tr></tbody>
                </table>
              )}
              {g.labour.length > 0 && (
                <table className="w-full border-collapse">
                  <thead><tr><th className={th}>Labour</th><th className={`${th} text-right`}>Qty</th><th className={th}>Unit</th><th className={`${th} text-right`}>Rate</th><th className={`${th} text-right`}>Total</th></tr></thead>
                  <tbody>{g.labour.map((x: M, i: number) => <tr key={i}><td className={td}>{x.labour}</td><td className={`${td} text-right`}>{num(x.qty)}</td><td className={td}>{x.unit}</td><td className={`${td} text-right`}>{money(x.rate)}</td><td className={`${td} text-right`}>{money(x.total)}</td></tr>)}
                    <tr><td colSpan={4} className="px-1 py-1 text-right font-semibold">Labour</td><td className="px-1 py-1 text-right font-semibold">{money(g.labourTotal)}</td></tr></tbody>
                </table>
              )}
            </section>
          ))}
          {mode === 'detailed' && m.expenses.length > 0 && (
            <section className="space-y-1"><h2 className="text-sm font-semibold">Other expenses</h2>
              <table className="w-full border-collapse"><thead><tr><th className={th}>Expense</th><th className={th}>Applies to</th><th className={th}>Method</th><th className={`${th} text-right`}>Value</th><th className={th}>Timing</th><th className={`${th} text-right`}>Amount</th></tr></thead>
                <tbody>{m.expenses.map((e: M, i: number) => <tr key={i}><td className={td}>{e.name}</td><td className={td}>{e.scope}</td><td className={td}>{e.method}</td><td className={`${td} text-right`}>{num(e.value)}</td><td className={td}>{e.timing}</td><td className={`${td} text-right`}>{money(e.amount)}</td></tr>)}</tbody></table>
            </section>
          )}
          {mode === 'summary' && (
            <table className="w-full border-collapse"><thead><tr><th className={th}>Group</th><th className={`${th} text-right`}>Material</th><th className={`${th} text-right`}>Labour</th><th className={`${th} text-right`}>Total</th></tr></thead>
              <tbody>{m.groups.map((g: M) => <tr key={g.name}><td className={td}>{g.name}</td><td className={`${td} text-right`}>{money(g.materialTotal)}</td><td className={`${td} text-right`}>{money(g.labourTotal)}</td><td className={`${td} text-right`}>{money(Number(g.materialTotal) + Number(g.labourTotal))}</td></tr>)}</tbody></table>
          )}
          {mode === 'materials' && (
            <table className="w-full border-collapse"><thead><tr><th className={th}>SL</th><th className={th}>Group</th><th className={th}>Category</th><th className={th}>Code</th><th className={th}>Item</th><th className={`${th} text-right`}>Qty</th><th className={th}>Unit</th><th className={`${th} text-right`}>Waste</th><th className={`${th} text-right`}>Eff. qty</th><th className={`${th} text-right`}>Rate</th><th className={`${th} text-right`}>Total</th></tr></thead>
              <tbody>{m.groups.flatMap((g: M) => g.materials.map((x: M) => <tr key={x.sl}><td className={td}>{x.sl}</td><td className={td}>{g.name}</td><td className={td}>{x.category}</td><td className={td}>{x.code}</td><td className={td}>{x.item}</td><td className={`${td} text-right`}>{num(x.qty)}</td><td className={td}>{x.unit}</td><td className={`${td} text-right`}>{x.wastage ? num(x.wastage) : ''}</td><td className={`${td} text-right`}>{num(x.effectiveQty)}</td><td className={`${td} text-right`}>{money(x.rate)}</td><td className={`${td} text-right`}>{money(x.total)}</td></tr>))}
                <tr><td colSpan={10} className="px-1 py-1 text-right font-semibold">Total material</td><td className="px-1 py-1 text-right font-semibold">{money(s.materialCost)}</td></tr></tbody></table>
          )}
          {mode === 'labour' && (
            <table className="w-full border-collapse"><thead><tr><th className={th}>Group</th><th className={th}>Labour</th><th className={`${th} text-right`}>Qty</th><th className={th}>Unit</th><th className={`${th} text-right`}>Rate</th><th className={`${th} text-right`}>Total</th></tr></thead>
              <tbody>{m.groups.flatMap((g: M) => g.labour.map((x: M, i: number) => <tr key={`${g.name}${i}`}><td className={td}>{g.name}</td><td className={td}>{x.labour}</td><td className={`${td} text-right`}>{num(x.qty)}</td><td className={td}>{x.unit}</td><td className={`${td} text-right`}>{money(x.rate)}</td><td className={`${td} text-right`}>{money(x.total)}</td></tr>))}
                <tr><td colSpan={5} className="px-1 py-1 text-right font-semibold">Total labour</td><td className="px-1 py-1 text-right font-semibold">{money(s.labourCost)}</td></tr></tbody></table>
          )}
          {['detailed', 'summary', 'product'].includes(mode) && summaryBlock}
          {mode === 'materials' && <p className="text-right text-sm">Wastage included: <b>{money(s.materialWastage)}</b></p>}
          <footer className="border-t border-slate-200 pt-1 text-[10px] text-slate-500">{[m.company?.footerNote, `Printed ${new Date().toISOString().slice(0, 10)}`].filter(Boolean).join(' | ')}</footer>
        </article>
      )}
    </PrintShell>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className={`flex justify-between gap-2 ${strong ? 'border-t border-slate-800 pt-0.5 font-semibold' : ''}`}><span>{k}</span><span className="tabular-nums">{v}</span></div>;
}
