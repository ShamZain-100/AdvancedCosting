import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'danger' }) {
  const v = {
    primary: 'bg-primary-600 text-white hover:bg-primary-700',
    outline: 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  }[variant];
  return <button className={cn('inline-flex h-9 items-center justify-center gap-1 rounded-md px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50', v, className)} {...p} />;
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm outline-none placeholder:text-slate-400', className)} {...p} />;
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-0.5 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export type Accent = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'danger';
export const ACCENT_EDGE: Record<Accent, string> = {
  primary: 'border-t-primary-600', secondary: 'border-t-primary-400', info: 'border-t-cyan-600',
  success: 'border-t-green-600', warning: 'border-t-amber-500', danger: 'border-t-red-600',
};
/** Flat icon-chip colours that go with each accent. */
export const ACCENT_CHIP: Record<Accent, string> = {
  primary: 'bg-primary-600 text-white', secondary: 'bg-primary-400 text-white', info: 'bg-cyan-600 text-white',
  success: 'bg-green-600 text-white', warning: 'bg-amber-500 text-white', danger: 'bg-red-600 text-white',
};

/** White surface with a hairline border. `accent` adds a flat coloured top edge (used for summary tiles). */
export const Card = ({ className, accent, ...p }: React.HTMLAttributes<HTMLDivElement> & { accent?: Accent }) => (
  <div className={cn('rounded-lg border border-slate-200 bg-white p-4 shadow-soft', accent && cn('border-t-2', ACCENT_EDGE[accent]), className)} {...p} />
);

export type Tone = 'gray' | 'green' | 'red' | 'blue' | 'amber' | 'purple' | 'teal';
const TONES: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-green-50 text-green-700 ring-green-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-primary-50 text-primary-700 ring-primary-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  purple: 'bg-primary-100 text-primary-800 ring-primary-200',
  teal: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
};

export const Badge = ({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) => (
  <span className={cn('inline-flex items-center rounded-full px-1.5 py-px text-xs font-medium ring-1 ring-inset', TONES[tone])}>{children}</span>
);

export const ErrorText = ({ error }: { error: unknown }) =>
  error ? <p className="text-sm text-red-600">{(error as Error).message}</p> : null;
