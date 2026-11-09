'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';

function Form() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('newPassword') !== f.get('confirm')) return setError(new Error('Passwords do not match'));
    setError(null);
    try { await api('/auth/reset-password', { method: 'POST', json: { token, newPassword: String(f.get('newPassword')) } }); setDone(true); }
    catch (err) { setError(err); }
  }

  return done ? <p className="text-sm">Password updated. <Link className="underline" href="/login">Sign in</Link></p> : (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="New password (min 8 characters)"><Input name="newPassword" type="password" minLength={8} required autoComplete="new-password" /></Field>
      <Field label="Confirm password"><Input name="confirm" type="password" required autoComplete="new-password" /></Field>
      <ErrorText error={error} />
      <Button type="submit" className="w-full" disabled={!token}>Reset password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
        <h1 className="text-xl font-semibold">Reset password</h1>
        <Suspense><Form /></Suspense>
      </AuthShell>
  );
}
