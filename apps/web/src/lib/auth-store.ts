'use client';
import { create } from 'zustand';
import { api, refreshSession, setAccessToken } from './api';

export interface Me {
  id: string; email: string; name: string; mobile: string | null; isSuperAdmin: boolean;
  mustChangePassword: boolean; roles: { id: string; name: string }[]; permissions: string[];
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  load: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (key: string) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  me: null,
  loading: true,
  async load() {
    try {
      if (await refreshSession()) set({ me: await api<Me>('/auth/me') });
    } finally { set({ loading: false }); }
  },
  async login(email, password) {
    const r = await api<{ accessToken: string }>('/auth/login', { method: 'POST', json: { email, password } });
    setAccessToken(r.accessToken);
    set({ me: await api<Me>('/auth/me') });
  },
  async logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    set({ me: null });
  },
  can: (key) => !!get().me?.permissions.includes(key),
}));
