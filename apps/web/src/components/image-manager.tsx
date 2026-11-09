'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Star, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge, Button, Card, ErrorText } from '@/components/ui/primitives';
import { api, fileUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Img { id: string; description: string | null; isMain: boolean; width: number; height: number; size: number; originalName: string; thumbUrl: string; url: string }

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_MB = 8;
const MAX_FILES = 10;
const MAX_TOTAL = 20;

/** Product photos for a costing or template: multi-upload, preview, main image, descriptions, delete. */
export function ImageManager({ ownerPath, editable, title = 'Product images' }: { ownerPath: string; editable: boolean; title?: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Img | null>(null);
  const [drag, setDrag] = useState(false);
  const key = ['images', ownerPath];
  const list = useQuery({ queryKey: key, queryFn: () => api<Img[]>(`${ownerPath}/images`) });
  const set = (data: Img[]) => qc.setQueryData(key, data);

  const upload = useMutation({
    mutationFn: (files: File[]) => { const f = new FormData(); files.forEach((x) => f.append('files', x)); return api<Img[]>(`${ownerPath}/images`, { method: 'POST', body: f }); },
    onSuccess: (d) => { set(d); void qc.invalidateQueries({ queryKey: ['costings'] }); },
  });
  const patch = useMutation({ mutationFn: (v: { id: string; body: object }) => api<Img[]>(`${ownerPath}/images/${v.id}`, { method: 'PATCH', json: v.body }), onSuccess: set });
  const remove = useMutation({ mutationFn: (id: string) => api<Img[]>(`${ownerPath}/images/${id}`, { method: 'DELETE' }), onSuccess: (d) => { set(d); void qc.invalidateQueries({ queryKey: ['costings'] }); } });

  function pick(files: FileList | File[] | null) {
    setClientError(null);
    const chosen = Array.from(files ?? []);
    if (!chosen.length) return;
    const have = list.data?.length ?? 0;
    if (chosen.length > MAX_FILES) return setClientError(`Choose at most ${MAX_FILES} images at a time.`);
    if (have + chosen.length > MAX_TOTAL) return setClientError(`At most ${MAX_TOTAL} images are allowed (${have} already added).`);
    const bad = chosen.find((f) => !ACCEPT.includes(f.type));
    if (bad) return setClientError(`${bad.name}: only JPG, PNG and WEBP images are supported.`);
    const big = chosen.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (big) return setClientError(`${big.name}: larger than ${MAX_MB} MB.`);
    upload.mutate(chosen);
    if (input.current) input.current.value = '';
  }

  const images = list.data ?? [];
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{title} <span className="text-sm font-normal text-slate-500">({images.length})</span></h3>
        {editable && <Button type="button" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}><ImagePlus size={16} className="mr-1" />{upload.isPending ? 'Uploading…' : 'Add images'}</Button>}
      </div>
      <input ref={input} type="file" multiple accept={ACCEPT.join(',')} className="hidden" onChange={(e) => pick(e.target.files)} />
      {editable && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
          className={cn('rounded-md border border-dashed p-3 text-center text-xs text-slate-500', drag ? 'border-primary-600 bg-primary-50' : 'border-slate-300')}
        >
          Drop images here, or use “Add images”. JPG, PNG or WEBP, up to {MAX_MB} MB each. Images are compressed and photo metadata (such as location) is removed.
        </div>
      )}
      <ErrorText error={clientError ? new Error(clientError) : (upload.error ?? patch.error ?? remove.error ?? list.error)} />
      {list.isLoading && <p className="text-sm text-slate-500">Loading images…</p>}
      {!list.isLoading && images.length === 0 && <p className="text-sm text-slate-500">No images yet.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {images.map((im) => (
          <div key={im.id} className="space-y-2 rounded-md border border-slate-200 p-2">
            <button type="button" className="block w-full overflow-hidden rounded bg-slate-100" onClick={() => setPreview(im)} aria-label={`Preview ${im.originalName}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(im.thumbUrl)} alt={im.description ?? im.originalName} loading="lazy" className="mx-auto h-36 w-full object-contain" />
            </button>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span className="truncate" title={im.originalName}>{im.originalName}</span>
              <span>{im.width}×{im.height} · {Math.round(im.size / 1024)} KB</span>
            </div>
            {editable ? (
              <input
                defaultValue={im.description ?? ''} maxLength={200} placeholder="Description (optional)" aria-label="Image description"
                className="h-9 w-full rounded-md border border-slate-300 px-2 text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                onBlur={(e) => { if (e.target.value !== (im.description ?? '')) patch.mutate({ id: im.id, body: { description: e.target.value } }); }}
              />
            ) : (im.description ? <p className="text-sm">{im.description}</p> : null)}
            <div className="flex items-center justify-between">
              {im.isMain ? <Badge tone="green">Main image</Badge> : editable ? <button type="button" className="inline-flex items-center gap-1 text-sm underline" onClick={() => patch.mutate({ id: im.id, body: { isMain: true } })}><Star size={14} />Set as main</button> : <span />}
              {editable && <button type="button" aria-label="Delete image" className="text-slate-500 hover:text-red-600" onClick={() => { if (confirm('Delete this image?')) remove.mutate(im.id); }}><Trash2 size={16} /></button>}
            </div>
          </div>
        ))}
      </div>
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreview(null)}>
          <button type="button" aria-label="Close preview" className="absolute right-4 top-4 text-white" onClick={() => setPreview(null)}><X size={24} /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileUrl(preview.url)} alt={preview.description ?? preview.originalName} className="max-h-full max-w-full rounded bg-white object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </Card>
  );
}
