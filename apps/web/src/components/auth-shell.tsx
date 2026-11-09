import { Calculator } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/primitives';

/** Shared frame of the sign-in, forgot-password and reset-password screens. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2.5 text-white">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-primary-600"><Calculator size={19} /></span>
          <span className="leading-tight"><span className="block text-base font-semibold">Smart Costing</span><span className="block text-xs text-slate-400">Management System</span></span>
        </div>
        <Card className="space-y-3 p-5">{children}</Card>
      </div>
    </main>
  );
}
