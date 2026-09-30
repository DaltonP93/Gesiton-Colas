import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  defaultPlatformSettings,
  defaultTenantSettings,
  hasRole,
  type MeDTO,
  type PlatformBrand,
  type Role,
  type TenantSettings,
  type Terminology,
} from '@gc/shared';
import { api, session } from './api';
import { usePublicConfig } from './queries';
import { applyBranding } from './theme';

interface AuthState {
  me: MeDTO | null;
  loading: boolean;
  settings: TenantSettings;
  terms: Terminology;
  /** Marca de la plataforma (pantalla de ingreso, página principal y panel del superadministrador). */
  platformBrand: PlatformBrand;
  login(email: string, password: string): Promise<MeDTO>;
  /** Devuelve `null` si hay que confirmar el correo antes de ingresar. */
  register(data: { organizationName: string; name: string; email: string; password: string }): Promise<MeDTO | null>;
  logout(): void;
  refresh(): Promise<void>;
  /** Guarda la sesión devuelta por los flujos de acceso por correo (verificación, enlace, invitación...). */
  acceptSession(res: MeDTO & { token: string }): MeDTO;
  can(role: Role): boolean;
  /** El superadministrador entra a una organización para dar soporte. */
  impersonate(tenantId: string | null): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const DEFAULT_PLATFORM_BRAND = defaultPlatformSettings().brand;

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

  const { data: publicConfig } = usePublicConfig();
  const platformBrand = publicConfig?.brand ?? DEFAULT_PLATFORM_BRAND;
  // Sin organización (ingreso, página principal, plataforma) se usa la marca de la plataforma.
  const settings = useMemo(() => {
    if (me?.tenant) return me.tenant.settings;
    const base = defaultTenantSettings();
    return {
      ...base,
      branding: {
        ...base.branding,
        appName: platformBrand.appName,
        logoUrl: platformBrand.logoUrl,
        faviconUrl: platformBrand.faviconUrl,
        primaryColor: platformBrand.primaryColor,
      },
    };
  }, [me?.tenant, platformBrand]);

  useEffect(() => {
    applyBranding(settings.branding, { title: settings.branding.appName });
  }, [settings.branding]);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      settings,
      terms: settings.terminology,
      platformBrand,
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
        const res = await api.post<(MeDTO & { token: string }) | { verificationRequired: true; email: string }>('/auth/register', {
          ...data,
          timezone,
          locale: ['es', 'en', 'pt'].includes(locale) ? locale : 'es',
        });
        if ('verificationRequired' in res) return null;
        session.token = res.token;
        queryClient.clear();
        setMe(res);
        return res;
      },
      logout,
      refresh,
      acceptSession(res) {
        session.token = res.token;
        session.tenantOverride = null;
        queryClient.clear();
        setMe(res);
        return res;
      },
      can: (role) => (me ? hasRole(me.user.role, role) : false),
      async impersonate(tenantId) {
        session.tenantOverride = tenantId;
        queryClient.clear();
        await refresh();
      },
    }),
    [me, loading, settings, platformBrand, logout, refresh, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
