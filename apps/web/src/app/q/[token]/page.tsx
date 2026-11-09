'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { QuotationDocument, type QuotationDoc } from '@/components/quotation-document';
import { fileUrl } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/** Public, read-only quotation for a customer with a share link. No login, no internal data. */
export default function PublicQuotation() {
  const { token } = useParams<{ token: string }>();
  const q = useQuery({
    queryKey: ['public-quotation', token], retry: false,
    queryFn: async () => {
      const res = await fetch(`${BASE}/public/quotations/${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error(res.status === 404 ? 'This link is invalid or has expired.' : 'Could not load the quotation.');
      const doc = (await res.json()) as QuotationDoc;
      return { ...doc, items: doc.items.map((i) => ({ ...i, image: i.image ? fileUrl(i.image) : null })) };
    },
  });
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-8">
      {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {q.error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{(q.error as Error).message}</p>}
      {q.data && (
        <>
          <button onClick={() => window.print()} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm print:hidden">Print / Save as PDF</button>
          <QuotationDocument q={q.data} />
        </>
      )}
    </main>
  );
}
