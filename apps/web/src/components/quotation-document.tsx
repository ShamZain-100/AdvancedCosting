import { CompanyHeader, type Company } from '@/components/print-kit';

const money = (v: unknown) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface QuotationDoc {
  number: string; status: string; quotationDate: string; validUntil: string; subject?: string | null; preparedBy?: string;
  customer: { name: string; address?: string | null; gstin?: string | null; state?: string | null };
  items: { image?: string | null; productName: string; productCode?: string | null; description?: string | null; quantity: string; unit?: string | null; unitPrice: string; discount: string; gstPercent: string; gstAmount: string; total: string }[];
  totals: { subtotal: string; discount: string; taxableAmount: string; gstAmount: string; roundOff: string; grandTotal: string };
  gstBreakdown: { percent: string; taxable: string; gst: string }[];
  terms?: string | null; notes?: string | null;
  company?: Company;
}

/** Customer-facing quotation (used by the print view and the public share page). Server-calculated figures only. */
export function QuotationDocument({ q }: { q: QuotationDoc }) {
  return (
    <article className="space-y-4 bg-white text-sm">
      <CompanyHeader company={q.company} />
      <header className="flex flex-wrap items-start justify-between gap-2 border-b-2 border-slate-800 pb-2">
        <div><h1 className="text-xl font-semibold">Quotation</h1><p className="text-slate-600">{q.number}{q.status === 'EXPIRED' ? ' · EXPIRED' : ''}</p></div>
        <div className="text-right"><p>Date: {q.quotationDate}</p><p>Valid until: {q.validUntil}</p></div>
      </header>
      <section>
        <p className="text-xs uppercase text-slate-500">Quotation for</p>
        <p className="font-medium">{q.customer.name}</p>
        {q.customer.address && <p>{q.customer.address}</p>}
        {(q.customer.gstin || q.customer.state) && <p>{[q.customer.gstin && `GSTIN ${q.customer.gstin}`, q.customer.state].filter(Boolean).join(' · ')}</p>}
        {q.subject && <p className="mt-1 font-medium">Subject: {q.subject}</p>}
      </section>
      <table className="w-full border-collapse text-left">
        <thead><tr className="border-b border-slate-800"><th className="py-1 pr-2">SL</th><th className="py-1 pr-2" /><th className="py-1 pr-2">Product</th><th className="py-1 pr-2 text-right">Qty</th><th className="py-1 pr-2 text-right">Unit price</th><th className="py-1 pr-2 text-right">Discount</th><th className="py-1 pr-2 text-right">GST</th><th className="py-1 text-right">Total</th></tr></thead>
        <tbody>
          {q.items.map((i, n) => (
            <tr key={n} className="border-b border-slate-200 align-top">
              <td className="py-1 pr-2">{n + 1}</td>
              <td className="py-1 pr-2">{i.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={i.image} alt="" className="h-14 w-14 object-contain" /> : null}</td>
              <td className="py-1 pr-2">{i.productName}{i.productCode ? <span className="text-slate-500"> ({i.productCode})</span> : null}{i.description && <span className="block text-xs text-slate-500">{i.description}</span>}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{Number(i.quantity)} {i.unit ?? ''}</td><td className="py-1 pr-2 text-right tabular-nums">{money(i.unitPrice)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{Number(i.discount) ? money(i.discount) : '—'}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{money(i.gstAmount)} <span className="text-xs text-slate-500">({Number(i.gstPercent)}%)</span></td>
              <td className="py-1 text-right font-medium tabular-nums">{money(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto w-full max-w-xs space-y-1">
        {([['Subtotal', q.totals.subtotal], ['Discount', q.totals.discount], ['Taxable amount', q.totals.taxableAmount], ['GST', q.totals.gstAmount]] as const).filter(([k, v]) => k !== 'Discount' || Number(v)).map(([k, v]) => (
          <div key={k} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{money(v)}</span></div>
        ))}
        {Number(q.totals.roundOff) !== 0 && <div className="flex justify-between"><span>Round off</span><span className="tabular-nums">{money(q.totals.roundOff)}</span></div>}
        <div className="flex justify-between border-t border-slate-800 pt-1 text-base font-semibold"><span>Grand total</span><span className="tabular-nums">{money(q.totals.grandTotal)}</span></div>
        {q.gstBreakdown.length > 0 && <div className="pt-1 text-xs text-slate-500">{q.gstBreakdown.map((b) => <div key={b.percent}>GST {Number(b.percent)}% on {money(b.taxable)} = {money(b.gst)}</div>)}</div>}
      </div>
      {q.terms && <section><h2 className="font-semibold">Terms & conditions</h2><p className="whitespace-pre-line text-slate-700">{q.terms}</p></section>}
      {q.notes && <section><h2 className="font-semibold">Notes</h2><p className="whitespace-pre-line text-slate-700">{q.notes}</p></section>}
      {q.preparedBy && <p className="text-xs text-slate-500">Prepared by {q.preparedBy}</p>}
    </article>
  );
}
