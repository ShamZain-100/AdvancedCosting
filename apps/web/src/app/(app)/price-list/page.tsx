'use client';
import { useCallback, useState } from 'react';
import { DataTable, type Row, type TableColumn } from '@/components/data-table';
import { fileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

/** Published products with one price column per price list dealer this user may see (a dealer sees only their own). */
export default function DealerPriceListPage() {
  const can = useAuth((s) => s.can);
  const [dealers, setDealers] = useState<{ id: string; name: string }[] | null>(null);
  const onData = useCallback((d: Row) => setDealers(d.dealers ?? []), []);

  const cell = (c: TableColumn, r: Row) => {
    if (c.type === 'image') {
      return r.image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={fileUrl(r.image)} alt="" loading="lazy" className="h-10 w-10 rounded object-cover" />
        : <div className="h-10 w-10 rounded bg-slate-100" />;
    }
    return undefined;
  };

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-semibold">Price List</h1>
        <p className="text-sm text-slate-500">
          Selling price of one unit, including GST.{dealers && dealers.length === 1 ? ` Prices for ${dealers[0].name}.` : ''}
          {dealers && dealers.length === 0 && ' Your login is not linked to a price list dealer yet; ask an administrator.'}
        </p>
      </div>
      <DataTable path="/price-list" cell={cell} extra={onData} excel={can('dealer_price_list:export') ? { path: '/price-list/excel', filename: 'price-list.xlsx' } : null} />
    </div>
  );
}
