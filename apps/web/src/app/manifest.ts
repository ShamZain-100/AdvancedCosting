import type { MetadataRoute } from 'next';

/** Lets the app be installed on a phone or desktop (needed for push on iPhone: Add to Home Screen). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Smart Costing Management System', short_name: 'Smart Costing', start_url: '/', scope: '/', display: 'standalone',
    background_color: '#F8FAFC', theme_color: '#2952E3',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
