'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Note { id: string; title: string; body: string; url: string | null; readAt: string | null; createdAt: string }

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString('en-IN');
};

/** The bell in the header: unread count, latest messages, mark as read. Checks for new ones every minute. */
export function NotificationBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: Note[]; unread: number }>('/notifications?pageSize=15'), refetchInterval: 60_000, refetchOnWindowFocus: true });
  const done = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: done });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: done });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative" ref={box}>
      <button type="button" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-slate-600 hover:bg-slate-100 hover:text-primary-700">
        <Bell size={18} />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-30 mt-1 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center border-b border-slate-200 px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && <button type="button" className="ml-auto text-xs text-primary-700 hover:underline" onClick={() => readAll.mutate()}>Mark all read</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {q.data?.items.map((n) => (
              <li key={n.id}>
                <button type="button" className={cn('block w-full px-3 py-2 text-left hover:bg-slate-50', !n.readAt && 'bg-primary-50')}
                  onClick={() => { if (!n.readAt) read.mutate(n.id); setOpen(false); if (n.url) router.push(n.url); }}>
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body && <span className="block text-xs text-slate-600">{n.body}</span>}
                  <span className="block text-[11px] text-slate-400">{ago(n.createdAt)}</span>
                </button>
              </li>
            ))}
            {q.data?.items.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">No notifications yet.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
