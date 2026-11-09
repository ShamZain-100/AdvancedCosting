'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push';
import { Badge, Button, Card, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

interface SessionRow { id: string; ip: string | null; userAgent: string | null; lastUsedAt: string; current: boolean }

export default function ProfilePage() {
  const qc = useQueryClient();
  const { me, load } = useAuth();
  const [mismatch, setMismatch] = useState<Error | null>(null);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionRow[]>('/auth/sessions') });
  const save = useMutation({ mutationFn: (v: unknown) => api('/auth/me', { method: 'PATCH', json: v }), onSuccess: () => load() });
  const change = useMutation({ mutationFn: (v: unknown) => api('/auth/change-password', { method: 'POST', json: v }), onSuccess: () => load() });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">My Profile</h1>
      {me?.mustChangePassword && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">You must change your password before continuing.</p>}
      <Card>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); save.mutate({ name: f.get('name'), mobile: f.get('mobile') }); }}>
          <p className="text-sm text-slate-600">{me?.email}</p>
          <Field label="Name"><Input name="name" defaultValue={me?.name} required /></Field>
          <Field label="Mobile"><Input name="mobile" defaultValue={me?.mobile ?? ''} /></Field>
          <ErrorText error={save.error} /><Button type="submit">Save profile</Button>
        </form>
      </Card>
      <Card>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget); setMismatch(null);
          if (f.get('newPassword') !== f.get('confirm')) return setMismatch(new Error('Passwords do not match'));
          change.mutate({ currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') }); e.currentTarget.reset();
        }}>
          <h2 className="font-semibold">Change password</h2>
          <Field label="Current password"><Input name="currentPassword" type="password" required autoComplete="current-password" /></Field>
          <Field label="New password (min 8)"><Input name="newPassword" type="password" minLength={8} required autoComplete="new-password" /></Field>
          <Field label="Confirm new password"><Input name="confirm" type="password" required autoComplete="new-password" /></Field>
          <ErrorText error={mismatch ?? change.error} />{change.isSuccess && <p className="text-sm text-green-700">Password changed.</p>}
          <Button type="submit">Change password</Button>
        </form>
      </Card>
      <Card className="space-y-2">
        <h2 className="font-semibold">Active sessions</h2>
        {sessions.data?.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{s.userAgent ?? 'Unknown device'} · {s.ip} · {new Date(s.lastUsedAt).toLocaleString()}</span>
            {s.current ? <Badge tone="green">This device</Badge> : <Button variant="outline" onClick={() => revoke.mutate(s.id)}>Revoke</Button>}
          </div>
        ))}
      </Card>
      <PushCard />
    </div>
  );
}

const PUSH_TEXT: Record<PushState, string> = {
  on: 'This device shows a notification when a price on your price list changes, even when the app is closed.',
  off: 'Turn on to get a notification on this device when a price on your price list changes.',
  denied: 'Notifications are blocked for this site in the browser settings. Allow them there, then come back.',
  unavailable: 'Push notifications are not set up on the server yet. You still see every message under the bell.',
  unsupported: 'This browser cannot receive push notifications here. On an iPhone, open this site in Safari, choose Share → Add to Home Screen, and open it from there. Push also needs a secure (https) address.',
};

/** Browser / phone notifications for this device (each device is turned on separately). */
function PushCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { void pushState().then(setState).catch(() => setState('unsupported')); }, []);
  const run = async (fn: () => Promise<PushState>) => {
    setBusy(true); setError(null);
    try { setState(await fn()); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Card className="space-y-2">
      <h2 className="font-semibold">Notifications on this device</h2>
      <p className="text-sm text-slate-600">{state ? PUSH_TEXT[state] : 'Checking…'}</p>
      <ErrorText error={error} />
      {state === 'off' && <Button disabled={busy} onClick={() => void run(enablePush)}>Turn on notifications</Button>}
      {state === 'on' && <Button variant="outline" disabled={busy} onClick={() => void run(disablePush)}>Turn off on this device</Button>}
    </Card>
  );
}
