import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  BellRing,
  CheckCircle2,
  Coffee,
  Megaphone,
  Pause,
  Play,
  PlusCircle,
  Settings2,
  Undo2,
  UserX,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BUILTIN_CUSTOMER_FIELDS, type AgentWorkstationDTO, type IssuedTicketDTO, type TicketDTO } from '@gc/shared';
import {
  Badge,
  Button,
  Card,
  ChipSelect,
  EmptyState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  Textarea,
  cx,
  useFeedback,
} from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { STATUS_COLORS, STATUS_LABELS, elapsedSince, formatClock } from '../../lib/format';
import { useBranches, useCounters, usePriorities, useQueue, useServices, useStaffRealtime } from '../../lib/queries';

function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

export default function AgentConsole() {
  const { terms } = useAuth();
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const workstation = useQuery({ queryKey: ['workstation'], queryFn: () => api.get<AgentWorkstationDTO>('/agent/workstation') });
  const ws = workstation.data;
  const ready = Boolean(ws?.branchId && ws.counterId && ws.serviceIds.length);
  const [setupOpen, setSetupOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const queue = useQueue(ready ? ws!.branchId : null, ws?.serviceIds ?? []);
  const services = useServices();
  const branches = useBranches();
  const counters = useCounters(ws?.branchId);
  useStaffRealtime(ws?.branchId);
  const now = useNow();

  const current = ws?.current ?? null;
  useEffect(() => setNotes(current?.notes ?? ''), [current?.id, current?.notes]);

  const action = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) => api.post<{ ticket: TicketDTO | null }>(path, body ?? {}),
    onSuccess: (res, vars) => {
      void qc.invalidateQueries({ queryKey: ['workstation'] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
      if (vars.path.endsWith('call-next') && !res.ticket) toast('No hay turnos en espera', 'info');
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const pause = useMutation({
    mutationFn: (paused: boolean) =>
      api.put<AgentWorkstationDTO>('/agent/workstation', { branchId: ws?.branchId ?? null, counterId: ws?.counterId ?? null, serviceIds: ws?.serviceIds ?? [], paused }),
    onSuccess: (data) => qc.setQueryData(['workstation'], data),
  });

  const run = (path: string, body?: unknown) => action.mutate({ path, body });
  const callNext = () => run('/agent/call-next');
  const act = (verb: string, body?: unknown) => current && run(`/agent/tickets/${current.id}/${verb}`, body);

  // Atajos de teclado: F1 siguiente, F2 rellamar, F3 iniciar, F4 finalizar, F8 no se presentó.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || action.isPending || !ready) return;
      const map: Record<string, () => void> = {
        F1: () => !current && callNext(),
        F2: () => current?.status === 'called' && act('recall'),
        F3: () => current?.status === 'called' && act('start'),
        F4: () => current && act('finish', { notes }),
        F8: () => current?.status === 'called' && act('no-show'),
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (workstation.isLoading) return <Loading />;

  const branch = branches.data?.find((b) => b.id === ws?.branchId);
  const counter = counters.data?.find((c) => c.id === ws?.counterId);
  const myServices = (services.data ?? []).filter((s) => ws?.serviceIds.includes(s.id));
  const waiting = queue.data?.waiting ?? [];

  return (
    <div>
      <PageHeader
        title="Atención"
        description={
          ready ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge>{branch?.name ?? terms.branch}</Badge>
              <Badge color="#2563eb">{counter?.name ?? terms.counter}</Badge>
              {myServices.map((s) => (
                <Badge key={s.id} color={s.color}>
                  {s.name}
                </Badge>
              ))}
            </span>
          ) : (
            `Configure su ${terms.counter.toLowerCase()} y los ${terms.services.toLowerCase()} que atiende para comenzar.`
          )
        }
        actions={
          <>
            <Button variant="secondary" icon={<PlusCircle className="size-4" />} onClick={() => setIssueOpen(true)} disabled={!ws?.branchId}>
              Emitir {terms.ticket.toLowerCase()}
            </Button>
            {ready && (
              <Button
                variant={ws?.paused ? 'accent' : 'secondary'}
                icon={ws?.paused ? <Play className="size-4" /> : <Coffee className="size-4" />}
                onClick={() => pause.mutate(!ws?.paused)}
                loading={pause.isPending}
              >
                {ws?.paused ? 'Reanudar' : 'Pausa'}
              </Button>
            )}
            <Button variant="secondary" icon={<Settings2 className="size-4" />} onClick={() => setSetupOpen(true)}>
              Puesto
            </Button>
          </>
        }
      />

      {!ready ? (
        <Card>
          <WorkstationForm current={ws} onSaved={() => undefined} />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Card className="overflow-hidden" padded={false}>
            {ws?.paused && (
              <div className="flex items-center gap-2 bg-accent px-5 py-2 text-sm font-medium text-accent-fg">
                <Pause className="size-4" /> Está en pausa: no recibirá turnos hasta reanudar.
              </div>
            )}
            {current ? (
              <CurrentTicket
                ticket={current}
                now={now}
                notes={notes}
                onNotes={setNotes}
                busy={action.isPending}
                onRecall={() => act('recall')}
                onStart={() => act('start')}
                onFinish={() => act('finish', { notes })}
                onNoShow={async () => {
                  if (await confirm({ title: `¿Marcar ${current.code} como no presentado?`, confirmLabel: 'No se presentó', danger: true })) act('no-show');
                }}
                onRequeue={() => act('requeue')}
                onTransfer={() => setTransferOpen(true)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-6 px-6 py-16 text-center">
                <div>
                  <p className="text-5xl font-black tabular-nums">{queue.data?.counts.waiting ?? waiting.length}</p>
                  <p className="text-sm text-muted">{terms.tickets.toLowerCase()} en espera para sus servicios</p>
                </div>
                <Button size="xl" icon={<Megaphone className="size-6" />} onClick={callNext} loading={action.isPending} disabled={ws?.paused}>
                  Llamar siguiente
                </Button>
                <p className="text-xs text-muted">Atajo: F1 · Rellamar F2 · Iniciar F3 · Finalizar F4 · No se presentó F8</p>
              </div>
            )}
          </Card>

          <Card
            title="En espera"
            description={`${waiting.length} ${(waiting.length === 1 ? terms.ticket : terms.tickets).toLowerCase()} · orden de llamado`}
            padded={false}
          >
            {waiting.length === 0 ? (
              <div className="p-5">
                <EmptyState title="Sin turnos en espera" description="Los nuevos turnos aparecerán aquí en tiempo real." />
              </div>
            ) : (
              <ul className="gc-scroll max-h-[60vh] divide-y divide-border overflow-y-auto">
                {waiting.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="w-5 text-right text-xs text-muted tabular-nums">{i + 1}</span>
                    <span className="h-8 w-1 rounded-full" style={{ background: t.service?.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-bold tabular-nums">
                        {t.code}
                        {t.priority && t.priority.weight > 0 && <Badge color={t.priority.color}>{t.priority.name}</Badge>}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {t.service?.name}
                        {t.customer?.name ? ` · ${t.customer.name}` : ''} · {formatClock(elapsedSince(t.createdAt, now))}
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" disabled={Boolean(current) || action.isPending} onClick={() => run(`/agent/tickets/${t.id}/call`)}>
                      Llamar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Modal open={setupOpen} onClose={() => setSetupOpen(false)} title="Configurar puesto de atención">
        <WorkstationForm current={ws} onSaved={() => setSetupOpen(false)} />
      </Modal>

      {current && (
        <TransferModal
          open={transferOpen}
          onClose={() => setTransferOpen(false)}
          ticket={current}
          branchId={ws!.branchId!}
          onTransfer={(body) => {
            act('transfer', body);
            setTransferOpen(false);
          }}
        />
      )}

      {ws?.branchId && <IssueModal open={issueOpen} onClose={() => setIssueOpen(false)} branchId={ws.branchId} />}
    </div>
  );
}

function CurrentTicket({
  ticket,
  now,
  notes,
  onNotes,
  busy,
  onRecall,
  onStart,
  onFinish,
  onNoShow,
  onRequeue,
  onTransfer,
}: {
  ticket: TicketDTO;
  now: number;
  notes: string;
  onNotes: (v: string) => void;
  busy: boolean;
  onRecall: () => void;
  onStart: () => void;
  onFinish: () => void;
  onNoShow: () => void;
  onRequeue: () => void;
  onTransfer: () => void;
}) {
  const { settings } = useAuth();
  const called = ticket.status === 'called';
  const fields = [...BUILTIN_CUSTOMER_FIELDS, ...settings.customerFields];
  const customer = Object.entries(ticket.customer ?? {}).filter(([, v]) => v);
  const waited = ticket.calledAt ? (new Date(ticket.calledAt).getTime() - new Date(ticket.createdAt).getTime()) / 1000 : 0;
  const since = elapsedSince(ticket.startedAt ?? ticket.calledAt, now);

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge color={STATUS_COLORS[ticket.status]}>{STATUS_LABELS[ticket.status]}</Badge>
          <p className="mt-2 text-7xl leading-none font-black tracking-tight tabular-nums">{ticket.code}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {ticket.service && <Badge color={ticket.service.color}>{ticket.service.name}</Badge>}
            {ticket.priority && ticket.priority.weight > 0 && <Badge color={ticket.priority.color}>{ticket.priority.name}</Badge>}
            {ticket.callCount > 1 && <Badge>Llamado {ticket.callCount} veces</Badge>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-right">
          <div>
            <p className="text-xs text-muted">Esperó</p>
            <p className="text-xl font-bold tabular-nums">{formatClock(waited)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">{called ? 'Llamado hace' : 'En atención'}</p>
            <p className={cx('text-xl font-bold tabular-nums', called && since > 60 && 'text-red-600')}>{formatClock(since)}</p>
          </div>
        </div>
      </div>

      {customer.length > 0 && (
        <dl className="mt-5 grid gap-x-6 gap-y-2 rounded-ui bg-subtle p-4 text-sm sm:grid-cols-2">
          {customer.map(([key, value]) => (
            <div key={key}>
              <dt className="text-xs text-muted">{fields.find((f) => f.key === key)?.label ?? key}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {called ? (
          <>
            <Button size="lg" icon={<Play className="size-5" />} onClick={onStart} loading={busy}>
              Iniciar atención
            </Button>
            <Button size="lg" variant="secondary" icon={<BellRing className="size-5" />} onClick={onRecall} disabled={busy}>
              Rellamar
            </Button>
            <Button size="lg" variant="secondary" icon={<UserX className="size-5" />} onClick={onNoShow} disabled={busy}>
              No se presentó
            </Button>
          </>
        ) : (
          <Button size="lg" variant="success" icon={<CheckCircle2 className="size-5" />} onClick={onFinish} loading={busy}>
            Finalizar
          </Button>
        )}
        <Button size="lg" variant="secondary" icon={<ArrowRightLeft className="size-5" />} onClick={onTransfer} disabled={busy}>
          Derivar
        </Button>
        {called && (
          <Button size="lg" variant="ghost" icon={<Undo2 className="size-5" />} onClick={onRequeue} disabled={busy}>
            Devolver a la cola
          </Button>
        )}
      </div>

      <Field label="Notas de la atención" className="mt-6">
        <Textarea value={notes} onChange={(e) => onNotes(e.target.value)} placeholder="Opcional: se guardan al finalizar" rows={2} />
      </Field>
      {called && (
        <Button className="mt-3" variant="success" icon={<CheckCircle2 className="size-4" />} onClick={onFinish} disabled={busy}>
          Finalizar directamente
        </Button>
      )}
    </div>
  );
}

function WorkstationForm({ current, onSaved }: { current: AgentWorkstationDTO | undefined; onSaved: () => void }) {
  const { me, terms } = useAuth();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const branches = useBranches();
  const services = useServices();
  const [branchId, setBranchId] = useState(current?.branchId ?? '');
  const [counterId, setCounterId] = useState(current?.counterId ?? '');
  const [serviceIds, setServiceIds] = useState<string[]>(current?.serviceIds ?? []);
  const counters = useCounters(branchId || null);

  const allowedBranches = useMemo(
    () => (branches.data ?? []).filter((b) => b.active && (!me?.user.branchIds.length || me.user.branchIds.includes(b.id) || me.user.role !== 'agent')),
    [branches.data, me],
  );
  useEffect(() => {
    if (!branchId && allowedBranches.length === 1) setBranchId(allowedBranches[0]!.id);
  }, [allowedBranches, branchId]);

  const branch = allowedBranches.find((b) => b.id === branchId);
  const enabled = new Set(branch?.services.filter((s) => s.enabled).map((s) => s.serviceId));
  const availableServices = (services.data ?? []).filter(
    (s) => s.active && enabled.has(s.id) && (me?.user.role !== 'agent' || !me.user.serviceIds.length || me.user.serviceIds.includes(s.id)),
  );

  const save = useMutation({
    mutationFn: () =>
      api.put<AgentWorkstationDTO>('/agent/workstation', {
        branchId: branchId || null,
        counterId: counterId || null,
        serviceIds: serviceIds.filter((id) => availableServices.some((s) => s.id === id)),
        paused: current?.paused ?? false,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['workstation'], data);
      toast('Puesto actualizado');
      onSaved();
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={terms.branch} required>
          <Select
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setCounterId('');
            }}
            required
          >
            <option value="">Seleccione…</option>
            {allowedBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={terms.counter} required>
          <Select value={counterId} onChange={(e) => setCounterId(e.target.value)} required disabled={!branchId}>
            <option value="">Seleccione…</option>
            {(counters.data ?? [])
              .filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      <Field label={`${terms.services} que atiende`} hint="Solo recibirá turnos de los servicios seleccionados.">
        <div className="flex flex-wrap items-center gap-2">
          <ChipSelect
            options={availableServices.map((s) => ({ value: s.id, label: s.name, color: s.color }))}
            value={serviceIds}
            onChange={setServiceIds}
            emptyLabel={branchId ? 'No hay servicios habilitados en esta sucursal' : 'Seleccione una sucursal'}
          />
          {availableServices.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => setServiceIds(availableServices.map((s) => s.id))}>
              Todos
            </Button>
          )}
        </div>
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending} disabled={!branchId || !counterId || serviceIds.length === 0}>
          Guardar puesto
        </Button>
      </div>
    </form>
  );
}

function TransferModal({
  open,
  onClose,
  ticket,
  branchId,
  onTransfer,
}: {
  open: boolean;
  onClose: () => void;
  ticket: TicketDTO;
  branchId: string;
  onTransfer: (body: { serviceId: string; priorityId: string | null }) => void;
}) {
  const services = useServices();
  const priorities = usePriorities();
  const branches = useBranches();
  const [serviceId, setServiceId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const enabled = new Set(branches.data?.find((b) => b.id === branchId)?.services.filter((s) => s.enabled).map((s) => s.serviceId));
  const options = (services.data ?? []).filter((s) => s.active && enabled.has(s.id) && s.id !== ticket.serviceId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Derivar ${ticket.code}`}
      description="El turno conserva su código y el cliente sigue viéndolo en su celular."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!serviceId} onClick={() => onTransfer({ serviceId, priorityId: priorityId || null })}>
            Derivar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Servicio destino" required>
          <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Seleccione…</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prioridad" hint="Por defecto conserva la prioridad actual.">
          <Select value={priorityId} onChange={(e) => setPriorityId(e.target.value)}>
            <option value="">Mantener ({ticket.priority?.name})</option>
            {(priorities.data ?? [])
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function IssueModal({ open, onClose, branchId }: { open: boolean; onClose: () => void; branchId: string }) {
  const { settings, terms } = useAuth();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const services = useServices();
  const priorities = usePriorities();
  const branches = useBranches();
  const [serviceId, setServiceId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [customer, setCustomer] = useState<Record<string, string>>({});
  const enabled = new Set(branches.data?.find((b) => b.id === branchId)?.services.filter((s) => s.enabled).map((s) => s.serviceId));
  const fields = [...BUILTIN_CUSTOMER_FIELDS.slice(0, 3), ...settings.customerFields];

  const issue = useMutation({
    mutationFn: () =>
      api.post<IssuedTicketDTO>('/tickets', {
        branchId,
        serviceId,
        priorityId: priorityId || null,
        channel: 'agent',
        customer: Object.fromEntries(Object.entries(customer).filter(([, v]) => v.trim())),
      }),
    onSuccess: (res) => {
      toast(`${terms.ticket} ${res.ticket.code} emitido · ${res.waitingAhead} antes`);
      void qc.invalidateQueries({ queryKey: ['queue'] });
      setCustomer({});
      onClose();
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Emitir ${terms.ticket.toLowerCase()}`}
      description="Para clientes que llegan al mostrador o por teléfono."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!serviceId} loading={issue.isPending} onClick={() => issue.mutate()}>
            Emitir
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={terms.service} required>
            <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Seleccione…</option>
              {(services.data ?? [])
                .filter((s) => s.active && enabled.has(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Prioridad">
            <Select value={priorityId} onChange={(e) => setPriorityId(e.target.value)}>
              <option value="">Normal</option>
              {(priorities.data ?? [])
                .filter((p) => p.active && p.weight > 0)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <Field key={f.key} label={f.label}>
              {f.type === 'select' ? (
                <Select value={customer[f.key] ?? ''} onChange={(e) => setCustomer((c) => ({ ...c, [f.key]: e.target.value }))}>
                  <option value="" />
                  {f.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  type={f.type === 'document' ? 'text' : f.type}
                  value={customer[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setCustomer((c) => ({ ...c, [f.key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        </div>
      </div>
    </Modal>
  );
}
