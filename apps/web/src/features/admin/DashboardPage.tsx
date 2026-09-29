import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Circle,
  CircleCheck,
  Clock,
  Crown,
  Headset,
  Hourglass,
  MonitorPlay,
  Tablet,
  Timer,
  UserCheck,
  Video,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { brandingSchema, type PlanId, type PlanLimits, type PlanResource, type Role } from '@gc/shared';
import { Badge, Button, Card, EmptyState, Loading, PageHeader, Stat, Table, cx } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDuration } from '../../lib/format';
import { useDisplays, useKiosks, useMedia, useServices, useStaffRealtime } from '../../lib/queries';
import { HourlyChart, SERIES, SeriesLegend } from './reports/charts';
import { BranchSelect, ColorDot, LiveBadge, SUMMARY_KEY, formatNumber, useBranchSelection, useSummary } from './reports/shared';

interface UsageDTO {
  plan: PlanId;
  limits: PlanLimits;
  usage: Record<PlanResource, number> & { storageBytes: number };
}

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function DashboardPage() {
  const { me, terms, can } = useAuth();
  const qc = useQueryClient();
  const { branches, branchId, branch, select, isLoading: branchesLoading } = useBranchSelection();

  const summary = useSummary({ branchId }, { enabled: !branchesLoading, refetchInterval: 30_000 });

  // Refresca los indicadores ante cada evento en vivo (agrupando ráfagas de eventos).
  const debounce = useRef<number | undefined>(undefined);
  useStaffRealtime(branchId, () => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void qc.invalidateQueries({ queryKey: [SUMMARY_KEY] }), 1200);
  });
  useEffect(() => () => window.clearTimeout(debounce.current), []);

  const firstName = me?.user.name.split(/\s+/)[0] ?? '';
  const todayText = new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  const today = todayText.charAt(0).toUpperCase() + todayText.slice(1);
  const data = summary.data;
  const t = data?.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        description={
          <>
            <span className="font-medium text-fg">{me?.tenant?.name}</span>
            {branch && branches.length > 1 ? ` · ${branch.name}` : ''} · {today}
          </>
        }
        actions={
          <>
            <LiveBadge updatedAt={summary.dataUpdatedAt || undefined} />
            {branches.length > 1 && <BranchSelect branches={branches} value={branchId} onChange={(id) => id && select(id)} />}
          </>
        }
      />

      {summary.isLoading || branchesLoading ? (
        <Loading label="Cargando indicadores…" />
      ) : summary.isError ? (
        <EmptyState
          title="No se pudieron cargar los indicadores"
          description="Revise su conexión e intente nuevamente."
          action={
            <Button variant="secondary" onClick={() => void summary.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : (
        <div className={cx('grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-5', summary.isPlaceholderData && 'opacity-60 transition')}>
          <Stat label="En espera" value={formatNumber(t?.waiting ?? 0)} icon={<Hourglass />} tone="#d97706" hint={`${formatNumber(t?.issued ?? 0)} emitidos hoy`} />
          <Stat label="En atención" value={formatNumber(t?.inService ?? 0)} icon={<Headset />} tone="#7c3aed" hint="Llamados o siendo atendidos" />
          <Stat label="Atendidos hoy" value={formatNumber(t?.finished ?? 0)} icon={<UserCheck />} tone="#16a34a" hint={`${formatNumber(t?.noShow ?? 0)} no se presentaron`} />
          <Stat label="Espera promedio" value={formatDuration(t?.avgWaitSeconds)} icon={<Clock />} hint="Desde la emisión hasta el llamado" />
          <Stat label="Atención promedio" value={formatDuration(t?.avgServiceSeconds)} icon={<Timer />} hint="Duración de cada atención" />
        </div>
      )}

      <QuickAccess />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card
            title={`${terms.tickets} por hora`}
            description="Actividad de hoy, se actualiza en vivo"
            actions={<SeriesLegend items={[SERIES.issued, SERIES.finished]} />}
          >
            {data && (data.totals.issued > 0 || data.byHour.some((h) => h.finished > 0)) ? (
              <HourlyChart data={data.byHour} />
            ) : (
              <EmptyState
                title={`Aún no hay ${terms.tickets.toLowerCase()} hoy`}
                description={`Cuando se emitan ${terms.tickets.toLowerCase()} desde el kiosco, la web o la API verá aquí la actividad por hora.`}
              />
            )}
          </Card>

          <Card title={`Por ${terms.service.toLowerCase()}`} description="Resumen de hoy" padded={false}>
            {data && data.byService.length > 0 ? (
              <Table>
                <thead>
                  <tr>
                    <th>{terms.service}</th>
                    <th className="text-right">Emitidos</th>
                    <th className="text-right">Atendidos</th>
                    <th className="text-right">Espera prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byService.map((s) => (
                    <tr key={s.serviceId}>
                      <td>
                        <span className="flex items-center gap-2 font-medium">
                          <ColorDot color={s.color} />
                          {s.name}
                        </span>
                      </td>
                      <td className="text-right tabular-nums">{formatNumber(s.issued)}</td>
                      <td className="text-right tabular-nums">{formatNumber(s.finished)}</td>
                      <td className="text-right tabular-nums text-muted">{formatDuration(s.avgWaitSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-muted">Sin movimientos todavía.</p>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Onboarding />
          {can('admin') && <PlanCard />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Accesos rápidos                                                     */
/* ------------------------------------------------------------------ */

function QuickAccess() {
  const { terms } = useAuth();
  const items: { to: string; title: string; description: string; icon: ReactNode }[] = [
    { to: '/app/atencion', title: 'Atención', description: `Llame y atienda ${terms.tickets.toLowerCase()} desde su ${terms.counter.toLowerCase()}`, icon: <Headset /> },
    { to: '/app/pantallas', title: 'Pantallas', description: 'Configure las TV de llamados', icon: <MonitorPlay /> },
    { to: '/app/kioscos', title: 'Kioscos', description: `Dispensadores de ${terms.tickets.toLowerCase()} táctiles`, icon: <Tablet /> },
    { to: '/app/contenido', title: 'Publicidad', description: 'Videos e imágenes para sus pantallas', icon: <Video /> },
  ];
  return (
    <nav aria-label="Accesos rápidos" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="group flex items-center gap-4 rounded-ui border border-border bg-surface p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-ui bg-primary/10 text-primary [&_svg]:size-5">{item.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{item.title}</span>
            <span className="block truncate text-sm text-muted">{item.description}</span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-primary" />
        </Link>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Primeros pasos                                                      */
/* ------------------------------------------------------------------ */

const ONBOARDING_KEY = 'gc.onboarding.hidden';

function readHidden(tenantId: string | undefined): boolean {
  if (!tenantId) return false;
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === tenantId;
  } catch {
    return false;
  }
}

function Onboarding() {
  const { me, settings, terms, can } = useAuth();
  const tenantId = me?.tenant?.id;
  const [hidden, setHidden] = useState(() => readHidden(tenantId));
  const services = useServices();
  const displays = useDisplays();
  const kiosks = useKiosks();
  const media = useMedia();
  const usage = useUsage(can('admin'));

  const defaults = brandingSchema.parse({});
  const b = settings.branding;
  const branded = Boolean(b.logoUrl) || b.primaryColor !== defaults.primaryColor || b.appName !== defaults.appName;

  const steps: { key: string; label: string; description: string; to: string; done: boolean; role: Role }[] = [
    { key: 'brand', label: 'Personalice su marca', description: 'Logo, colores y tipografía de su organización', to: '/app/personalizacion', done: branded, role: 'admin' },
    {
      key: 'services',
      label: `Configure sus ${terms.services.toLowerCase()}`,
      description: `Defina qué ${terms.services.toLowerCase()} ofrece y sus prefijos`,
      to: '/app/servicios',
      done: (services.data?.length ?? 0) > 0,
      role: 'admin',
    },
    {
      key: 'display',
      label: 'Abra su pantalla en la TV',
      description: 'Copie el enlace de la pantalla y ábralo en el televisor',
      to: '/app/pantallas',
      done: (displays.data ?? []).some((d) => d.lastSeenAt),
      role: 'manager',
    },
    {
      key: 'kiosk',
      label: 'Configure el kiosco',
      description: `Para que sus clientes saquen ${terms.ticket.toLowerCase()} solos`,
      to: '/app/kioscos',
      done: (kiosks.data ?? []).some((k) => k.lastSeenAt),
      role: 'manager',
    },
    { key: 'media', label: 'Agregue publicidad', description: 'Suba videos o imágenes para sus pantallas', to: '/app/contenido', done: (media.data?.length ?? 0) > 0, role: 'manager' },
    { key: 'team', label: 'Invite a su equipo', description: `Cree usuarios para cada ${terms.agent.toLowerCase()}`, to: '/app/usuarios', done: (usage.data?.usage.users ?? 0) > 1, role: 'admin' },
  ];
  const visible = steps.filter((s) => can(s.role));
  const completed = visible.filter((s) => s.done).length;
  const allDone = completed === visible.length;

  if (hidden || visible.length === 0) return null;

  const hide = () => {
    setHidden(true);
    try {
      if (tenantId) window.localStorage.setItem(ONBOARDING_KEY, tenantId);
    } catch {
      /* sin almacenamiento local */
    }
  };

  return (
    <Card
      title="Primeros pasos"
      description={allDone ? '¡Todo listo! Su sistema está configurado.' : `${completed} de ${visible.length} completados`}
      actions={
        <Button variant="ghost" size="sm" onClick={hide}>
          Ocultar
        </Button>
      }
      padded={false}
    >
      <div className="px-5 pt-4">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-primary/15"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={visible.length}
          aria-valuenow={completed}
          aria-label="Progreso de la configuración"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(completed / visible.length) * 100}%` }} />
        </div>
      </div>
      <ul className="p-2">
        {visible.map((step) => (
          <li key={step.key}>
            <Link to={step.to} className="group flex items-start gap-3 rounded-ui px-3 py-2.5 transition hover:bg-subtle">
              {step.done ? (
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-label="Completado" />
              ) : (
                <Circle className="mt-0.5 size-5 shrink-0 text-muted" aria-label="Pendiente" />
              )}
              <span className="min-w-0 flex-1">
                <span className={cx('block text-sm font-medium', step.done && 'text-muted line-through decoration-1')}>{step.label}</span>
                {!step.done && <span className="block text-xs text-muted">{step.description}</span>}
              </span>
              {!step.done && <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

function useUsage(enabled: boolean) {
  return useQuery({ queryKey: ['tenant-usage'], queryFn: () => api.get<UsageDTO>('/tenant/usage'), enabled, staleTime: 60_000 });
}

function PlanCard() {
  const { terms } = useAuth();
  const usage = useUsage(true);
  if (usage.isLoading) {
    return (
      <Card title="Su plan">
        <Loading />
      </Card>
    );
  }
  if (!usage.data) return null;
  const { limits, usage: used } = usage.data;
  const rows: { label: string; used: number; limit: number | null; format?: (n: number) => string }[] = [
    { label: terms.branches, used: used.branches, limit: limits.branches },
    { label: 'Pantallas', used: used.displays, limit: limits.displays },
    { label: 'Kioscos', used: used.kiosks, limit: limits.kiosks },
    { label: 'Usuarios', used: used.users, limit: limits.users },
    {
      label: 'Almacenamiento',
      used: used.storageBytes,
      limit: limits.storageMb === null ? null : limits.storageMb * 1024 * 1024,
      format: formatBytes,
    },
  ];
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Crown className="size-4 text-accent" /> Plan {limits.name}
        </span>
      }
      description="Uso actual de su organización"
    >
      <ul className="space-y-4">
        {rows.map((row) => (
          <UsageMeter key={row.label} {...row} />
        ))}
      </ul>
      <p className="mt-5 text-xs text-muted">Archivos de hasta {formatBytes(limits.maxUploadMb * 1024 * 1024)} por subida.</p>
    </Card>
  );
}

function UsageMeter({ label, used, limit, format = formatNumber }: { label: string; used: number; limit: number | null; format?: (n: number) => string }) {
  const ratio = limit ? Math.min(1, used / limit) : 0;
  const tone = ratio >= 1 ? '#dc2626' : ratio >= 0.8 ? '#d97706' : 'var(--gc-primary)';
  return (
    <li>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted">
          {format(used)} <span className="text-xs">de</span> {limit === null ? 'Ilimitado' : format(limit)}
        </span>
      </div>
      {limit !== null && (
        <div
          className="h-2 overflow-hidden rounded-full"
          style={{ background: `color-mix(in srgb, ${tone} 15%, transparent)` }}
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={used}
        >
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(ratio * 100, used > 0 ? 3 : 0)}%`, background: tone }} />
        </div>
      )}
      {limit !== null && ratio >= 1 && (
        <Badge color="#dc2626" className="mt-1.5">
          Límite alcanzado
        </Badge>
      )}
    </li>
  );
}
