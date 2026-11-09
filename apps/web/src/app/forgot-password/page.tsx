'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorText, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', json: { email: String(new FormData(e.currentTarget).get('email')) } });
      setDone(true);
    } catch (err) { setError(err); }
  }

  return (
    <AuthShell>
        <h1 className="text-xl font-semibold">Forgot password</h1>
        {done ? <p className="text-sm">If the account exists, a reset link has been issued. Ask your administrator if you do not receive it.</p> : (
          <form onSubmit={onSubmit} className="space-y-3">
            <Field label="Email"><Input name="email" type="email" required /></Field>
            <ErrorText error={error} />
            <Button type="submit" className="w-full">Request reset</Button>
          </form>
        )}
        <Link href="/login" className="text-sm text-slate-600 underline">Back to sign in</Link>
      </AuthShell>
  );
}
