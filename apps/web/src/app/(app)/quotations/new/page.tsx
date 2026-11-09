'use client';
import { BLANK_QUOTATION, QuotationEditor } from '@/components/quotation-editor';
import { useDefaults } from '@/lib/use-defaults';

export default function NewQuotationPage() {
  const app = useDefaults();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New Quotation</h1>
      {!app.data && <p className="text-sm text-slate-500">Loading…</p>}
      {app.data && <QuotationEditor initial={{ ...BLANK_QUOTATION, quotationDate: new Date().toISOString().slice(0, 10), validityDays: app.data.defaults.quotationValidityDays, terms: app.data.defaults.quotationTerms }} />}
    </div>
  );
}
