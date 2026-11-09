'use client';
import { BLANK_PRICE_LIST, PriceListEditor } from '@/components/price-list-editor';
import { useDefaults } from '@/lib/use-defaults';

export default function NewPriceListPage() {
  const app = useDefaults();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New Price List</h1>
      {!app.data && <p className="text-sm text-slate-500">Loading…</p>}
      {app.data && <PriceListEditor initial={{ ...BLANK_PRICE_LIST, effectiveDate: new Date().toISOString().slice(0, 10), defaultProfitMethod: app.data.defaults.profitMethod, defaultProfitValue: app.data.defaults.profitValue }} />}
    </div>
  );
}
