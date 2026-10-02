import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  FileText,
  Headset,
  LayoutGrid,
  LogOut,
  MailWarning,
  Menu,
  MonitorPlay,
  Music,
  Receipt,
  Settings,
  Shield,
  Sparkles,
  Star,
  Tablet,
  UserRound,
  Video,
  WifiOff,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import type { ModuleId, OfflineDeviceDTO, Role } from '@gc/shared';
import { Avatar } from '../../components/Avatar';
import { cx } from '../../components/ui';
import { api, assetUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { LegalAcceptGate } from '../../components/legal/LegalAcceptGate';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  role: Role;
  end?: boolean;
  /** Otras rutas que marcan este ítem como activo. */
  also?: string[];
  /** Se muestra si la organización tiene alguno de estos módulos activos. */
  module?: ModuleId[];
  /** Condición adicional para mostrarlo. */
  when?: boolean;
}

const COLLAPSED_KEY = 'gc.nav.collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function isActive(pathname: string, item: NavItem) {
  const match = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  if (item.end) return pathname === item.to;
  return match(item.to) || (item.also ?? []).some(match);
}

export function AdminLayout() {
  const { me, settings, can, hasModule, logout, impersonate } = useAuth();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const branding = settings.branding;
  const billingSuspended = me?.user.role !== 'superadmin' && me?.tenant?.status === 'suspended' && me.tenant.suspendedReason === 'billing';

  const setCollapsed = (value: boolean) => {
    setCollapsedState(value);
    try {
      localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
    } catch {
      /* sin almacenamiento local */
    }
  };

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Operación',
      items: [
        { to: '/app', label: 'Inicio', icon: <LayoutGrid />, role: 'agent', end: true },
        { to: '/app/atencion', label: 'Atención', icon: <Headset />, role: 'agent' },
        { to: '/app/citas', label: 'Citas', icon: <CalendarClock />, role: 'agent', module: ['appointments'] },
        { to: '/app/monitor', label: 'Monitor en vivo', icon: <Activity />, role: 'manager' },
        { to: '/app/reportes', label: 'Reportes', icon: <BarChart3 />, role: 'manager', also: ['/app/resumen'], module: ['reports'] },
        { to: '/app/encuestas', label: 'Encuestas', icon: <Star />, role: 'manager', module: ['surveys'] },
        { to: '/app/cobros', label: 'Cobros', icon: <CreditCard />, role: 'manager', module: ['payments'] },
        { to: '/app/facturas', label: 'Facturas', icon: <FileText />, role: 'agent', module: ['invoicing'] },
      ],
    },
    {
      title: 'Pantallas y contenido',
      items: [
        { to: '/app/pantallas', label: 'Pantallas', icon: <MonitorPlay />, role: 'manager', also: ['/app/vincular'], module: ['displays'] },
        { to: '/app/kioscos', label: 'Kioscos', icon: <Tablet />, role: 'manager', module: ['kiosks'] },
        { to: '/app/contenido', label: 'Publicidad', icon: <Video />, role: 'manager', also: ['/app/listas'], module: ['advertising'] },
        { to: '/app/sonidos', label: 'Sonidos', icon: <Music />, role: 'manager', module: ['displays'] },
      ],
    },
    {
      title: 'Administración',
      items: [
        { to: '/app/configuracion', label: 'Configuración', icon: <Settings />, role: 'admin', also: ['/app/bienvenida'] },
        { to: '/app/facturacion', label: 'Plan y facturación', icon: <Receipt />, role: 'admin', when: Boolean(me?.billing) },
      ],
    },
  ];

  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => can(i.role) && (!i.module || i.module.some(hasModule)) && i.when !== false) }))
    .filter((g) => g.items.length > 0);

  // En el menú del celular siempre se muestran los textos.
  const renderNav = (compact: boolean) => (
    <nav className={cx('gc-scroll flex-1 overflow-y-auto py-4', compact ? 'space-y-3 px-2' : 'space-y-5 px-3')} aria-label="Menú principal">
      {visibleGroups.map(({ title, items }, index) => {
        return (
          <div key={title}>
            {compact ? (
              index > 0 && <div className="mx-3 mb-3 border-t border-[var(--gc-nav-border)]" aria-hidden />
            ) : (
              <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-[var(--gc-nav-muted)] uppercase">{title}</p>
            )}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={() => setOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      title={compact ? item.label : undefined}
                      className={cx(
                        'relative flex items-center rounded-ui text-sm font-medium transition [&_svg]:size-[18px] [&_svg]:shrink-0',
                        compact ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2',
                        active
                          ? 'bg-[var(--gc-nav-active-bg)] font-semibold text-[var(--gc-nav-active-fg)] before:absolute before:inset-y-1.5 before:w-1 before:rounded-full before:bg-[var(--gc-nav-indicator)]'
                          : 'text-[var(--gc-nav-fg)] opacity-80 hover:bg-[var(--gc-nav-hover)] hover:opacity-100',
                        active && (compact ? 'before:-left-2' : 'before:-left-3'),
                      )}
                    >
                      {item.icon}
                      <span className={compact ? 'sr-only' : 'truncate'}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {can('superadmin') && (
        <div>
          {!compact && <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-[var(--gc-nav-muted)] uppercase">Plataforma</p>}
          <NavLink
            to="/plataforma"
            title={compact ? 'Organizaciones' : undefined}
            className={cx(
              'flex items-center rounded-ui text-sm font-medium text-[var(--gc-nav-fg)] opacity-80 hover:bg-[var(--gc-nav-hover)] hover:opacity-100 [&_svg]:size-[18px]',
              compact ? 'justify-center py-2.5' : 'gap-3 px-3 py-2',
            )}
          >
            <Shield />
            <span className={compact ? 'sr-only' : undefined}>Organizaciones</span>
          </NavLink>
        </div>
      )}
    </nav>
  );

  const sidebar = (compact: boolean) => (
    <aside
      className={cx(
        'flex h-full flex-col border-r border-[var(--gc-nav-border)] bg-[var(--gc-nav-bg)] text-[var(--gc-nav-fg)] transition-[width] duration-200',
        compact ? 'w-[76px]' : 'w-64',
      )}
    >
      <Link to="/app" onClick={() => setOpen(false)} className={cx('flex h-16 shrink-0 items-center gap-3', compact ? 'justify-center px-2' : 'px-5')}>
        {branding.logoUrl && !compact ? (
          <span className="grid h-10 max-w-[150px] place-items-center overflow-hidden">
            <img src={assetUrl(branding.logoUrl)} alt={branding.appName} className="max-h-10 max-w-full object-contain" />
          </span>
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-ui bg-primary text-lg font-bold text-primary-fg shadow-sm">
            {branding.appName.charAt(0).toUpperCase()}
          </span>
        )}
        {!compact && !branding.logoUrl && (
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{branding.appName}</span>
            <span className="block truncate text-xs text-[var(--gc-nav-muted)]">{me?.tenant?.name}</span>
          </span>
        )}
      </Link>
      {renderNav(compact)}
      <div className={cx('shrink-0 border-t border-[var(--gc-nav-border)]', compact ? 'space-y-1 p-2' : 'p-3')}>
        <NavLink
          to="/app/perfil"
          onClick={() => setOpen(false)}
          title={compact ? me?.user.name : undefined}
          className={cx('flex items-center rounded-ui hover:bg-[var(--gc-nav-hover)]', compact ? 'justify-center py-2' : 'gap-3 px-3 py-2')}
        >
          {me ? <Avatar name={me.user.name} url={me.user.avatarUrl} size="sm" /> : <UserRound className="size-4" />}
          {!compact && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{me?.user.name}</span>
              <span className="block truncate text-xs text-[var(--gc-nav-muted)]">{me?.user.email}</span>
            </span>
          )}
        </NavLink>
        <div className={cx('flex', compact ? 'flex-col items-center gap-1' : 'mt-1 items-center gap-1')}>
          <button
            type="button"
            title={compact ? 'Cerrar sesión' : undefined}
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className={cx(
              'flex items-center rounded-ui text-sm text-[var(--gc-nav-muted)] hover:bg-[var(--gc-nav-hover)] hover:text-[var(--gc-nav-fg)]',
              compact ? 'justify-center p-2.5' : 'flex-1 gap-3 px-3 py-2',
            )}
          >
            <LogOut className="size-4" />
            <span className={compact ? 'sr-only' : undefined}>Cerrar sesión</span>
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expandir menú' : 'Achicar menú'}
            title={collapsed ? 'Expandir menú' : 'Achicar menú'}
            className="hidden rounded-ui p-2.5 text-[var(--gc-nav-muted)] hover:bg-[var(--gc-nav-hover)] hover:text-[var(--gc-nav-fg)] lg:block"
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </button>
        </div>
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
    <div className="gc-app flex min-h-screen">
      <LegalAcceptGate />
      <div className="sticky top-0 hidden h-screen shrink-0 lg:block">{sidebar(collapsed)}</div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="gc-slide-in absolute inset-y-0 left-0">{sidebar(false)}</div>
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
              <button type="button" onClick={() => void resendVerification()} className="font-semibold text-primary-text hover:underline">
                Reenviar
              </button>
            )}
          </div>
        )}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--gc-nav-border)] bg-[var(--gc-nav-bg)] px-4 text-[var(--gc-nav-fg)] lg:hidden">
          <button type="button" aria-label="Abrir menú" onClick={() => setOpen(true)} className="rounded-ui p-2 hover:bg-[var(--gc-nav-hover)]">
            <Menu className="size-5" />
          </button>
          <span className="truncate font-semibold">{branding.appName}</span>
        </header>
        <main className="mx-auto w-full max-w-[96rem] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {can('manager') && !billingSuspended && <OfflineDevicesBanner />}
          {/* Suspendida por falta de pago: solo queda disponible «Plan y facturación». */}
          {billingSuspended && pathname !== '/app/facturacion' ? <Navigate to="/app/facturacion" replace /> : <Outlet />}
        </main>
      </div>
    </div>
  );
}

/** Aviso en el panel cuando hay TVs o kioscos desconectados. */
function OfflineDevicesBanner() {
  const { hasModule } = useAuth();
  const enabled = hasModule('displays') || hasModule('kiosks');
  const offline = useQuery({ queryKey: ['devices-offline'], queryFn: () => api.get<OfflineDeviceDTO[]>('/devices/offline'), enabled, refetchInterval: 60_000 });
  const list = offline.data ?? [];
  if (!list.length) return null;
  const names = list.slice(0, 3).map((d) => `${d.kind === 'display' ? 'Pantalla' : 'Kiosco'} «${d.name}» (${d.branch})`).join(', ');
  return (
    <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-ui border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <WifiOff className="size-5 shrink-0 text-amber-600" />
      <p className="min-w-0 flex-1">
        <strong>{list.length === 1 ? 'Un equipo está desconectado' : `${list.length} equipos están desconectados`}:</strong> {names}
        {list.length > 3 ? ` y ${list.length - 3} más` : ''}.
      </p>
      <Link to={list.some((d) => d.kind === 'display') ? '/app/pantallas' : '/app/kioscos'} className="font-semibold text-primary-text hover:underline">
        Ver equipos
      </Link>
    </div>
  );
}
