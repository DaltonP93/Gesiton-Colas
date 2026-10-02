import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Blocks, Building2, CalendarPlus, DatabaseBackup, FileText, HardDrive, History, LogIn, Megaphone, MonitorPlay, PauseCircle, PlayCircle, Plus, Receipt, Scale, Search, Settings2, ShieldCheck, Ticket, UserCog, Users } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { MODULES, PLAN_IDS, PLANS, type InviteResultDTO, type ModuleId, type PlanId, type PlatformSettings, type TenantDTO } from '@gc/shared';
import { AuditLog } from '../../components/AuditLog';
import { InviteResultModal } from '../../components/InviteResult';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Loading,
  Menu,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Stat,
  Table,
  Tabs,
  Toggle,
  cx,
  useFeedback,
} from '../../components/ui';
import { AdminsTab } from './AdminsTab';
import { BackupsTab } from './BackupsTab';
import { BillingTab } from './BillingTab';
import { SifenTab } from './SifenTab';
import { LegalTab } from './LegalTab';
import { CommsTab } from './CommsTab';
import { PlatformSettingsTab } from './PlatformSettingsTab';
import { PlatformShell } from './PlatformShell';
import { TenantModulesModal } from './TenantModulesModal';
import { TenantUsersModal } from './TenantUsersModal';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDateTime } from '../../lib/format';

interface PlatformStats {
  tenants: number;
  activeTenants: number;
  users: number;
  tickets30d: number;
  displays: number;
  storageBytes: number;
}

type PlatformTenant = TenantDTO & {
  /** Módulos activos (plan + ajustes). */
  modules: ModuleId[];
  storageBytes: number;
  usage: { users: number; branches: number; displays: number; tickets30d: number };
};

type TenantPatch = { id: string; name?: string; plan?: PlanId; status?: TenantDTO['status']; isDemo?: boolean; extendDemoDays?: number };

type PlatformTab = 'organizaciones' | 'facturacion' | 'sifen' | 'comunicaciones' | 'legal' | 'actividad' | 'administradores' | 'copias' | 'ajustes';
const PLATFORM_TABS: PlatformTab[] = ['organizaciones', 'facturacion', 'sifen', 'comunicaciones', 'legal', 'actividad', 'administradores', 'copias', 'ajustes'];

const PLAN_COLORS: Record<PlanId, string> = {
  free: '#64748b',
  pro: '#2563eb',
  enterprise: '#7c3aed',
};

const num = (n: number) => n.toLocaleString('es');

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function PlatformPage() {
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<PlatformTab>(() => {
    const hash = window.location.hash.slice(1) as PlatformTab;
    return PLATFORM_TABS.includes(hash) ? hash : 'organizaciones';
  });
  // Los enlaces internos (#comunicaciones, #legal) cambian de pestaña.
  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.slice(1) as PlatformTab;
      if (PLATFORM_TABS.includes(hash)) setTab(hash);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const changeTab = (next: PlatformTab) => {
    setTab(next);
    window.history.replaceState(null, '', next === 'organizaciones' ? window.location.pathname : `#${next}`);
  };

  const titles: Record<PlatformTab, { title: string; description: string }> = {
    organizaciones: { title: 'Organizaciones', description: 'Administre las organizaciones (clientes) de la plataforma: planes, estado, usuarios y soporte.' },
    facturacion: { title: 'Facturación', description: 'Facturas de los planes a las organizaciones, cobros, vencimientos y la pasarela con la que pagan.' },
    sifen: { title: 'Factura electrónica', description: 'Facturas electrónicas SIFEN de los planes a las organizaciones: emisor de la plataforma, timbrado, certificado y documentos enviados a la SET.' },
    comunicaciones: { title: 'Comunicaciones', description: 'Correo y WhatsApp/SMS de la plataforma, los avisos que envía (facturas, vencimientos, suspensiones, demos, términos, alertas) y por qué canal, y los canales de cada organización.' },
    legal: { title: 'Legal', description: 'Titular del software, términos del servicio, política de privacidad, tratamiento de datos, aceptaciones y contrato de licencia.' },
    actividad: { title: 'Actividad', description: 'Registro de auditoría de toda la plataforma: cambios de cada organización, acciones del soporte y de los superadministradores.' },
    administradores: { title: 'Superadministradores', description: 'Personas con acceso total a la plataforma: todas las organizaciones, planes y ajustes.' },
    copias: { title: 'Copias de seguridad', description: 'Copia diaria automática de la base de datos y los archivos, en el servidor y en destinos externos: S3 y compatibles, SFTP o WebDAV.' },
    ajustes: { title: 'Ajustes de la plataforma', description: 'Qué se ve en la dirección principal, quién puede registrarse, los planes y la marca del ingreso.' },
  };

  return (
    <PlatformShell>
        <PageHeader
          title={titles[tab].title}
          description={titles[tab].description}
          actions={
            tab === 'organizaciones' ? (
              <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Nueva organización
              </Button>
            ) : undefined
          }
        />
        <div className="mb-6">
          <Tabs<PlatformTab>
            value={tab}
            onChange={changeTab}
            tabs={[
              { value: 'organizaciones', label: 'Organizaciones', icon: <Building2 className="size-4" /> },
              { value: 'facturacion', label: 'Facturación', icon: <Receipt className="size-4" /> },
              { value: 'sifen', label: 'SIFEN', icon: <FileText className="size-4" /> },
              { value: 'comunicaciones', label: 'Comunicaciones', icon: <Megaphone className="size-4" /> },
              { value: 'legal', label: 'Legal', icon: <Scale className="size-4" /> },
              { value: 'actividad', label: 'Actividad', icon: <History className="size-4" /> },
              { value: 'administradores', label: 'Superadministradores', icon: <UserCog className="size-4" /> },
              { value: 'copias', label: 'Copias', icon: <DatabaseBackup className="size-4" /> },
              { value: 'ajustes', label: 'Ajustes', icon: <Settings2 className="size-4" /> },
            ]}
          />
        </div>
        {tab === 'organizaciones' && (
          <>
            <StatsGrid />
            <TenantsCard onCreate={() => setCreating(true)} />
          </>
        )}
        {tab === 'facturacion' && <BillingTab />}
        {tab === 'sifen' && <SifenTab />}
        {tab === 'comunicaciones' && <CommsTab />}
        {tab === 'legal' && <LegalTab />}
        {tab === 'actividad' && <AuditLog scope="platform" />}
        {tab === 'administradores' && <AdminsTab />}
        {tab === 'copias' && <BackupsTab />}
        {tab === 'ajustes' && <PlatformSettingsTab />}
      {creating && <CreateTenantModal onClose={() => setCreating(false)} />}
    </PlatformShell>
  );
}

/* ------------------------------------------------------------------ */
/* Estadísticas                                                        */
/* ------------------------------------------------------------------ */

function StatsGrid() {
  const stats = useQuery({ queryKey: ['platform', 'stats'], queryFn: () => api.get<PlatformStats>('/platform/stats') });

  if (stats.isLoading) return <Loading />;
  if (stats.isError || !stats.data) {
    return (
      <div className="mb-6">
        <EmptyState title="No se pudieron cargar las estadísticas" description={errorMessage(stats.error)} action={<Button onClick={() => stats.refetch()}>Reintentar</Button>} />
      </div>
    );
  }
  const s = stats.data;
  const tiles: { label: string; value: ReactNode; hint?: string; icon: ReactNode; tone?: string }[] = [
    { label: 'Organizaciones', value: num(s.tenants), hint: `${num(s.activeTenants)} activas`, icon: <Building2 /> },
    { label: 'Activas', value: num(s.activeTenants), hint: `${num(s.tenants - s.activeTenants)} suspendidas`, icon: <ShieldCheck />, tone: '#16a34a' },
    { label: 'Usuarios', value: num(s.users), icon: <Users />, tone: '#0891b2' },
    { label: 'Turnos (30 días)', value: num(s.tickets30d), icon: <Ticket />, tone: '#7c3aed' },
    { label: 'Pantallas', value: num(s.displays), icon: <MonitorPlay />, tone: '#d97706' },
    { label: 'Almacenamiento', value: formatBytes(s.storageBytes), icon: <HardDrive />, tone: '#64748b' },
  ];
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t) => (
        <Stat key={t.label} label={t.label} value={t.value} hint={t.hint} icon={t.icon} tone={t.tone} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Organizaciones                                                      */
/* ------------------------------------------------------------------ */

type TenantFilter = 'all' | 'active' | 'demo' | 'suspended';

function TenantsCard({ onCreate }: { onCreate: () => void }) {
  const { impersonate } = useAuth();
  const { toast, confirm } = useFeedback();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TenantFilter>('all');
  const q = useDebounced(search.trim());
  const [entering, setEntering] = useState<string | null>(null);
  const [viewingUsers, setViewingUsers] = useState<PlatformTenant | null>(null);
  const [editingModules, setEditingModules] = useState<PlatformTenant | null>(null);
  const platformSettings = useQuery({ queryKey: ['platform', 'settings'], queryFn: () => api.get<PlatformSettings>('/platform/settings') });

  const tenants = useQuery({
    queryKey: ['platform', 'tenants', q],
    queryFn: () => api.get<PlatformTenant[]>(`/platform/tenants${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: keepPreviousData,
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: TenantPatch) => api.put<TenantDTO>(`/platform/tenants/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });
  const pendingId = update.isPending ? update.variables?.id : undefined;

  async function changePlan(tenant: PlatformTenant, plan: PlanId) {
    if (plan === tenant.plan) return;
    try {
      await update.mutateAsync({ id: tenant.id, plan });
      toast(`«${tenant.name}» ahora tiene el plan ${PLANS[plan].name}.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function toggleStatus(tenant: PlatformTenant) {
    const suspend = tenant.status === 'active';
    const ok = await confirm(
      suspend
        ? {
            title: `¿Suspender «${tenant.name}»?`,
            message: 'Sus usuarios no podrán iniciar sesión y las pantallas y kioscos dejarán de funcionar hasta que la reactive.',
            confirmLabel: 'Suspender',
            danger: true,
          }
        : {
            title: `¿Reactivar «${tenant.name}»?`,
            message: 'Sus usuarios, pantallas y kioscos volverán a funcionar de inmediato.',
            confirmLabel: 'Reactivar',
          },
    );
    if (!ok) return;
    try {
      await update.mutateAsync({ id: tenant.id, status: suspend ? 'suspended' : 'active' });
      toast(suspend ? `Se suspendió «${tenant.name}».` : `Se reactivó «${tenant.name}».`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function demoAction(tenant: PlatformTenant, action: 'extend' | 'convert') {
    try {
      await update.mutateAsync(action === 'extend' ? { id: tenant.id, extendDemoDays: 14 } : { id: tenant.id, isDemo: false });
      toast(action === 'extend' ? `Se extendió la demo de «${tenant.name}» 14 días.` : `«${tenant.name}» ahora es una organización definitiva.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function enter(tenant: PlatformTenant) {
    setEntering(tenant.id);
    try {
      await impersonate(tenant.id);
      navigate('/app');
    } catch (err) {
      toast(errorMessage(err), 'error');
      setEntering(null);
    }
  }

  const list = tenants.data ?? [];
  const isDemoActive = (t: PlatformTenant) => t.isDemo;
  const filters: { value: TenantFilter; label: string; count: number }[] = [
    { value: 'all', label: 'Todas', count: list.length },
    { value: 'active', label: 'Activas', count: list.filter((t) => t.status === 'active' && !t.isDemo).length },
    { value: 'demo', label: 'Demos', count: list.filter(isDemoActive).length },
    { value: 'suspended', label: 'Suspendidas', count: list.filter((t) => t.status === 'suspended').length },
  ];
  const shown = list.filter((t) =>
    filter === 'all' ? true : filter === 'active' ? t.status === 'active' && !t.isDemo : filter === 'demo' ? t.isDemo : t.status === 'suspended',
  );

  return (
    <Card
      padded={false}
      title="Todas las organizaciones"
      description={tenants.data ? `${num(shown.length)} ${shown.length === 1 ? 'resultado' : 'resultados'}` : undefined}
      actions={
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por estado">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cx(
                'rounded-full border px-3 py-1 text-sm transition',
                filter === f.value ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-muted hover:text-fg',
              )}
            >
              {f.label} <span className="tabular-nums opacity-75">{f.count}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input
            type="search"
            aria-label="Buscar organizaciones"
            placeholder="Buscar por nombre o identificador…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
          {tenants.isFetching && !tenants.isLoading && <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2" />}
        </div>
        </div>
      }
    >
      {tenants.isLoading ? (
        <Loading />
      ) : tenants.isError ? (
        <div className="p-5">
          <EmptyState title="No se pudieron cargar las organizaciones" description={errorMessage(tenants.error)} action={<Button onClick={() => tenants.refetch()}>Reintentar</Button>} />
        </div>
      ) : shown.length === 0 && list.length > 0 ? (
        <div className="p-5">
          <EmptyState icon={<Building2 />} title="Ninguna organización con ese estado" action={<Button variant="secondary" onClick={() => setFilter('all')}>Ver todas</Button>} />
        </div>
      ) : list.length === 0 ? (
        <div className="p-5">
          {q ? (
            <EmptyState icon={<Search />} title={`Sin resultados para «${q}»`} description="Pruebe con otro nombre o identificador." action={<Button variant="secondary" onClick={() => setSearch('')}>Limpiar búsqueda</Button>} />
          ) : (
            <EmptyState
              icon={<Building2 />}
              title="Aún no hay organizaciones"
              description="Cree la primera organización con su administrador."
              action={
                <Button icon={<Plus className="size-4" />} onClick={onCreate}>
                  Nueva organización
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((tenant) => {
            const busy = pendingId === tenant.id;
            const expired = Boolean(tenant.isDemo && tenant.demoExpiresAt && new Date(tenant.demoExpiresAt) < new Date());
            return (
              <li
                key={tenant.id}
                className="grid gap-x-6 gap-y-4 px-[var(--gc-pad)] py-4 md:grid-cols-[minmax(0,1fr)_12rem] lg:grid-cols-[minmax(0,1fr)_11rem_auto] lg:items-center 2xl:grid-cols-[minmax(14rem,1fr)_10rem_auto_auto]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="grid size-11 shrink-0 place-items-center rounded-ui text-lg font-bold text-white"
                    style={{ background: PLAN_COLORS[tenant.plan] }}
                    aria-hidden
                  >
                    {tenant.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold" title={tenant.name}>
                      {tenant.name}
                    </p>
                    <p className="truncate text-xs text-muted">
                      <span className="font-mono">{tenant.slug}</span> · creada el {formatDateTime(tenant.createdAt)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {tenant.status === 'active' ? <Badge color="#16a34a">Activa</Badge> : <Badge color="#dc2626">Suspendida</Badge>}
                      {tenant.isDemo && (
                        <Badge color={expired ? '#dc2626' : '#7c3aed'}>
                          Demo · {tenant.demoExpiresAt ? `${expired ? 'venció' : 'vence'} el ${formatDateTime(tenant.demoExpiresAt)}` : 'sin vencimiento'}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <Field label="Plan" className="lg:[&>span:first-child]:sr-only">
                  <Select aria-label={`Plan de ${tenant.name}`} value={tenant.plan} disabled={busy} onChange={(e) => changePlan(tenant, e.target.value as PlanId)}>
                    {PLAN_IDS.map((id) => (
                      <option key={id} value={id}>
                        {PLANS[id].name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Usage tenant={tenant} />

                <div className="flex flex-wrap items-center gap-2 md:col-span-2 md:justify-end lg:col-span-1 lg:col-start-3 lg:row-start-1 2xl:col-start-auto 2xl:row-start-auto">
                  <Button size="sm" variant="ghost" icon={<Blocks className="size-4" />} onClick={() => setEditingModules(tenant)} title={tenant.modules.map((m) => MODULES[m].name).join(', ')}>
                    Módulos <span className="rounded-full bg-subtle px-1.5 text-xs text-muted tabular-nums">{tenant.modules.length}</span>
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Users className="size-4" />} onClick={() => setViewingUsers(tenant)}>
                    Usuarios
                  </Button>
                  <Button size="sm" variant="secondary" icon={<LogIn className="size-4" />} loading={entering === tenant.id} onClick={() => enter(tenant)}>
                    Entrar
                  </Button>
                  <Menu
                    label={`Más acciones para ${tenant.name}`}
                    items={[
                      tenant.isDemo && { label: 'Extender la demo 14 días', icon: <CalendarPlus />, disabled: busy, onSelect: () => void demoAction(tenant, 'extend') },
                      tenant.isDemo && { label: 'Convertir en cliente', icon: <BadgeCheck />, disabled: busy, onSelect: () => void demoAction(tenant, 'convert') },
                      tenant.status === 'active'
                        ? { label: 'Suspender', icon: <PauseCircle />, danger: true, disabled: busy, onSelect: () => void toggleStatus(tenant) }
                        : { label: 'Reactivar', icon: <PlayCircle />, disabled: busy, onSelect: () => void toggleStatus(tenant) },
                    ]}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {viewingUsers && <TenantUsersModal tenant={viewingUsers} onClose={() => setViewingUsers(null)} onEnter={() => enter(viewingUsers)} />}
      {editingModules && platformSettings.data && (
        <TenantModulesModal tenant={editingModules} settings={platformSettings.data} onClose={() => setEditingModules(null)} />
      )}
    </Card>
  );
}

function Usage({ tenant }: { tenant: PlatformTenant }) {
  const limits = PLANS[tenant.plan];
  const items: { label: string; value: ReactNode; max?: number | null; over?: boolean }[] = [
    { label: 'Usuarios', value: num(tenant.usage.users), max: limits.users, over: limits.users !== null && tenant.usage.users > limits.users },
    { label: 'Sucursales', value: num(tenant.usage.branches), max: limits.branches, over: limits.branches !== null && tenant.usage.branches > limits.branches },
    { label: 'Pantallas', value: num(tenant.usage.displays), max: limits.displays, over: limits.displays !== null && tenant.usage.displays > limits.displays },
    { label: 'Turnos 30 días', value: num(tenant.usage.tickets30d) },
    { label: 'Archivos', value: formatBytes(tenant.storageBytes) },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:col-span-2 lg:col-span-3 2xl:col-span-1 2xl:grid-cols-[repeat(5,minmax(5.5rem,auto))]">
      {items.map((item) => (
        <div key={item.label} className={cx('min-w-0 rounded-ui bg-subtle/70 px-2.5 py-2', item.over && 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300')}>
          <dt className="truncate text-[11px] text-muted" title={item.label}>
            {item.label}
          </dt>
          <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums">
            {item.value}
            {item.max !== undefined && item.max !== null && <span className="font-normal text-muted">/{num(item.max)}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Nueva organización                                                  */
/* ------------------------------------------------------------------ */

const COMMON_TIMEZONES = [
  'America/Asuncion',
  'America/Argentina/Buenos_Aires',
  'America/Montevideo',
  'America/Santiago',
  'America/Lima',
  'America/Bogota',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/Madrid',
  'UTC',
];

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function CreateTenantModal({ onClose }: { onClose: () => void }) {
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const formId = useId();
  const tzListId = useId();
  const [form, setForm] = useState({
    organizationName: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    plan: 'free' as PlanId,
    timezone: browserTimezone(),
  });
  const [invite, setInvite] = useState(false);
  const [invitation, setInvitation] = useState<InviteResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timezones = useMemo(() => {
    try {
      return [...COMMON_TIMEZONES, ...Intl.supportedValuesOf('timeZone').filter((tz) => !COMMON_TIMEZONES.includes(tz))];
    } catch {
      return COMMON_TIMEZONES;
    }
  }, []);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const create = useMutation({
    mutationFn: (body: typeof form) =>
      api.post<TenantDTO & { invitation: InviteResultDTO | null }>('/platform/tenants', {
        organizationName: body.organizationName.trim(),
        adminName: body.adminName.trim(),
        adminEmail: body.adminEmail.trim(),
        ...(invite ? {} : { adminPassword: body.adminPassword }),
        plan: body.plan,
        ...(body.timezone.trim() ? { timezone: body.timezone.trim() } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const tenant = await create.mutateAsync(form);
      if (tenant.invitation) {
        setInvitation(tenant.invitation);
        return;
      }
      toast(`Se creó «${tenant.name}». El administrador ya puede iniciar sesión con ${form.adminEmail.trim()}.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (invitation) {
    return <InviteResultModal result={invitation} name={form.adminName} email={form.adminEmail.trim()} onClose={onClose} />;
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Nueva organización"
      description="Se crea con una sucursal, servicios, una pantalla y un kiosco de ejemplo, listos para usar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={create.isPending}>
            Crear organización
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5">
        {error && (
          <p role="alert" className="rounded-ui border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre de la organización" required className="sm:col-span-2">
            <Input
              required
              minLength={2}
              maxLength={120}
              value={form.organizationName}
              onChange={(e) => set('organizationName', e.target.value)}
              placeholder="Ej.: Clínica San José"
              autoFocus
            />
          </Field>
          <Field label="Plan" required>
            <Select value={form.plan} onChange={(e) => set('plan', e.target.value as PlanId)}>
              {PLAN_IDS.map((id) => (
                <option key={id} value={id}>
                  {PLANS[id].name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Zona horaria" hint="Se puede cambiar luego en Configuración → Idioma y zona horaria.">
            <Input list={tzListId} value={form.timezone} onChange={(e) => set('timezone', e.target.value)} autoComplete="off" />
            <datalist id={tzListId}>
              {timezones.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </Field>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Administrador</h3>
          <p className="mb-3 text-xs text-muted">Primer usuario de la organización, con acceso total.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" required>
              <Input required minLength={2} maxLength={120} value={form.adminName} onChange={(e) => set('adminName', e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Email" required>
              <Input type="email" required value={form.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} autoComplete="off" />
            </Field>
            <div className="sm:col-span-2">
              <Toggle
                checked={invite}
                onChange={setInvite}
                label="Enviar una invitación para que elija su contraseña"
                hint={invite ? 'Recibirá un enlace por correo; si no hay correo configurado, le mostramos el enlace para compartirlo.' : 'Usted define la contraseña y se la comparte.'}
              />
            </div>
            {!invite && (
              <Field label="Contraseña" required hint="Mínimo 8 caracteres. Compártala de forma segura." className="sm:col-span-2">
                <Input
                  type="password"
                  required
                  minLength={8}
                  maxLength={200}
                  value={form.adminPassword}
                  onChange={(e) => set('adminPassword', e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
            )}
          </div>
        </div>

        <PlanSummary plan={form.plan} />
      </form>
    </Modal>
  );
}

function PlanSummary({ plan }: { plan: PlanId }) {
  const p = PLANS[plan];
  const fmt = (v: number | null) => (v === null ? 'Ilimitado' : num(v));
  const rows: [string, string][] = [
    ['Sucursales', fmt(p.branches)],
    ['Usuarios', fmt(p.users)],
    ['Pantallas', fmt(p.displays)],
    ['Kioscos', fmt(p.kiosks)],
    ['Almacenamiento', p.storageMb === null ? 'Ilimitado' : formatBytes(p.storageMb * 1024 * 1024)],
    ['Webhooks', fmt(p.webhooks)],
    ['API keys', fmt(p.apiKeys)],
  ];
  return (
    <div className="rounded-ui bg-subtle px-4 py-3">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Límites del plan {p.name}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 sm:block">
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
