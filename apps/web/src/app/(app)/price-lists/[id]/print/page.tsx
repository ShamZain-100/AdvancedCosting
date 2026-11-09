'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CompanyHeader, Orientation, PrintShell, money, useCompany } from '@/components/print-kit';
import { ErrorText } from '@/components/ui/primitives';
import { api, fileUrl } from '@/lib/api';
import { useDefaults } from '@/lib/use-defaults';

export default function PriceListPrint() {
  const { id } = useParams<{ id: string }>();
  const app = useDefaults();
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [started, setStarted] = useState(false);
  if (app.data && !started) { setStarted(true); setOrientation(app.data.print.orientation); }
  const q = useQuery({ queryKey: ['price-list', id], queryFn: () => api<Record<string, any>>(`/price-lists/${id}`) });
  const company = useCompany();
  const l = q.data;
  const excl = l?.gstTreatment === 'EXCLUSIVE';
  return (
    <PrintShell orientation={orientation} onOrientation={setOrientation} backHref={`/price-lists/${id}`} pdfPath={`/print/price-lists/${id}/pdf`} pdfName={`${l?.number ?? 'price-list'}.pdf`}>
      <ErrorText error={q.error} />
      {l && (
        <article className="space-y-3 text-sm">
          <CompanyHeader company={company.data} />
          <header>
            <h1 className="text-xl font-semibold">{l.name}</h1>
            <p className="text-slate-600">{l.number} · effective {String(l.effectiveDate).slice(0, 10)} · prices {l.gstTreatment === 'NONE' ? 'have no GST' : excl ? 'exclude GST (GST extra)' : 'include GST'}</p>
          </header>
          <table className="w-full border-collapse text-left">
            <thead><tr className="border-b-2 border-slate-800"><th className="py-1 pr-2">SL</th><th className="py-1 pr-2" /><th className="py-1 pr-2">Code</th><th className="py-1 pr-2">Product</th><th className="py-1 pr-2 text-right">List price</th><th className="py-1 pr-2 text-right">Discount</th>{excl && <th className="py-1 pr-2 text-right">GST</th>}<th className="py-1 text-right">{excl ? 'Price incl. GST' : 'Selling price'}</th></tr></thead>
            <tbody>
              {l.items.map((i: Record<string, any>, n: number) => (
                <tr key={i.id} className="border-b border-slate-200">
                  <td className="py-1 pr-2">{n + 1}</td>
                  <td className="py-1 pr-2">{i.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={fileUrl(i.image.thumbUrl)} alt="" className="h-12 w-12 object-contain" /> : null}</td>
                  <td className="py-1 pr-2">{i.productCode ?? ''}</td><td className="py-1 pr-2">{i.productName}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{money(i.sellingPrice)}</td><td className="py-1 pr-2 text-right tabular-nums">{Number(i.discountApplied) ? money(i.discountApplied) : '—'}</td>
                  {excl && <td className="py-1 pr-2 text-right tabular-nums">{money(i.gstAmount)}</td>}
                  <td className="py-1 text-right font-medium tabular-nums">{money(excl ? i.effectiveInclGst : i.effectivePrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {l.notes && <p className="text-slate-600">{l.notes}</p>}
        </article>
      )}
    </PrintShell>
  );
}
