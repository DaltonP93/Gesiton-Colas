import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, Download, FileUp, LogIn, Pencil, Search, UserX, XCircle } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  RT,
  type AppointmentDTO,
  type AppointmentImportResultDTO,
  type AppointmentPageDTO,
  type AppointmentStatus,
  type AvailabilityDayDTO,
  type IssuedTicketDTO,
} from '@gc/shared';
import { Badge, Button, EmptyState, Field, IconButton, Input, Loading, Modal, PageHeader, Select, Stat, Table, Textarea, Toggle, cx, useFeedback } from '../../components/ui';
import { ApiError, api, download, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dayInZone, longDate, shiftDays, timeInZone, zonedToIso } from '../../lib/format';
import { useBranches, useServices, useTenantEvent } from '../../lib/queries';

export const STATUS_COLORS: Record<AppointmentStatus, string> = {
  booked: '#2563eb',
  confirmed: '#7c3aed',
  checked_in: '#d97706',
  completed: '#059669',
  cancelled: '#6b7280',
  no_show: '#dc2626',
};

const ACTIVE: AppointmentStatus[] = ['booked', 'confirmed'];

/** Agenda de citas del día: llegada, cambios, importación y exportación. */
export default function AppointmentsPage() {
  const { settings, can, terms } = useAuth();
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const tz = settings.timezone;
  const today = dayInZone(new Date(), tz);
  const [day, setDay] = useState(today);
  const [branchId, setBranchId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [status, setStatus] = useState<AppointmentStatus | ''>('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AppointmentDTO | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const branches = useBranches();
  const services = useServices();

  const params = new URLSearchParams(Object.entries({ from: day, to: day, branchId, serviceId, status, q: search }).filter(([, v]) => v) as [string, string][]);
  const key = ['appointments', params.toString()];
  const list = useQuery({ queryKey: key, queryFn: () => api.get<AppointmentPageDTO>(`/appointments?${params}`), refetchInterval: 60_000 });
  useTenantEvent(RT.appointmentsChanged, () => void qc.invalidateQueries({ queryKey: ['appointments'] }));
  const refresh = () => qc.invalidateQueries({ queryKey: ['appointments'] });

  const checkIn = useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) => api.post<IssuedTicketDTO & { appointment: AppointmentDTO }>(`/appointments/${id}/check-in`, { force }),
  });

  async function handleCheckIn(a: AppointmentDTO) {
    try {
      const r = await checkIn.mutateAsync({ id: a.id });
      toast(`Llegó ${a.customer.name ?? 'el cliente'}: ${terms.ticket.toLowerCase()} ${r.ticket.code}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'outside_window') {
        const ok = await confirm({ title: '¿Dar llegada igual?', message: `${e.message} Si da llegada ahora, ${terms.ticket.toLowerCase()} se ordena por la hora de la cita.`, confirmLabel: 'Dar llegada' });
        if (!ok) return;
        try {
          const r = await checkIn.mutateAsync({ id: a.id, force: true });
          toast(`Llegó ${a.customer.name ?? 'el cliente'}: ${terms.ticket.toLowerCase()} ${r.ticket.code}`);
        } catch (e2) {
          toast(errorMessage(e2), 'error');
        }
      } else toast(errorMessage(e), 'error');
    }
    void refresh();
  }

  async function handleCancel(a: AppointmentDTO) {
    const ok = await confirm({ title: `¿Cancelar la cita de ${a.customer.name ?? 'este cliente'}?`, message: 'Se libera el horario. Si tiene correo, se le avisa.', confirmLabel: 'Cancelar la cita', danger: true });
    if (!ok) return;
    try {
      await api.post(`/appointments/${a.id}/cancel`, { notify: true });
      toast('Cita cancelada');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
    void refresh();
  }

  async function handleNoShow(a: AppointmentDTO) {
    try {
      await api.post(`/appointments/${a.id}/no-show`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
    void refresh();
  }

  async function exportCsv() {
    try {
      await download(`/appointments.csv?${params}`, `citas_${day}.csv`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const items = list.data?.items ?? [];
  const counts = list.data?.counts ?? {};
  const groups = useMemo(() => {
    const out = new Map<string, AppointmentDTO[]>();
    for (const a of items) {
      const t = timeInZone(a.scheduledAt, tz);
      out.set(t, [...(out.get(t) ?? []), a]);
    }
    return [...out.entries()];
  }, [items, tz]);
  const n = (s: AppointmentStatus) => counts[s] ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<CalendarClock />}
        title="Citas"
        description="Las citas de su sistema, del panel y de la reserva en línea. Al llegar, el cliente se presenta en el kiosco o en recepción y pasa a la fila en el orden de su horario."
        actions={
          <>
            {can('manager') && (
              <>
                <Button variant="secondary" icon={<FileUp className="size-4" />} onClick={() => setImporting(true)}>
                  Importar CSV
                </Button>
                <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportCsv()}>
                  Exportar
                </Button>
              </>
            )}
            <Button icon={<CalendarPlus className="size-4" />} onClick={() => setEditing('new')}>
              Nueva cita
            </Button>
          </>
        }
      />

      <div className="gc-card gc-pad flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-1.5">
          <IconButton label="Día anterior" onClick={() => setDay(shiftDays(day, -1))}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <Field label="Día" className="w-44">
            <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </Field>
          <IconButton label="Día siguiente" onClick={() => setDay(shiftDays(day, 1))}>
            <ChevronRight className="size-4" />
          </IconButton>
          <Button variant="secondary" disabled={day === today} onClick={() => setDay(today)}>
            Hoy
          </Button>
        </div>
        {(branches.data?.length ?? 0) > 1 && (
          <Field label={terms.branch} className="w-48">
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Todas</option>
              {branches.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={terms.service} className="w-48">
          <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Todos</option>
            {services.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estado" className="w-40">
          <Select value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus | '')}>
            <option value="">Todos</option>
            {APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {APPOINTMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <form
          className="flex min-w-60 flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <Field label="Buscar" className="flex-1">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, documento, código o profesional" />
          </Field>
          <Button type="submit" variant="secondary" icon={<Search className="size-4" />} aria-label="Buscar" />
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Por llegar" value={n('booked') + n('confirmed')} tone="#2563eb" />
        <Stat label="Llegaron" value={n('checked_in')} tone="#d97706" />
        <Stat label="Atendidas" value={n('completed')} tone="#059669" />
        <Stat label="No vinieron" value={n('no_show')} tone="#dc2626" />
        <Stat label="Canceladas" value={n('cancelled')} tone="#6b7280" />
      </div>

      <p className="text-sm font-medium first-letter:uppercase">{longDate(day)}</p>
      {list.isLoading ? (
        <Loading />
      ) : list.isError ? (
        <p className="text-sm text-red-600">{errorMessage(list.error)}</p>
      ) : !items.length ? (
        <EmptyState
          icon={<CalendarClock />}
          title="No hay citas para este día"
          description="Agéndelas aquí, impórtelas desde su sistema (CSV o API) o active la reserva en línea en Configuración → Citas."
          action={
            <Button icon={<CalendarPlus className="size-4" />} onClick={() => setEditing('new')}>
              Nueva cita
            </Button>
          }
        />
      ) : (
        <div className="gc-card overflow-hidden">
          <Table>
            <thead>
              <tr>
                <th>Hora</th>
                <th className="w-full">{terms.customer}</th>
                <th>{terms.service}</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map(([time, rows]) =>
                rows.map((a, i) => (
                  <tr key={a.id} className={cx(!ACTIVE.includes(a.status) && a.status !== 'checked_in' && 'opacity-60')}>
                    <td className="align-top text-base font-semibold tabular-nums">{i === 0 ? time : ''}</td>
                    <td className="min-w-56">
                      <span className="font-medium">{a.customer.name || 'Sin nombre'}</span>
                      <span className="block text-xs text-muted">
                        {[a.customer.document && `Doc. ${a.customer.document}`, a.customer.phone, `Código ${a.code}`].filter(Boolean).join(' · ')}
                      </span>
                      {a.notes && <span className="mt-0.5 block text-xs text-muted italic">{a.notes}</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full" style={{ background: a.service.color }} />
                        {a.service.name}
                      </span>
                      <span className="block text-xs text-muted">
                        {[a.professional, (branches.data?.length ?? 0) > 1 ? a.branch.name : null, APPOINTMENT_SOURCE_LABELS[a.source]].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      <Badge color={STATUS_COLORS[a.status]}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
                      {a.ticketCode && <span className="mt-0.5 block text-xs text-muted">{`${terms.ticket} ${a.ticketCode}`}</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      {ACTIVE.includes(a.status) && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" icon={<LogIn className="size-4" />} loading={checkIn.isPending && checkIn.variables?.id === a.id} onClick={() => void handleCheckIn(a)}>
                            Llegó
                          </Button>
                          <IconButton label="Modificar" onClick={() => setEditing(a)}>
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton label="No vino" onClick={() => void handleNoShow(a)}>
                            <UserX className="size-4" />
                          </IconButton>
                          <IconButton label="Cancelar" onClick={() => void handleCancel(a)}>
                            <XCircle className="size-4" />
                          </IconButton>
                        </div>
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </Table>
        </div>
      )}

      {editing && <AppointmentForm appointment={editing === 'new' ? null : editing} defaultDay={day} onClose={() => setEditing(null)} onSaved={() => void refresh()} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => void refresh()} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Alta y modificación                                                 */
/* ------------------------------------------------------------------ */

function AppointmentForm({ appointment, defaultDay, onClose, onSaved }: { appointment: AppointmentDTO | null; defaultDay: string; onClose: () => void; onSaved: () => void }) {
  const { settings, terms } = useAuth();
  const { toast } = useFeedback();
  const tz = settings.timezone;
  const branches = useBranches();
  const services = useServices();
  const [branchId, setBranchId] = useState(appointment?.branchId ?? '');
  const [serviceId, setServiceId] = useState(appointment?.serviceId ?? '');
  const [day, setDay] = useState(appointment ? dayInZone(appointment.scheduledAt, tz) : defaultDay);
  const [time, setTime] = useState(appointment ? timeInZone(appointment.scheduledAt, tz) : '');
  const [customer, setCustomer] = useState({ name: '', document: '', phone: '', email: '', ...appointment?.customer });
  const [professional, setProfessional] = useState(appointment?.professional ?? '');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [notify, setNotify] = useState(true);
  const branch = branchId || branches.data?.[0]?.id || '';
  const service = serviceId || services.data?.[0]?.id || '';

  const slots = useQuery({
    queryKey: ['appointments', 'availability', branch, service, day],
    queryFn: () => api.get<AvailabilityDayDTO[]>(`/appointments/availability?branchId=${branch}&serviceId=${service}&from=${day}&days=1`),
    enabled: Boolean(branch && service && day),
  });
  const daySlots = slots.data?.[0]?.date === day ? slots.data[0].slots : [];

  const save = useMutation({
    mutationFn: () => {
      const body = {
        branchId: branch,
        serviceId: service,
        scheduledAt: zonedToIso(day, time, tz),
        customer: Object.fromEntries(Object.entries(customer).filter(([, v]) => v)),
        professional: professional.trim() || null,
        notes,
      };
      return appointment ? api.put<AppointmentDTO>(`/appointments/${appointment.id}`, body) : api.post<AppointmentDTO>('/appointments', { ...body, notify });
    },
    onSuccess: () => {
      toast(appointment ? 'Cita modificada' : 'Cita agendada');
      onSaved();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!time) return toast('Elija la hora', 'error');
    save.mutate();
  };
  const setC = (k: keyof typeof customer, v: string) => setCustomer((c) => ({ ...c, [k]: v }));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={appointment ? 'Modificar la cita' : 'Nueva cita'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <Button type="submit" form="appointment-form" loading={save.isPending}>
            {appointment ? 'Guardar' : 'Agendar'}
          </Button>
        </>
      }
    >
      <form id="appointment-form" onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={terms.branch}>
            <Select value={branch} onChange={(e) => setBranchId(e.target.value)}>
              {branches.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={terms.service}>
            <Select value={service} onChange={(e) => setServiceId(e.target.value)}>
              {services.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Día">
            <Input type="date" required value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Hora" hint={daySlots.length ? 'O elija un horario de la agenda.' : 'Sin horarios cargados: elija cualquier hora.'}>
            <Input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        {daySlots.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Horarios de la agenda">
            {daySlots.map((s) => (
              <button
                key={s.at}
                type="button"
                aria-pressed={time === s.time}
                onClick={() => setTime(s.time)}
                className={cx(
                  'h-9 rounded-ui border px-3 text-sm font-medium tabular-nums transition',
                  time === s.time ? 'border-primary bg-primary text-primary-fg' : s.available ? 'border-border bg-surface hover:bg-subtle' : 'border-border bg-subtle text-muted line-through',
                )}
                title={s.available ? `${s.available} libre(s)` : 'Completo'}
              >
                {s.time}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <Field label="Nombre">
            <Input required value={customer.name} onChange={(e) => setC('name', e.target.value)} maxLength={120} />
          </Field>
          <Field label="Documento" hint="Con él se presenta en el kiosco.">
            <Input value={customer.document} onChange={(e) => setC('document', e.target.value)} maxLength={30} />
          </Field>
          <Field label="Teléfono" hint="Para la confirmación y el recordatorio por WhatsApp o SMS.">
            <Input type="tel" value={customer.phone} onChange={(e) => setC('phone', e.target.value)} maxLength={30} />
          </Field>
          <Field label="Correo">
            <Input type="email" value={customer.email} onChange={(e) => setC('email', e.target.value)} maxLength={200} />
          </Field>
          <Field label="Profesional">
            <Input value={professional} onChange={(e) => setProfessional(e.target.value)} maxLength={120} placeholder="Opcional" />
          </Field>
          <Field label="Notas">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </Field>
        </div>
        {!appointment && <Toggle checked={notify} onChange={setNotify} label="Enviar la confirmación al cliente" hint="Por correo y, con el módulo de avisos, por WhatsApp o SMS." />}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Importación desde otro sistema                                      */
/* ------------------------------------------------------------------ */

const SAMPLE = 'fecha;hora;documento;nombre;telefono;servicio;sucursal;profesional;id_externo\n05/10/2026;08:30;1234567;María López;0981123456;Consulta;001;Dra. Benítez;HIS-1001';

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { terms } = useAuth();
  const { toast } = useFeedback();
  const branches = useBranches();
  const services = useServices();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [notify, setNotify] = useState(false);
  const [result, setResult] = useState<AppointmentImportResultDTO | null>(null);
  const run = useMutation({
    mutationFn: () => api.post<AppointmentImportResultDTO>('/appointments/import', { csv, notify, ...(branchId ? { branchId } : {}), ...(serviceId ? { serviceId } : {}) }),
    onSuccess: (r) => {
      setResult(r);
      onDone();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Importar citas"
      description="Exporte las citas de su sistema (HIS, ERP, agenda) a CSV o Excel → CSV y súbalas. Las filas con «id_externo» se actualizan si ya existen."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <Button disabled={!csv} loading={run.isPending} onClick={() => run.mutate()}>
            Importar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-ui border border-dashed border-border px-6 py-8 text-center hover:bg-subtle">
          <FileUp className="size-8 text-muted" />
          <span className="font-medium">{fileName || 'Elegir archivo CSV'}</span>
          <span className="text-xs text-muted">Separado por coma o punto y coma; la primera fila con los nombres de las columnas.</span>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setCsv(await file.text());
              setResult(null);
            }}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${terms.branch} (si el archivo no la trae)`}>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Columna «sucursal» del archivo</option>
              {branches.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`${terms.service} (si el archivo no lo trae)`}>
            <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Columna «servicio» del archivo</option>
              {services.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Toggle checked={notify} onChange={setNotify} label="Enviar la confirmación a cada cliente" hint="Normalmente no: su sistema ya les avisó. Los recordatorios salen igual." />
        <details className="rounded-ui bg-subtle p-3 text-sm">
          <summary className="cursor-pointer font-medium">Columnas que se reconocen</summary>
          <p className="mt-2 text-muted">
            fecha y hora (o fecha_hora), nombre, documento, telefono, email, servicio (nombre o prefijo), sucursal (código o nombre), profesional, notas, duracion (minutos),
            id_externo. Fechas como 05/10/2026 o 2026-10-05.
          </p>
          <pre className="gc-scroll mt-2 overflow-x-auto rounded-ui bg-surface p-2 font-mono text-xs">{SAMPLE}</pre>
        </details>
        {result && (
          <div className={cx('rounded-ui border p-4 text-sm', result.errors.length ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200' : 'border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200')}>
            <p className="font-medium">
              {result.created} nueva(s), {result.updated} actualizada(s){result.errors.length ? `, ${result.errors.length} con error` : ''}.
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto">
                {result.errors.map((e) => (
                  <li key={e.line}>
                    Fila {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
