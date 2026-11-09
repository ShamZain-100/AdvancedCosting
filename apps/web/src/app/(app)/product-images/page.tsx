'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ImageManager } from '@/components/image-manager';
import { Badge, Button, Card, ErrorText, Input } from '@/components/ui/primitives';
import { SelectBox } from '@/components/ui/select-box';
import { api, fileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

interface Product { id: string; costingNumber: string; productName: string; productCode: string | null; status: string; imageCount: number; image: { thumbUrl: string } | null }

/** The designer's screen: products and their photos only, never a cost. */
export default function ProductImagesPage() {
  const can = useAuth((s) => s.can);
  const [search, setSearch] = useState('');
  const [photos, setPhotos] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Product | null>(null);
  const q = useQuery({
    queryKey: ['product-images', search, photos, page],
    queryFn: () => api<{ items: Product[]; total: number; pageSize: number }>(`/product-images?page=${page}&search=${encodeURIComponent(search)}${photos ? `&photos=${photos}` : ''}`),
    placeholderData: keepPreviousData,
  });
  const canUpload = can('images:create') || can('costing:edit');
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-semibold">Product Photos</h1>
        <p className="text-sm text-slate-500">Add or change photos of costing products. Photos never change any price.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-64" placeholder="Search product, code or costing no…" aria-label="Search products" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <SelectBox aria-label="Photos" className="min-w-40" value={photos} onChange={(e) => { setPhotos(e.target.value); setPage(1); }}>
          <option value="">All products</option><option value="none">Without photos</option>
        </SelectBox>
      </div>
      <ErrorText error={q.error} />
      {open && (
        <Card className="space-y-2">
          <div className="flex items-center gap-2"><h2 className="font-semibold">{open.productName}</h2><span className="text-xs text-slate-500">{open.costingNumber}</span><Button variant="outline" className="ml-auto h-8" onClick={() => { setOpen(null); void q.refetch(); }}>Done</Button></div>
          <ImageManager ownerPath={`/costings/${open.id}`} editable={canUpload} title="Product photos" />
        </Card>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {q.data?.items.map((p) => (
          <button key={p.id} type="button" onClick={() => setOpen(p)} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-left hover:border-primary-400">
            {p.image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={fileUrl(p.image.thumbUrl)} alt="" loading="lazy" className="h-14 w-14 rounded object-cover" />
              : <div className="flex h-14 w-14 items-center justify-center rounded bg-slate-100 text-xs text-slate-400">No photo</div>}
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{p.productName}</span>
              <span className="block text-xs text-slate-500">{p.productCode ?? p.costingNumber}</span>
              <span className="mt-0.5 flex items-center gap-1"><Badge tone={p.status === 'APPROVED' ? 'green' : 'gray'}>{p.status.replace('_', ' ').toLowerCase()}</Badge><span className="text-xs text-slate-500">{p.imageCount} photo{p.imageCount === 1 ? '' : 's'}</span></span>
            </span>
          </button>
        ))}
      </div>
      {q.data?.items.length === 0 && <p className="text-sm text-slate-500">No products found.</p>}
      <div className="flex items-center gap-2 text-sm">
        <Button variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>Previous</Button>
        <span>Page {page} of {pages}</span>
        <Button variant="outline" className="h-8" disabled={page >= pages} onClick={() => setPage((x) => x + 1)}>Next</Button>
      </div>
    </div>
  );
}
