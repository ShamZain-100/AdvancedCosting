const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let refreshing: Promise<boolean> | null = null;
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) return false;
      accessToken = ((await r.json()) as { accessToken: string }).accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  const res = await fetch(`${BASE}${path}`, {
    ...init, headers, credentials: 'include', body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/login') && (await refreshSession())) {
    return api<T>(path, init, false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ApiError(res.status, msg ?? res.statusText);
  }
  return (await res.json().catch(() => null)) as T;
}

/** Authenticated file download (the access token is in memory, so a plain link cannot be used). */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const go = () => fetch(`${BASE}${path}`, { credentials: 'include', headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {} });
  let res = await go();
  if (res.status === 401 && (await refreshSession())) res = await go();
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.message ?? res.statusText);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

/** Absolute URL for a server-signed file path such as `/files/<id>?v=thumb&exp=…&sig=…` (usable directly in <img src>). */
export const fileUrl = (path: string) => `${BASE}${path}`;
