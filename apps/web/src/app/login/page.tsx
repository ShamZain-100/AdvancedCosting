'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorText, Field, Input } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth-store';

export default function LoginPage() {
  const router = useRouter();
  const login = useAuth((s) => s.login);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await login(String(f.get('email')), String(f.get('password')));
      router.replace(useAuth.getState().me?.mustChangePassword ? '/profile' : '/');
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <AuthShell>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Email"><Input name="email" type="email" required autoComplete="username" /></Field>
          <Field label="Password"><Input name="password" type="password" required autoComplete="current-password" /></Field>
          <ErrorText error={error} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        </form>
        <Link href="/forgot-password" className="text-sm text-slate-600 underline">Forgot password?</Link>
      </AuthShell>
  );
}
