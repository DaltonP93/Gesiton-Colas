import { ChevronDown, LogOut, Shield, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar } from '../../components/Avatar';
import { Menu } from '../../components/ui';
import { assetUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';

/** Encabezado, aviso de modo soporte y contenedor de las páginas de la plataforma. */
export function PlatformShell({ children }: { children: ReactNode }) {
  const { me, logout, impersonate, platformBrand } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[112rem] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link to="/plataforma" className="flex min-w-0 items-center gap-3">
            {platformBrand.logoUrl ? (
              <img src={assetUrl(platformBrand.logoUrl)} alt="" className="h-9 max-w-32 shrink-0 object-contain" />
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded-ui bg-primary text-primary-fg">
                <Shield className="size-5" />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{platformBrand.appName}</span>
              <span className="block truncate text-xs text-muted">Plataforma</span>
            </span>
          </Link>
          {me && (
            <div className="ml-auto">
              <Menu
                label="Mi cuenta"
                header={
                  <>
                    <p className="truncate text-sm font-semibold">{me.user.name}</p>
                    <p className="truncate text-xs text-muted">{me.user.email}</p>
                  </>
                }
                trigger={(props) => (
                  <button type="button" {...props} className="flex max-w-72 items-center gap-2.5 rounded-full py-1 pr-2 pl-1 hover:bg-subtle sm:rounded-ui sm:pr-3">
                    <Avatar name={me.user.name} url={me.user.avatarUrl} size="sm" />
                    <span className="hidden min-w-0 text-left sm:block">
                      <span className="block truncate text-sm font-medium">{me.user.name}</span>
                      <span className="block truncate text-xs text-muted">{me.user.email}</span>
                    </span>
                    <ChevronDown className="size-4 shrink-0 text-muted" />
                    <span className="sr-only">Mi cuenta</span>
                  </button>
                )}
                items={[
                  { label: 'Mi perfil', icon: <UserRound />, onSelect: () => navigate('/plataforma/perfil') },
                  {
                    label: 'Cerrar sesión',
                    icon: <LogOut />,
                    onSelect: () => {
                      logout();
                      navigate('/login');
                    },
                  },
                ]}
              />
            </div>
          )}
        </div>
      </header>

      {me?.tenant && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-accent px-4 py-2 text-sm font-medium text-accent-fg">
          Modo soporte activo en «{me.tenant.name}».
          <button type="button" className="rounded-ui bg-black/15 px-2 py-0.5 hover:bg-black/25" onClick={() => navigate('/app')}>
            Volver a la organización
          </button>
          <button type="button" className="rounded-ui bg-black/15 px-2 py-0.5 hover:bg-black/25" onClick={() => void impersonate(null)}>
            Salir del modo soporte
          </button>
        </div>
      )}

      <main className="mx-auto w-full max-w-[112rem] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
