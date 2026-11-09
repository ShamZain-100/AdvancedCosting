import { api } from './api';

/** Browser push on this device. Needs HTTPS (or localhost); on iPhone the app must first be added to the Home Screen. */
export type PushState = 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

const keyBytes = (base64: string) => {
  const s = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const key = await api<{ enabled: boolean }>('/notifications/push-key').catch(() => ({ enabled: false }));
  if (!key.enabled) return 'unavailable';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await (await registration()).pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Asks the browser for permission (must run from a click) and registers this device with the server. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const key = await api<{ enabled: boolean; publicKey: string | null }>('/notifications/push-key');
  if (!key.enabled || !key.publicKey) return 'unavailable';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.publicKey) }));
  await api('/notifications/subscriptions', { method: 'POST', json: sub.toJSON() });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const sub = await (await registration()).pushManager.getSubscription();
  if (sub) {
    await api('/notifications/subscriptions', { method: 'DELETE', json: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return 'off';
}
