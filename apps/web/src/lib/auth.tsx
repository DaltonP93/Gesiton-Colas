import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  defaultTenantSettings,
  hasRole,
  type MeDTO,
  type Role,
  type TenantSettings,
  type Terminology,
} from '@gc/shared';
import { api, session } from './api';
import { applyBranding } from './theme';

interface AuthState {
  me: MeDTO | null;
  loading: boolean;
  settings: TenantSettings;
  terms: Terminology;
  login(email: string, password: string): Promise<MeDTO>;
  register(data: { organizationName: string; name: string; email: string; password: string }): Promise<MeDTO>;
  logout(): void;
  refresh(): Promise<void>;
  can(role: Role): boolean;
  /** El superadministrador entra a una organización para dar soporte. */
  impersonate(tenantId: string | null): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [me, setMe] = useState<MeDTO | null>(null);
  const [loading, setLoading] = useState(Boolean(session.token));

  const refresh = useCallback(async () => {
    if (!session.token) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api.get<MeDTO>('/auth/me'));
    } catch {
      session.token = null;
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    session.token = null;
    session.tenantOverride = null;
    setMe(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener('gc:unauthorized', onUnauthorized);
    return () => window.removeEventListener('gc:unauthorized', onUnauthorized);
  }, [logout]);

  const settings = me?.tenant?.settings ?? defaultTenantSettings();

  useEffect(() => {
    applyBranding(settings.branding, { title: settings.branding.appName });
  }, [settings.branding]);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      settings,
      terms: settings.terminology,
      async login(email, password) {
        const res = await api.post<MeDTO & { token: string }>('/auth/login', { email, password });
        session.token = res.token;
        session.tenantOverride = null;
        queryClient.clear();
        setMe(res);
        return res;
      },
      async register(data) {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const locale = navigator.language?.slice(0, 2);
        const res = await api.post<MeDTO & { token: string }>('/auth/register', {
          ...data,
          timezone,
          locale: ['es', 'en', 'pt'].includes(locale) ? locale : 'es',
        });
        session.token = res.token;
        queryClient.clear();
        setMe(res);
        return res;
      },
      logout,
      refresh,
      can: (role) => (me ? hasRole(me.user.role, role) : false),
      async impersonate(tenantId) {
        session.tenantOverride = tenantId;
        queryClient.clear();
        await refresh();
      },
    }),
    [me, loading, settings, logout, refresh, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
