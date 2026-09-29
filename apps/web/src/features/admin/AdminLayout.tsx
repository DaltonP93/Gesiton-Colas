import {
  Activity,
  BarChart3,
  Building2,
  ClipboardList,
  Headset,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  ListVideo,
  Music,
  LogOut,
  MailWarning,
  Menu,
  MonitorPlay,
  Palette,
  Plug,
  Shield,
  Sparkles,
  Tablet,
  UserRound,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import type { Role } from '@gc/shared';
import { cx } from '../../components/ui';
import { api, assetUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  role: Role;
  end?: boolean;
}

export function AdminLayout() {
  const { me, settings, terms, can, logout, impersonate } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const branding = settings.branding;

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Operación',
      items: [
        { to: '/app', label: 'Portal', icon: <LayoutGrid />, role: 'agent', end: true },
        { to: '/app/atencion', label: 'Atención', icon: <Headset />, role: 'agent' },
        { to: '/app/resumen', label: 'Resumen del día', icon: <LayoutDashboard />, role: 'manager' },
        { to: '/app/monitor', label: 'Monitor en vivo', icon: <Activity />, role: 'manager' },
        { to: '/app/reportes', label: 'Reportes', icon: <BarChart3 />, role: 'manager' },
      ],
    },
    {
      title: 'Pantallas y publicidad',
      items: [
        { to: '/app/pantallas', label: 'Pantallas', icon: <MonitorPlay />, role: 'manager' },
        { to: '/app/kioscos', label: 'Kioscos', icon: <Tablet />, role: 'manager' },
        { to: '/app/contenido', label: 'Biblioteca de medios', icon: <Video />, role: 'manager' },
        { to: '/app/listas', label: 'Listas de reproducción', icon: <ListVideo />, role: 'manager' },
        { to: '/app/sonidos', label: 'Sonidos de llamado', icon: <Music />, role: 'manager' },
        { to: '/app/vincular', label: 'Vincular dispositivo', icon: <Link2 />, role: 'manager' },
      ],
    },
    {
      title: 'Configuración',
      items: [
        { to: '/app/sucursales', label: terms.branches, icon: <Building2 />, role: 'admin' },
        { to: '/app/servicios', label: `${terms.services} y prioridades`, icon: <ClipboardList />, role: 'admin' },
        { to: '/app/usuarios', label: 'Usuarios', icon: <Users />, role: 'admin' },
        { to: '/app/personalizacion', label: 'Personalización', icon: <Palette />, role: 'admin' },
        { to: '/app/integraciones', label: 'Integraciones y API', icon: <Plug />, role: 'admin' },
      ],
    },
  ];

  const nav = (
    <nav className="gc-scroll flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {groups.map((group) => {
        const items = group.items.filter((i) => can(i.role));
        if (items.length === 0) return null;
        return (
          <div key={group.title}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-muted uppercase">{group.title}</p>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-3 rounded-ui px-3 py-2 text-sm font-medium transition [&_svg]:size-[18px]',
                        isActive ? 'bg-primary text-primary-fg shadow-sm' : 'text-fg/80 hover:bg-subtle hover:text-fg',
                      )
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {can('superadmin') && (
        <div>
          <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-muted uppercase">Plataforma</p>
          <NavLink to="/plataforma" className="flex items-center gap-3 rounded-ui px-3 py-2 text-sm font-medium text-fg/80 hover:bg-subtle [&_svg]:size-[18px]">
            <Shield /> Organizaciones
          </NavLink>
        </div>
      )}
    </nav>
  );

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center gap-3 border-b border-border px-5">
        {branding.logoUrl ? (
          <img src={assetUrl(branding.logoUrl)} alt="" className="h-9 max-w-[140px] object-contain" />
        ) : (
          <div className="grid size-9 place-items-center rounded-ui bg-primary text-lg font-bold text-primary-fg">{branding.appName.charAt(0)}</div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{branding.appName}</p>
          <p className="truncate text-xs text-muted">{me?.tenant?.name}</p>
        </div>
      </div>
      {nav}
      <div className="border-t border-border p-3">
        <NavLink to="/app/perfil" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-ui px-3 py-2 hover:bg-subtle">
          <div className="grid size-8 place-items-center rounded-full bg-subtle text-muted">
            <UserRound className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me?.user.name}</p>
            <p className="truncate text-xs text-muted">{me?.user.email}</p>
          </div>
        </NavLink>
        <button
          type="button"
          onClick={() => {
            logout();
            navigate('/login');
          }}
          className="mt-1 flex w-full items-center gap-3 rounded-ui px-3 py-2 text-sm text-muted hover:bg-subtle hover:text-fg"
        >
          <LogOut className="size-4" /> Cerrar sesión
        </button>
      </div>
    </aside>
  );

  const impersonating = me?.user.role === 'superadmin' && me.tenant;
  const demoDaysLeft = me?.tenant?.isDemo && me.tenant.demoExpiresAt ? Math.max(0, Math.ceil((new Date(me.tenant.demoExpiresAt).getTime() - Date.now()) / 86_400_000)) : null;
  const [verifySent, setVerifySent] = useState(false);
  const resendVerification = async () => {
    try {
      await api.post('/auth/me/resend-verification');
      setVerifySent(true);
    } catch {
      setVerifySent(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="sticky top-0 hidden h-screen lg:block">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="gc-slide-in absolute inset-y-0 left-0">{sidebar}</div>
          <button type="button" aria-label="Cerrar menú" onClick={() => setOpen(false)} className="absolute top-4 left-[16.5rem] rounded-full bg-surface p-2 shadow">
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {impersonating && (
          <div className="flex flex-wrap items-center justify-center gap-3 bg-accent px-4 py-2 text-sm font-medium text-accent-fg">
            Modo soporte: está operando dentro de «{me.tenant!.name}».
            <button
              type="button"
              className="rounded-ui bg-black/15 px-2 py-0.5 hover:bg-black/25"
              onClick={async () => {
                await impersonate(null);
                navigate('/plataforma');
              }}
            >
              Salir
            </button>
          </div>
        )}
        {demoDaysLeft !== null && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-2 text-center text-sm text-primary-fg">
            <Sparkles className="size-4" />
            <span>
              Está usando una <strong>demo</strong>: {demoDaysLeft === 0 ? 'vence hoy' : `quedan ${demoDaysLeft} día${demoDaysLeft === 1 ? '' : 's'}`}. Puede probar todo con los datos de ejemplo.
            </span>
            {!me?.user.hasPassword && (
              <NavLink to="/app/perfil" className="rounded-ui bg-white/15 px-2 py-0.5 font-medium hover:bg-white/25">
                Definir contraseña
              </NavLink>
            )}
          </div>
        )}
        {me && !me.user.emailVerified && !impersonating && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm">
            <MailWarning className="size-4 text-amber-600" />
            <span>
              Confirme su correo <strong>{me.user.email}</strong> con el enlace que le enviamos.
            </span>
            {verifySent ? (
              <span className="font-medium text-emerald-700">Correo reenviado</span>
            ) : (
              <button type="button" onClick={() => void resendVerification()} className="font-semibold text-primary hover:underline">
                Reenviar
              </button>
            )}
          </div>
        )}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur lg:hidden">
          <button type="button" aria-label="Abrir menú" onClick={() => setOpen(true)} className="rounded-ui p-2 hover:bg-subtle">
            <Menu className="size-5" />
          </button>
          <span className="truncate font-semibold">{branding.appName}</span>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
