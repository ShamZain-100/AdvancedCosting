import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Smart Costing Management System',
  appleWebApp: { capable: true, title: 'Smart Costing', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};
export const viewport: Viewport = { themeColor: '#2952E3' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="app-bg min-h-screen text-slate-900"><Providers>{children}</Providers></body>
    </html>
  );
}
