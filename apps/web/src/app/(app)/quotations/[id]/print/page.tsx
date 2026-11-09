'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { QuotationDocument } from '@/components/quotation-document';
import { Orientation, PrintShell, useCompany } from '@/components/print-kit';
import { ErrorText } from '@/components/ui/primitives';
import { api, fileUrl } from '@/lib/api';
import { useDefaults } from '@/lib/use-defaults';

export default function QuotationPrint() {
  const { id } = useParams<{ id: string }>();
  const app = useDefaults();
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [started, setStarted] = useState(false);
  if (app.data && !started) { setStarted(true); setOrientation(app.data.print.orientation); }
  const q = useQuery({ queryKey: ['quotation', id], queryFn: () => api<Record<string, any>>(`/quotations/${id}`) });
  const company = useCompany();
  const d = q.data;
  return (
    <PrintShell orientation={orientation} onOrientation={setOrientation} backHref={`/quotations/${id}`} pdfPath={`/print/quotations/${id}/pdf`} pdfName={`${d?.number ?? 'quotation'}.pdf`}>
      <ErrorText error={q.error} />
      {d && (
        <QuotationDocument
          q={{
            company: company.data, number: d.number, status: d.status, quotationDate: String(d.quotationDate).slice(0, 10), validUntil: String(d.validUntil).slice(0, 10), subject: d.subject, preparedBy: d.preparedBy.name,
            customer: { name: d.customerName, address: d.customerAddress, gstin: d.customerGstin, state: d.customerState },
            items: d.items.map((i: Record<string, any>) => ({ image: i.image ? fileUrl(i.image.url) : null, productName: i.productName, productCode: i.productCode, description: i.description, quantity: i.quantity, unit: i.unitLabel, unitPrice: i.unitPrice, discount: String(Number(i.lineDiscount) + Number(i.headerDiscountShare)), gstPercent: i.gstPercent, gstAmount: i.gstAmount, total: i.lineTotal })),
            totals: { subtotal: d.subtotal, discount: String(Number(d.lineDiscountTotal) + Number(d.headerDiscount)), taxableAmount: d.taxableAmount, gstAmount: d.gstAmount, roundOff: d.roundOff, grandTotal: d.grandTotal },
            gstBreakdown: [], terms: d.terms, notes: d.notes,
          }}
        />
      )}
    </PrintShell>
  );
}
