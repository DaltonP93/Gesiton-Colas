import { useQueryClient } from '@tanstack/react-query';
import { Building2, CircleX, Hourglass, Maximize2, Minimize2, Power, Timer, UserCheck, UserRound, UserX, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { QueueSnapshotDTO, ServiceDTO, TicketDTO } from '@gc/shared';
import { Badge, Button, Card, ChipSelect, EmptyState, IconButton, Loading, PageHeader, Stat, Table, cx, useFeedback } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { STATUS_COLORS, STATUS_LABELS, elapsedSince, formatTime } from '../../lib/format';
import { useQueue, useServices, useStaffRealtime } from '../../lib/queries';
import { BranchSelect, CHANNEL_LABELS, ColorDot, LiveBadge, formatElapsed, formatNumber, useBranchSelection, useNow } from './reports/shared';

/** Minutos de espera a partir de los cuales se resalta un turno. */
const WAIT_WARN = 15 * 60;
const WAIT_ALERT = 30 * 60;

function waitTone(seconds: number) {
  if (seconds >= WAIT_ALERT) return 'text-red-600 font-semibold';
  if (seconds >= WAIT_WARN) return 'text-amber-600 font-semibold';
  return 'text-fg';
}

export default function MonitorPage() {
  const { terms } = useAuth();
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { branches, branch, branchId, select, isLoading: branchesLoading } = useBranchSelection();
  const servicesQuery = useServices();
  const [serviceFilter, setServiceFilter] = useState<string[]>([]);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const now = useNow(1000);

  const queue = useQueue(branchId, serviceFilter);
  useStaffRealtime(branchId);

  // Conserva la última foto de la cola de esta sucursal mientras carga un filtro nuevo, para evitar parpadeos.
  const last = useRef<{ branchId: string | null; data: QueueSnapshotDTO } | null>(null);
  if (queue.data) last.current = { branchId, data: queue.data };
  const snapshot = queue.data ?? (last.current?.branchId === branchId ? last.current.data : undefined);

  useEffect(() => setServiceFilter([]), [branchId]);

  const branchServices = useMemo<ServiceDTO[]>(() => {
    const all = (servicesQuery.data ?? []).filter((s) => s.active);
    if (!branch || branch.services.length === 0) return all;
    const enabled = new Set(branch.services.filter((s) => s.enabled).map((s) => s.serviceId));
    return all.filter((s) => enabled.has(s.id));
  }, [servicesQuery.data, branch]);

  const serviceColor = (t: TicketDTO) => t.service?.color ?? branchServices.find((s) => s.id === t.serviceId)?.color ?? 'var(--gc-primary)';

  /* Pantalla completa (para monitores de supervisión) */
  const container = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === container.current && container.current !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await container.current?.requestFullscreen();
    } catch {
      toast('Su navegador no permite la pantalla completa', 'error');
    }
  };

  const refreshQueue = () => qc.invalidateQueries({ queryKey: ['queue', branchId] });

  const cancelTicket = async (ticket: TicketDTO) => {
    const ok = await confirm({
      title: `¿Cancelar el ${terms.ticket.toLowerCase()} ${ticket.code}?`,
      message: `El ${terms.ticket.toLowerCase()} saldrá de la cola${ticket.customer.name ? ` y ${ticket.customer.name} ya no será llamado` : ''}. Esta acción no se puede deshacer.`,
      confirmLabel: `Sí, cancelar ${terms.ticket.toLowerCase()}`,
      danger: true,
    });
    if (!ok) return;
    setCancelling(ticket.id);
    try {
      await api.post(`/tickets/${ticket.id}/cancel`, { reason: 'Cancelado desde el monitor' });
      toast(`${terms.ticket} ${ticket.code} cancelado`);
      await refreshQueue();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setCancelling(null);
    }
  };

  const closeDay = async () => {
    if (!branch) return;
    const ok = await confirm({
      title: '¿Cerrar la jornada?',
      message: `Se cancelarán todos los ${terms.tickets.toLowerCase()} pendientes de ${branch.name} (en espera, llamados y en atención) y la numeración volverá a empezar desde 1. Esta acción no se puede deshacer.`,
      confirmLabel: 'Cerrar jornada',
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      const res = await api.post<{ cancelled: number }>(`/branches/${branch.id}/queue/reset`);
      toast(
        res.cancelled > 0
          ? `Jornada cerrada: ${formatNumber(res.cancelled)} ${res.cancelled === 1 ? terms.ticket.toLowerCase() : terms.tickets.toLowerCase()} cancelado${res.cancelled === 1 ? '' : 's'}`
          : 'Jornada cerrada. La numeración se reinició.',
      );
      await refreshQueue();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setResetting(false);
    }
  };

  const clock = new Date(now).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (branchesLoading) return <Loading />;

  if (!branch) {
    return (
      <>
        <PageHeader title="Monitor en vivo" />
        <EmptyState
          icon={<Building2 />}
          title={`No hay ${terms.branches.toLowerCase()}`}
          description={`Cree una ${terms.branch.toLowerCase()} para ver su cola en tiempo real.`}
          action={<Button onClick={() => navigate('/app/sucursales')}>Ir a {terms.branches}</Button>}
        />
      </>
    );
  }

  const waiting = snapshot?.waiting ?? [];
  const active = snapshot?.active ?? [];
  const counts = snapshot?.counts;
  const longestWait = waiting.reduce((max, t) => Math.max(max, elapsedSince(t.createdAt, now)), 0);

  return (
    <div ref={container} className={cx(fullscreen && 'gc-scroll h-full overflow-y-auto bg-bg p-6 text-fg 2xl:p-10')}>
      <PageHeader
        title="Monitor en vivo"
        description={`Cola de ${terms.tickets.toLowerCase()} en tiempo real · ${branch.name}`}
        actions={
          <>
            <span className="hidden font-mono text-2xl font-semibold tabular-nums sm:inline 2xl:text-3xl" aria-label="Hora actual">
              {clock}
            </span>
            <LiveBadge updatedAt={queue.dataUpdatedAt || undefined} />
            {branches.length > 1 && <BranchSelect branches={branches} value={branchId} onChange={(id) => id && select(id)} />}
            <Button variant="secondary" icon={fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />} onClick={() => void toggleFullscreen()}>
              {fullscreen ? 'Salir' : 'Pantalla completa'}
            </Button>
            {/* En pantalla completa el monitor es solo de lectura (los diálogos no se verían sobre ella). */}
            {!fullscreen && (
              <Button variant="danger" icon={<Power className="size-4" />} loading={resetting} onClick={() => void closeDay()}>
                Cerrar jornada
              </Button>
            )}
          </>
        }
      />

      {queue.isError && !snapshot ? (
        <EmptyState
          title="No se pudo cargar la cola"
          description={errorMessage(queue.error)}
          action={
            <Button variant="secondary" onClick={() => void queue.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : !snapshot ? (
        <Loading label="Cargando cola…" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
            <Stat label="En espera" value={formatNumber(counts?.waiting ?? 0)} icon={<Hourglass />} tone={STATUS_COLORS.waiting} />
            <Stat label="Llamados" value={formatNumber(counts?.called ?? 0)} icon={<Users />} tone={STATUS_COLORS.called} />
            <Stat label="En atención" value={formatNumber(counts?.inService ?? 0)} icon={<UserRound />} tone={STATUS_COLORS.in_service} />
            <Stat label="Atendidos hoy" value={formatNumber(counts?.finishedToday ?? 0)} icon={<UserCheck />} tone={STATUS_COLORS.finished} />
            <Stat label="No se presentaron" value={formatNumber(counts?.noShowToday ?? 0)} icon={<UserX />} tone={STATUS_COLORS.no_show} />
            <Stat
              icon={<Timer />}
              tone="#d97706"
              label="Espera más larga"
              value={<span className={waitTone(longestWait)}>{waiting.length ? formatElapsed(longestWait) : '—'}</span>}
              hint={waiting.length ? `${terms.ticket} ${waiting.reduce((a, b) => (a.createdAt < b.createdAt ? a : b)).code}` : 'Sin espera'}
            />
          </div>

          {branchServices.length > 1 && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-muted">Filtrar por {terms.service.toLowerCase()}:</span>
              <ChipSelect
                options={branchServices.map((s) => ({ value: s.id, label: s.name, color: s.color }))}
                value={serviceFilter}
                onChange={setServiceFilter}
              />
              {serviceFilter.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setServiceFilter([])}>
                  Ver todos
                </Button>
              )}
            </div>
          )}

          <div className={cx('grid gap-6 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]', queue.isFetching && !queue.data && 'opacity-60')}>
            <section aria-labelledby="monitor-active" className="min-w-0">
              <h2 id="monitor-active" className="mb-3 flex items-center gap-2 text-base font-semibold 2xl:text-lg">
                En atención ahora
                <Badge>{active.length}</Badge>
              </h2>
              {active.length === 0 ? (
                <EmptyState
                  icon={<UserRound />}
                  title="Nadie está siendo atendido"
                  description={`Cuando un ${terms.agent.toLowerCase()} llame un ${terms.ticket.toLowerCase()} aparecerá aquí.`}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-2">
                  {active.map((t) => (
                    <ActiveCard key={t.id} ticket={t} color={serviceColor(t)} now={now} />
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="monitor-waiting" className="min-w-0">
              <h2 id="monitor-waiting" className="mb-3 flex items-center gap-2 text-base font-semibold 2xl:text-lg">
                En espera
                <Badge>{waiting.length}</Badge>
                <span className="ml-auto text-xs font-normal text-muted">En orden de llamado</span>
              </h2>
              {waiting.length === 0 ? (
                <EmptyState
                  icon={<Hourglass />}
                  title={`No hay ${terms.tickets.toLowerCase()} en espera`}
                  description={serviceFilter.length ? 'Pruebe quitando el filtro de servicios.' : 'La cola está al día.'}
                />
              ) : (
                <Card padded={false}>
                  <Table className="2xl:text-base">
                    <thead>
                      <tr>
                        <th className="w-12">#</th>
                        <th>{terms.ticket}</th>
                        <th>{terms.service}</th>
                        <th>Prioridad</th>
                        <th>{terms.customer}</th>
                        <th className="text-right">Espera</th>
                        <th>Canal</th>
                        {!fullscreen && (
                          <th className="w-12">
                            <span className="sr-only">Acciones</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {waiting.map((t, i) => {
                        const waited = elapsedSince(t.createdAt, now);
                        const preferential = (t.priority?.weight ?? 0) > 0;
                        return (
                          <tr key={t.id}>
                            <td className="tabular-nums text-muted">{i + 1}</td>
                            <td>
                              <span className="font-mono text-base font-bold tracking-wide whitespace-nowrap 2xl:text-lg">{t.code}</span>
                            </td>
                            <td>
                              <span className="flex items-center gap-2 whitespace-nowrap">
                                <ColorDot color={serviceColor(t)} />
                                {t.service?.name ?? '—'}
                              </span>
                            </td>
                            <td>
                              {preferential && t.priority ? (
                                <Badge color={t.priority.color}>{t.priority.name}</Badge>
                              ) : (
                                <span className="text-muted">{t.priority?.name ?? 'Normal'}</span>
                              )}
                            </td>
                            <td className="max-w-48 truncate">{t.customer.name || <span className="text-muted">—</span>}</td>
                            <td className="text-right whitespace-nowrap">
                              <span className={cx('font-mono tabular-nums', waitTone(waited))} title={`Emitido a las ${formatTime(t.createdAt)}`}>
                                {formatElapsed(waited)}
                              </span>
                            </td>
                            <td className="whitespace-nowrap text-muted">{CHANNEL_LABELS[t.channel] ?? t.channel}</td>
                            {!fullscreen && (
                              <td className="text-right">
                                <IconButton
                                  label={`Cancelar ${terms.ticket.toLowerCase()} ${t.code}`}
                                  icon={<CircleX className="size-4" />}
                                  className="text-red-600 hover:bg-red-600/10"
                                  loading={cancelling === t.id}
                                  onClick={() => void cancelTicket(t)}
                                />
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </Card>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveCard({ ticket, color, now }: { ticket: TicketDTO; color: string; now: number }) {
  const { terms } = useAuth();
  const inService = ticket.status === 'in_service';
  const since = inService ? (ticket.startedAt ?? ticket.calledAt) : ticket.calledAt;
  const elapsed = elapsedSince(since, now);
  // Un llamado sin respuesta por más de 2 minutos merece atención.
  const stale = !inService && elapsed > 120;
  return (
    <article
      className={cx(
        'relative overflow-hidden rounded-ui border bg-surface p-4 pl-5 shadow-sm 2xl:p-5 2xl:pl-6',
        stale ? 'border-amber-500/60' : 'border-border',
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-3xl leading-none font-black tracking-tight 2xl:text-4xl">{ticket.code}</p>
          <p className="mt-1.5 flex items-center gap-1.5 truncate text-sm text-muted">
            <ColorDot color={color} />
            {ticket.service?.name ?? '—'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge color={STATUS_COLORS[ticket.status]}>{STATUS_LABELS[ticket.status]}</Badge>
          {ticket.callCount > 1 && <span className="text-xs text-muted">Llamado {ticket.callCount} veces</span>}
          {ticket.priority && ticket.priority.weight > 0 && <Badge color={ticket.priority.color}>{ticket.priority.name}</Badge>}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-muted">{terms.counter}</dt>
          <dd className="truncate font-semibold">{ticket.counter?.name ?? '—'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">{terms.agent}</dt>
          <dd className="truncate font-medium">{ticket.agent?.name ?? '—'}</dd>
        </div>
        {ticket.customer.name && (
          <div className="col-span-2 min-w-0">
            <dt className="text-xs text-muted">{terms.customer}</dt>
            <dd className="truncate">{ticket.customer.name}</dd>
          </div>
        )}
      </dl>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-muted">{inService ? 'En atención hace' : 'Llamado hace'}</span>
        <span className={cx('font-mono text-lg font-semibold tabular-nums 2xl:text-xl', stale && 'text-amber-600')}>{formatElapsed(elapsed)}</span>
      </div>
    </article>
  );
}
