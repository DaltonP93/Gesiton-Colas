import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, HardDrive, LogIn, LogOut, MonitorPlay, Plus, Search, Shield, ShieldCheck, Ticket, Users } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PLAN_IDS, PLANS, defaultTenantSettings, type PlanId, type TenantDTO } from '@gc/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Stat,
  Table,
  cx,
  useFeedback,
} from '../../components/ui';
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
  storageBytes: number;
  usage: { users: number; branches: number; displays: number; tickets30d: number };
};

type TenantPatch = { id: string; name?: string; plan?: PlanId; status?: TenantDTO['status']; isDemo?: boolean; extendDemoDays?: number };

const PLATFORM_NAME = defaultTenantSettings().branding.appName;

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
  const { me, logout, impersonate } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <div className="grid size-9 shrink-0 place-items-center rounded-ui bg-primary text-primary-fg">
            <Shield className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{PLATFORM_NAME}</p>
            <p className="truncate text-xs text-muted">Plataforma</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-sm font-medium">{me?.user.name}</p>
              <p className="truncate text-xs text-muted">{me?.user.email}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<LogOut className="size-4" />}
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              Cerrar sesión
            </Button>
          </div>
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

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader
          title="Organizaciones"
          description="Administre las organizaciones (clientes) de la plataforma: planes, estado y soporte."
          actions={
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nueva organización
            </Button>
          }
        />
        <StatsGrid />
        <TenantsCard onCreate={() => setCreating(true)} />
      </main>

      {creating && <CreateTenantModal onClose={() => setCreating(false)} />}
    </div>
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

function TenantsCard({ onCreate }: { onCreate: () => void }) {
  const { impersonate } = useAuth();
  const { toast, confirm } = useFeedback();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [entering, setEntering] = useState<string | null>(null);

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

  return (
    <Card
      padded={false}
      title="Todas las organizaciones"
      description={tenants.data ? `${num(list.length)} ${list.length === 1 ? 'resultado' : 'resultados'}` : undefined}
      actions={
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
      }
    >
      {tenants.isLoading ? (
        <Loading />
      ) : tenants.isError ? (
        <div className="p-5">
          <EmptyState title="No se pudieron cargar las organizaciones" description={errorMessage(tenants.error)} action={<Button onClick={() => tenants.refetch()}>Reintentar</Button>} />
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
        <Table>
          <thead>
            <tr>
              <th>Organización</th>
              <th>Plan</th>
              <th>Estado</th>
              <th>Uso</th>
              <th className="text-right">Almacenamiento</th>
              <th>Creada</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((tenant) => {
              const busy = pendingId === tenant.id;
              return (
                <tr key={tenant.id}>
                  <td>
                    <p className="font-medium">{tenant.name}</p>
                    <p className="font-mono text-xs text-muted">{tenant.slug}</p>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: PLAN_COLORS[tenant.plan] }} aria-hidden />
                      <Select
                        aria-label={`Plan de ${tenant.name}`}
                        value={tenant.plan}
                        disabled={busy}
                        onChange={(e) => changePlan(tenant, e.target.value as PlanId)}
                        className="h-8 w-36"
                      >
                        {PLAN_IDS.map((id) => (
                          <option key={id} value={id}>
                            {PLANS[id].name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      {tenant.status === 'active' ? <Badge color="#16a34a">Activa</Badge> : <Badge color="#dc2626">Suspendida</Badge>}
                      {tenant.isDemo && (
                        <Badge color={tenant.demoExpiresAt && new Date(tenant.demoExpiresAt) < new Date() ? '#dc2626' : '#7c3aed'}>
                          Demo · {tenant.demoExpiresAt ? `vence ${formatDateTime(tenant.demoExpiresAt)}` : 'sin vencimiento'}
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className={cx(tenant.status === 'active' && 'text-red-600')}
                        disabled={busy}
                        onClick={() => toggleStatus(tenant)}
                      >
                        {tenant.status === 'active' ? 'Suspender' : 'Reactivar'}
                      </Button>
                      {tenant.isDemo && (
                        <>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => demoAction(tenant, 'extend')}>
                            +14 días
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => demoAction(tenant, 'convert')}>
                            Convertir en cliente
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                  <td>
                    <Usage tenant={tenant} />
                  </td>
                  <td className="text-right whitespace-nowrap tabular-nums text-muted">{formatBytes(tenant.storageBytes)}</td>
                  <td className="whitespace-nowrap text-muted">{formatDateTime(tenant.createdAt)}</td>
                  <td>
                    <div className="flex justify-end">
                      <Button size="sm" variant="secondary" icon={<LogIn className="size-4" />} loading={entering === tenant.id} onClick={() => enter(tenant)}>
                        Entrar
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function Usage({ tenant }: { tenant: PlatformTenant }) {
  const limits = PLANS[tenant.plan];
  const items: { icon: ReactNode; label: string; value: number; max?: number | null }[] = [
    { icon: <Users />, label: 'Usuarios', value: tenant.usage.users, max: limits.users },
    { icon: <Building2 />, label: 'Sucursales', value: tenant.usage.branches, max: limits.branches },
    { icon: <MonitorPlay />, label: 'Pantallas', value: tenant.usage.displays, max: limits.displays },
    { icon: <Ticket />, label: 'Turnos (30 días)', value: tenant.usage.tickets30d },
  ];
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {items.map((item) => {
        const over = item.max !== undefined && item.max !== null && item.value > item.max;
        const text = `${num(item.value)}${item.max !== undefined && item.max !== null ? `/${num(item.max)}` : ''}`;
        return (
          <li key={item.label} className={cx('inline-flex items-center gap-1 whitespace-nowrap [&_svg]:size-3.5', over && 'font-semibold text-red-600')} title={item.label}>
            {item.icon}
            <span className="sr-only">{item.label}:</span>
            <span className="tabular-nums">{text}</span>
          </li>
        );
      })}
    </ul>
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
      api.post<TenantDTO>('/platform/tenants', {
        organizationName: body.organizationName.trim(),
        adminName: body.adminName.trim(),
        adminEmail: body.adminEmail.trim(),
        adminPassword: body.adminPassword,
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
      toast(`Se creó «${tenant.name}». El administrador ya puede iniciar sesión.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
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
          <Field label="Zona horaria" hint="Se puede cambiar luego en Personalización.">
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
