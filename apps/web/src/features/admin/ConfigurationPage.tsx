import {
  BellRing,
  Building2,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Globe,
  Hash,
  History,
  LayoutGrid,
  Mail,
  MessageCircle,
  Palette,
  Plug,
  Sparkles,
  TextCursorInput,
  Type,
  Users,
  Wand2,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import type { ModuleId } from '@gc/shared';
import { AuditLog } from '../../components/AuditLog';
import { MailSettingsForm } from '../../components/MailSettingsForm';
import { Button, Loading, PageHeader, cx } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useBranches, useCounters, useServices, useUsers } from '../../lib/queries';
import { BrandTab } from './customization/BrandTab';
import type { TabProps } from './customization/common';
import { CustomerFieldsTab } from './customization/CustomerFieldsTab';
import { RegionTab } from './customization/RegionTab';
import { TerminologyTab } from './customization/TerminologyTab';
import { TicketsTab } from './customization/TicketsTab';

const BranchesPage = lazy(() => import('./BranchesPage'));
const ServicesPage = lazy(() => import('./ServicesPage'));
const UsersPage = lazy(() => import('./UsersPage'));
const IntegrationsPage = lazy(() => import('./IntegrationsPage'));
const NotificationsPage = lazy(() => import('./NotificationsPage'));
const PaymentsSettingsPage = lazy(() => import('./PaymentsSettingsPage'));
const AlertsSettingsPage = lazy(() => import('./AlertsSettingsPage'));

type TabKey = 'marca' | 'region' | 'terminologia' | 'turnos' | 'cliente';
type PageKey = 'sucursales' | 'servicios' | 'alertas' | 'usuarios' | 'actividad' | 'correo' | 'avisos' | 'cobros' | 'integraciones';
export type ConfigSection = 'inicio' | TabKey | PageKey;

interface SectionDef {
  key: ConfigSection;
  label: string;
  /** Nombre corto para la fila de pestañas. */
  short: string;
  description: string;
  icon: ReactNode;
  group: string;
  /** Solo se muestra si la organización tiene el módulo activo. */
  module?: ModuleId;
}

const TAB_COMPONENTS: Record<TabKey, ComponentType<TabProps>> = {
  marca: BrandTab,
  region: RegionTab,
  terminologia: TerminologyTab,
  turnos: TicketsTab,
  cliente: CustomerFieldsTab,
};
const PAGE_COMPONENTS: Record<PageKey, ComponentType> = {
  sucursales: BranchesPage,
  servicios: ServicesPage,
  usuarios: UsersPage,
  actividad: ActivitySection,
  alertas: AlertsSettingsPage,
  correo: MailSection,
  avisos: NotificationsPage,
  cobros: PaymentsSettingsPage,
  integraciones: IntegrationsPage,
};
function ActivitySection() {
  return (
    <div>
      <PageHeader icon={<History />} title="Registro de actividad" description="Quién cambió qué y cuándo: configuración, usuarios, servicios, pantallas, cobros e ingresos al sistema. Se conserva un año." />
      <AuditLog scope="tenant" />
    </div>
  );
}

function MailSection() {
  return (
    <div>
      <PageHeader
        icon={<Mail />}
        title="Correo saliente"
        description="Servidor por el que salen las invitaciones, los códigos de acceso y la recuperación de contraseñas de su organización."
      />
      <MailSettingsForm scope="tenant" />
    </div>
  );
}

const isTab = (key: ConfigSection): key is TabKey => key in TAB_COMPONENTS;
const isPage = (key: ConfigSection): key is PageKey => key in PAGE_COMPONENTS;




export default function ConfigurationPage() {
  const { section = 'inicio' } = useParams();
  const { terms, hasModule } = useAuth();

  const sections: SectionDef[] = useMemo(
    () => (
      [
      { key: 'inicio', label: 'Resumen', short: 'Resumen', description: 'Toda la configuración de un vistazo', icon: <LayoutGrid />, group: '' },
      { key: 'marca', label: 'Marca y apariencia', short: 'Marca', description: 'Logo, colores, tipografía, menú y fondo', icon: <Palette />, group: 'Organización' },
      { key: 'region', label: 'Idioma y zona horaria', short: 'Idioma', description: 'Idioma de pantallas y kioscos, hora local', icon: <Globe />, group: 'Organización' },
      { key: 'terminologia', label: 'Terminología', short: 'Terminología', description: `${terms.ticket}, ${terms.counter.toLowerCase()} y demás palabras`, icon: <Type />, group: 'Organización' },
      { key: 'sucursales', label: `${terms.branches} y ${terms.counters.toLowerCase()}`, short: terms.branches, description: 'Lugares de atención y puestos', icon: <Building2 />, group: 'Atención' },
      { key: 'servicios', label: `${terms.services} y prioridades`, short: terms.services, description: 'Qué se atiende y quién pasa primero', icon: <ClipboardList />, group: 'Atención' },
      { key: 'turnos', label: `Numeración de ${terms.tickets.toLowerCase()}`, short: 'Numeración', description: 'Dígitos, reinicio y rellamados', icon: <Hash />, group: 'Atención' },
      { key: 'cliente', label: `Datos del ${terms.customer.toLowerCase()}`, short: `Datos del ${terms.customer.toLowerCase()}`, description: 'Qué se pide al sacar turno', icon: <TextCursorInput />, group: 'Atención' },
      { key: 'alertas', label: 'Alertas de equipos', short: 'Alertas', description: 'Aviso si una TV o un kiosco se desconecta', icon: <BellRing />, group: 'Atención' },
      { key: 'usuarios', label: 'Usuarios', short: 'Usuarios', description: 'Equipo, roles e invitaciones', icon: <Users />, group: 'Equipo e integraciones' },
      { key: 'actividad', label: 'Registro de actividad', short: 'Actividad', description: 'Quién cambió qué y cuándo', icon: <History />, group: 'Equipo e integraciones' },
      { key: 'correo', label: 'Correo saliente', short: 'Correo', description: 'Servidor SMTP para invitaciones y avisos', icon: <Mail />, group: 'Equipo e integraciones' },
      { key: 'avisos', label: 'Avisos por WhatsApp y SMS', short: 'WhatsApp y SMS', description: 'Mensajes al sacar turno, al acercarse y al llamar', icon: <MessageCircle />, group: 'Equipo e integraciones', module: 'notifications' },
      { key: 'cobros', label: 'Cobros y pagos', short: 'Cobros', description: 'Pasarela (Bancard, PagoPar, Stripe) y cobro en el puesto', icon: <CreditCard />, group: 'Equipo e integraciones', module: 'payments' },
      { key: 'integraciones', label: 'Integraciones y API', short: 'Integraciones', description: 'API keys, webhooks y documentación', icon: <Plug />, group: 'Equipo e integraciones', module: 'integrations' },
      ] as SectionDef[]
    ).filter((s) => !s.module || hasModule(s.module)),
    [terms, hasModule],
  );

  const current = sections.find((s) => s.key === section);

  // Las secciones de personalización quedan montadas al visitarlas para no perder cambios sin guardar.
  const [visited, setVisited] = useState<TabKey[]>([]);
  const [dirty, setDirty] = useState<Partial<Record<TabKey, boolean>>>({});
  useEffect(() => {
    if (current && isTab(current.key) && !visited.includes(current.key)) setVisited((v) => [...v, current.key as TabKey]);
  }, [current, visited]);
  const markDirty = useCallback((key: TabKey, value: boolean) => setDirty((d) => (Boolean(d[key]) === value ? d : { ...d, [key]: value })), []);
  const handlers = useMemo(
    () => Object.fromEntries((Object.keys(TAB_COMPONENTS) as TabKey[]).map((k) => [k, (v: boolean) => markDirty(k, v)])) as Record<TabKey, (v: boolean) => void>,
    [markDirty],
  );
  const anyDirty = Object.values(dirty).some(Boolean);
  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyDirty]);

  if (!current) return <Navigate to="/app/configuracion" replace />;

  const groups = [...new Set(sections.map((s) => s.group))];

  return (
    <div className="grid items-start gap-[var(--gc-gap)] 2xl:grid-cols-[15.5rem_minmax(0,1fr)]">
      {/* Menú de secciones: pestañas en pantallas medianas, lista lateral en pantallas grandes */}
      <aside className="min-w-0 2xl:sticky 2xl:top-8">
        <nav className="gc-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 2xl:hidden" aria-label="Secciones de la configuración">
          {sections.map((s) => {
            const active = s.key === current.key;
            return (
              <Link
                key={s.key}
                to={s.key === 'inicio' ? '/app/configuracion' : `/app/configuracion/${s.key}`}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition [&_svg]:size-4',
                  active ? 'border-primary bg-primary text-primary-fg shadow-sm' : 'border-border bg-surface text-fg/80 hover:bg-subtle hover:text-fg',
                )}
              >
                {s.icon}
                {s.short}
                {isTab(s.key) && dirty[s.key] && <span className="size-1.5 rounded-full bg-accent" aria-label="cambios sin guardar" />}
              </Link>
            );
          })}
          <Link to="/app/bienvenida" className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-primary/50 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-primary-text hover:bg-primary/5">
            <Wand2 className="size-4" /> Asistente
          </Link>
        </nav>
        <p className="mb-3 hidden text-xs font-semibold tracking-wider text-muted uppercase 2xl:block">Configuración</p>
        <nav className="hidden space-y-4 2xl:block" aria-label="Secciones de la configuración (lista)">
          {groups.map((g) => (
            <div key={g || 'inicio'}>
              {g && <p className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-muted uppercase">{g}</p>}
              <ul className="space-y-0.5">
                {sections
                  .filter((s) => s.group === g)
                  .map((s) => {
                    const active = s.key === current.key;
                    return (
                      <li key={s.key}>
                        <Link
                          to={s.key === 'inicio' ? '/app/configuracion' : `/app/configuracion/${s.key}`}
                          aria-current={active ? 'page' : undefined}
                          className={cx(
                            'flex items-center gap-2.5 rounded-ui px-3 py-2 text-sm transition [&_svg]:size-4 [&_svg]:shrink-0',
                            active ? 'bg-primary/10 font-semibold text-primary-text' : 'text-fg/80 hover:bg-subtle hover:text-fg',
                          )}
                        >
                          {s.icon}
                          <span className="min-w-0 flex-1 truncate">{s.label}</span>
                          {isTab(s.key) && dirty[s.key] && (
                            <span className="size-1.5 shrink-0 rounded-full bg-accent" title="Cambios sin guardar">
                              <span className="sr-only">(cambios sin guardar)</span>
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
          <Link
            to="/app/bienvenida"
            className="mt-2 flex items-center gap-2.5 rounded-ui border border-dashed border-primary/40 px-3 py-2.5 text-sm font-medium text-primary-text hover:bg-primary/5"
          >
            <Wand2 className="size-4" /> Asistente de configuración
          </Link>
        </nav>
      </aside>

      {/* Contenido */}
      <div className="min-w-0">
        {current.key === 'inicio' && <Overview sections={sections.filter((s) => s.key !== 'inicio')} />}

        {visited.map((key) => {
          const Component = TAB_COMPONENTS[key];
          const def = sections.find((s) => s.key === key)!;
          return (
            <div key={key} hidden={key !== current.key} role="region" aria-label={def.label}>
              <SectionTitle icon={def.icon} title={def.label} description={def.description} />
              <Component onDirtyChange={handlers[key]} />
            </div>
          );
        })}

        {isPage(current.key) && (
          <Suspense fallback={<Loading />}>
            {(() => {
              const Component = PAGE_COMPONENTS[current.key];
              return <Component />;
            })()}
          </Suspense>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="mb-[var(--gc-gap)] flex items-start gap-4">
      <span className="grid size-12 shrink-0 place-items-center rounded-ui bg-primary/10 text-primary-text [&_svg]:size-6" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <h1 className="text-[1.65rem] leading-tight font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
    </div>
  );
}

/** Resumen: cada sección con su estado actual y acceso directo. */
function Overview({ sections }: { sections: SectionDef[] }) {
  const { me, settings, terms } = useAuth();
  const branches = useBranches();
  const services = useServices();
  const users = useUsers();
  const onboarding = settings.onboarding;
  const localeLabel = { es: 'Español', en: 'English', pt: 'Português' }[settings.locale];
  const counterList = useCounters();
  const counters = counterList.data?.length;

  const summary: Partial<Record<ConfigSection, ReactNode>> = {
    marca: (
      <span className="flex items-center gap-1.5">
        {[settings.branding.primaryColor, settings.branding.accentColor, settings.branding.backgroundColor].map((c) => (
          <span key={c} className="size-3.5 rounded-full ring-1 ring-black/10" style={{ background: c }} />
        ))}
        <span className="ml-1 truncate">{settings.branding.fontFamily}</span>
      </span>
    ),
    region: `${localeLabel} · ${settings.timezone}`,
    terminologia: `${terms.ticket} / ${terms.counter}`,
    sucursales: branches.data ? `${branches.data.length} ${branches.data.length === 1 ? terms.branch.toLowerCase() : terms.branches.toLowerCase()}${counters !== undefined ? ` · ${counters} ${terms.counters.toLowerCase()}` : ''}` : '…',
    servicios: services.data ? `${services.data.filter((s) => s.active).length} activos` : '…',
    turnos: `${settings.tickets.digits} dígitos · ${settings.tickets.reset === 'daily' ? 'reinicio diario' : 'sin reinicio'}`,
    cliente: settings.customerFields.length ? `${settings.customerFields.length} campos propios` : 'Nombre, documento, teléfono y email',
    usuarios: users.data ? `${users.data.length} ${users.data.length === 1 ? 'usuario' : 'usuarios'}` : '…',
    actividad: 'Cambios e ingresos del último año',
    alertas: settings.alerts.devices.enabled ? `A los ${settings.alerts.devices.minutes} min sin conexión` : 'Desactivadas',
    correo: 'Invitaciones, códigos de acceso y recuperación',
    cobros: `Moneda ${settings.payments.currency}${settings.payments.online ? ' · pago en línea' : ''}`,
    avisos: Object.values(settings.notifications.events).filter((e) => e.enabled).length + ' avisos activos',
    integraciones: 'API REST, webhooks y tiempo real',
  };

  return (
    <div className="space-y-[var(--gc-gap)]">
      <div>
        <h1 className="text-[1.65rem] leading-tight font-bold tracking-tight">Configuración</h1>
        <p className="mt-1 text-sm text-muted">Todo lo de {me?.tenant?.name} en un solo lugar. Elija una sección para cambiarla.</p>
      </div>

      <Link
        to="/app/bienvenida"
        className={cx(
          'gc-card group flex flex-wrap items-center gap-4 p-5 transition hover:-translate-y-0.5',
          !onboarding.completed && 'ring-2 ring-primary/30',
        )}
        style={!onboarding.completed ? { background: 'linear-gradient(120deg, color-mix(in srgb, var(--gc-primary) 12%, var(--gc-surface)), var(--gc-surface) 70%)' } : undefined}
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-ui bg-primary text-primary-fg shadow-sm">
          <Sparkles className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{onboarding.completed ? 'Asistente de configuración' : 'Configure su sistema en 5 pasos'}</span>
          <span className="block text-sm text-muted">
            {onboarding.completed
              ? 'Vuelva a recorrer la configuración guiada cuando quiera: rubro, marca, sucursal, servicios y pantallas.'
              : 'Le guiamos paso a paso: su rubro, la marca, la sucursal y los puestos, los servicios y cómo se ven la TV y el kiosco.'}
          </span>
        </span>
        <Button size="sm" variant={onboarding.completed ? 'secondary' : 'primary'} icon={<Wand2 className="size-4" />} tabIndex={-1}>
          {onboarding.completed ? 'Abrir asistente' : 'Empezar'}
        </Button>
      </Link>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((s) => (
          <Link key={s.key} to={`/app/configuracion/${s.key}`} className="gc-card group flex items-start gap-3 p-4 transition hover:-translate-y-0.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-ui bg-primary/10 text-primary-text [&_svg]:size-5">{s.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 leading-snug font-semibold group-hover:text-primary-text">{s.label}</span>
                <ChevronRight className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5" />
              </span>
              <span className="block text-xs text-muted">{s.description}</span>
              <span className="mt-2 block truncate text-xs font-medium text-fg/80">{summary[s.key]}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
