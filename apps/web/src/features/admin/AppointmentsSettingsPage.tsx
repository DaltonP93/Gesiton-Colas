import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Copy, ExternalLink, Pencil, Plug, Plus, QrCode, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { APPOINTMENT_VARIABLES, type AppointmentSettings, type BookingScheduleDTO, type BookingScheduleInput } from '@gc/shared';
import { Badge, Button, EmptyState, Field, IconButton, Input, Modal, PageHeader, Select, Table, Textarea, Toggle, cx, useFeedback } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useBranches, usePriorities, useServices } from '../../lib/queries';
import { Callout, SaveBar, Section, sameJson, useSaveTenant } from './customization/common';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Configuración → Citas: llegada, mensajes, reserva en línea, horarios e integración. */
export default function AppointmentsSettingsPage() {
  const { settings, me, hasModule, terms } = useAuth();
  const { save, saving } = useSaveTenant();
  const { toast } = useFeedback();
  const [form, setForm] = useState<AppointmentSettings>(settings.appointments);
  const priorities = usePriorities();
  const dirty = !sameJson(form, settings.appointments);
  const set = <K extends keyof AppointmentSettings>(k: K, v: AppointmentSettings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setCheckIn = <K extends keyof AppointmentSettings['checkIn']>(k: K, v: AppointmentSettings['checkIn'][K]) => setForm((f) => ({ ...f, checkIn: { ...f.checkIn, [k]: v } }));
  const setBooking = <K extends keyof AppointmentSettings['booking']>(k: K, v: AppointmentSettings['booking'][K]) => setForm((f) => ({ ...f, booking: { ...f.booking, [k]: v } }));
  const bookingUrl = `${window.location.origin}/reservar/${me?.tenant?.slug ?? ''}`;
  const [closed, setClosed] = useState('');

  const showQr = async () => {
    const QR = (await import('qrcode')).default;
    const win = window.open('', '_blank', 'width=700,height=900');
    if (!win) return;
    const qr = await QR.toDataURL(bookingUrl, { width: 900, margin: 1 });
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Reserve su cita</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:40px;color:#0f172a}h1{font-size:40px;margin:16px 0 8px}p{font-size:20px;color:#475569}img{width:420px;height:420px;margin:24px auto}</style></head><body><h2>${esc(me?.tenant?.name ?? '')}</h2><h1>Reserve su cita</h1><p>Escanee el código con la cámara del celular</p><img src="${qr}"><p style="font-size:14px">${esc(bookingUrl)}</p></body></html>`,
    );
    win.document.close();
  };

  return (
    <div className="space-y-[var(--gc-gap)]">
      <PageHeader
        icon={<CalendarClock />}
        title="Citas y reserva en línea"
        description="Citas con fecha y hora: llegan de su sistema (API o CSV), se cargan en el panel o las reservan los clientes. Al presentarse pasan a la fila en el orden de su horario."
      />

      <Section title="Llegada" description="Cuándo puede presentarse el cliente en el kiosco o en recepción, y cómo entra a la fila.">
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Desde" hint="Minutos antes de la hora.">
              <Select value={form.checkIn.before} onChange={(e) => setCheckIn('before', Number(e.target.value))}>
                {[0, 15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                  <option key={m} value={m}>
                    {m} minutos antes
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tolerancia" hint="Minutos después de la hora.">
              <Select value={form.checkIn.after} onChange={(e) => setCheckIn('after', Number(e.target.value))}>
                {[0, 5, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} minutos
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prioridad del turno">
              <Select value={form.checkIn.priorityId ?? ''} onChange={(e) => setCheckIn('priorityId', e.target.value || null)}>
                <option value="">La normal</option>
                {priorities.data
                  ?.filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Marcar «No vino»" hint="Si no se presentó.">
              <Select value={form.noShowAfter} onChange={(e) => set('noShowAfter', Number(e.target.value))}>
                <option value={0}>Nunca (a mano)</option>
                {[30, 60, 120, 240, 480].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} minutos` : `${m / 60} h`} después
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Toggle
            checked={form.checkIn.byAppointmentTime}
            onChange={(v) => setCheckIn('byAppointmentTime', v)}
            label="Ordenar la fila por la hora de la cita"
            hint={`Si llega antes, espera su horario; si llega un poco tarde (dentro de la tolerancia), no pierde su lugar frente a quienes vinieron sin cita. Apagado: entra a la fila al presentarse, como un ${terms.ticket.toLowerCase()} más.`}
          />
        </div>
      </Section>

      <Section title="Mensajes al cliente" description="Por correo (si tiene) y por WhatsApp o SMS (módulo de avisos).">
        <div className="grid gap-6 lg:grid-cols-2">
          <MessageEditor label="Confirmación al agendar" value={form.confirmation} onChange={(v) => set('confirmation', v)} />
          <div className="space-y-3">
            <MessageEditor label="Recordatorio" value={form.reminder} onChange={(v) => set('reminder', v)} />
            <Field label="Enviar el recordatorio">
              <Select value={form.reminderHours} onChange={(e) => set('reminderHours', Number(e.target.value))} disabled={!form.reminder.enabled}>
                {[2, 3, 6, 12, 24, 48, 72].map((h) => (
                  <option key={h} value={h}>
                    {h} horas antes
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted">
          Variables: {APPOINTMENT_VARIABLES.map((v) => `{{${v}}}`).join(' ')}
          {!hasModule('notifications') && ' · Sin el módulo «Avisos por WhatsApp y SMS» solo se envían por correo.'}
        </p>
      </Section>

      <Section title="Reserva en línea" description="Una página propia donde sus clientes eligen el servicio, el día y el horario. Use los horarios de abajo.">
        <div className="space-y-5">
          <Toggle checked={form.booking.enabled} onChange={(v) => setBooking('enabled', v)} label="Habilitar la página de reservas" />
          {form.booking.enabled && (
            <div className="flex flex-wrap items-center gap-2 rounded-ui bg-subtle p-3">
              <code className="min-w-0 flex-1 truncate text-sm">{bookingUrl}</code>
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy className="size-4" />}
                onClick={() => {
                  void navigator.clipboard?.writeText(bookingUrl);
                  toast('Enlace copiado');
                }}
              >
                Copiar
              </Button>
              <Button size="sm" variant="secondary" icon={<QrCode className="size-4" />} onClick={() => void showQr()}>
                QR para imprimir
              </Button>
              <a href={bookingUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-ui px-2 text-sm font-medium text-primary hover:underline">
                Abrir <ExternalLink className="size-3.5" />
              </a>
            </div>
          )}
          <div className={cx('space-y-5', !form.booking.enabled && 'pointer-events-none opacity-50')}>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Reservar hasta">
                <Select value={form.booking.daysAhead} onChange={(e) => setBooking('daysAhead', Number(e.target.value))}>
                  {[7, 14, 30, 60, 90, 180].map((d) => (
                    <option key={d} value={d}>
                      {d} días adelante
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Anticipación mínima">
                <Select value={form.booking.minNoticeMinutes} onChange={(e) => setBooking('minNoticeMinutes', Number(e.target.value))}>
                  {[0, 30, 60, 120, 240, 720, 1440, 2880].map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? 'Sin mínimo' : m < 60 ? `${m} minutos` : m < 1440 ? `${m / 60} h` : `${m / 1440} día(s)`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="El cliente puede cancelar">
                <Select value={form.booking.cancelUntilHours} onChange={(e) => setBooking('cancelUntilHours', Number(e.target.value))}>
                  {[0, 1, 2, 4, 12, 24, 48].map((h) => (
                    <option key={h} value={h}>
                      {h === 0 ? 'Hasta la hora' : `Hasta ${h} h antes`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Toggle checked={form.booking.requireDocument} onChange={(v) => setBooking('requireDocument', v)} label="Pedir documento" />
              <Toggle checked={form.booking.requirePhone} onChange={(v) => setBooking('requirePhone', v)} label="Pedir teléfono" />
              <Toggle checked={form.booking.requireEmail} onChange={(v) => setBooking('requireEmail', v)} label="Pedir correo" />
            </div>
            <Field label="Indicaciones" hint="Se muestran en la página (qué traer, cómo llegar…).">
              <Textarea rows={2} maxLength={600} value={form.booking.message} onChange={(e) => setBooking('message', e.target.value)} />
            </Field>
            <div>
              <span className="mb-1.5 block text-sm font-medium">Días sin atención (feriados)</span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-44">
                  <Input type="date" value={closed} onChange={(e) => setClosed(e.target.value)} aria-label="Feriado" />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Plus className="size-4" />}
                  disabled={!closed || form.booking.closedDates.includes(closed)}
                  onClick={() => {
                    setBooking('closedDates', [...form.booking.closedDates, closed].sort());
                    setClosed('');
                  }}
                >
                  Agregar
                </Button>
                {form.booking.closedDates.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 rounded-full bg-subtle px-3 py-1 text-sm tabular-nums">
                    {d.split('-').reverse().join('/')}
                    <button type="button" aria-label={`Quitar ${d}`} onClick={() => setBooking('closedDates', form.booking.closedDates.filter((x) => x !== d))} className="text-muted hover:text-red-600">
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Section>

      <SchedulesSection />

      <Section title="Integración con su sistema" description="Si las citas se dan en otro sistema (HIS, ERP, agenda), envíelas aquí para que el cliente se presente en el kiosco.">
        <div className="space-y-3 text-sm">
          <Callout icon={<Plug />}>
            <p>
              <strong>API:</strong> cree una API key con los permisos <code>appointments:read</code> y <code>appointments:write</code> (Configuración → Integraciones) y use{' '}
              <code className="break-all">PUT /api/v1/appointments/external/&#123;suId&#125;</code> para crear o actualizar cada cita con el identificador de su sistema. La sucursal va por{' '}
              <code>branchCode</code> y el servicio por nombre o prefijo (<code>serviceName</code>).
            </p>
            <p>
              Para avisar a su sistema cuando el cliente llega, suscriba un webhook a <code>appointment.checked_in</code>. Documentación completa en{' '}
              <a href="/api/docs" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                /api/docs
              </a>
              .
            </p>
          </Callout>
          <p className="text-muted">
            <strong>Sin programar:</strong> exporte las citas del día a CSV e impórtelas en Citas → Importar CSV.
          </p>
        </div>
      </Section>

      <SaveBar dirty={dirty} saving={saving} onDiscard={() => setForm(settings.appointments)} onSave={() => void save({ settings: { appointments: form } }, 'Configuración de citas guardada')} />
    </div>
  );
}

function MessageEditor({ label, value, onChange }: { label: string; value: { enabled: boolean; template: string }; onChange: (v: { enabled: boolean; template: string }) => void }) {
  return (
    <div className="space-y-2">
      <Toggle checked={value.enabled} onChange={(enabled) => onChange({ ...value, enabled })} label={label} />
      <Textarea rows={4} maxLength={700} value={value.template} disabled={!value.enabled} onChange={(e) => onChange({ ...value, template: e.target.value })} aria-label={`Texto: ${label}`} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Horarios con cita                                                   */
/* ------------------------------------------------------------------ */

function SchedulesSection() {
  const { terms } = useAuth();
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const branches = useBranches();
  const services = useServices();
  const schedules = useQuery({ queryKey: ['appointment-schedules'], queryFn: () => api.get<BookingScheduleDTO[]>('/appointment-schedules') });
  const [editing, setEditing] = useState<BookingScheduleDTO | 'new' | null>(null);
  const name = (list: { id: string; name: string }[] | undefined, id: string) => list?.find((x) => x.id === id)?.name ?? '—';

  async function remove(s: BookingScheduleDTO) {
    const ok = await confirm({ title: '¿Quitar este horario?', message: 'Las citas ya agendadas se mantienen.', confirmLabel: 'Quitar', danger: true });
    if (!ok) return;
    try {
      await api.del(`/appointment-schedules/${s.id}`);
      void qc.invalidateQueries({ queryKey: ['appointment-schedules'] });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <Section title="Horarios con cita" description={`Qué días y horas se atiende con cita en cada ${terms.branch.toLowerCase()} y ${terms.service.toLowerCase()}, cada cuánto y cuántas citas por horario.`}>
      {!schedules.data?.length ? (
        <EmptyState
          icon={<CalendarClock />}
          title="Sin horarios"
          description="Sin horarios, las citas se cargan a cualquier hora (panel, API o CSV), pero no hay reserva en línea."
          action={
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Agregar horario
            </Button>
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-ui border border-border">
            <Table>
              <thead>
                <tr>
                  <th>{terms.service}</th>
                  <th>{terms.branch}</th>
                  <th>Días</th>
                  <th>Horario</th>
                  <th>Cada</th>
                  <th>Cupo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {schedules.data.map((s) => (
                  <tr key={s.id} className={cx(!s.active && 'opacity-50')}>
                    <td className="font-medium">{name(services.data, s.serviceId)}</td>
                    <td>{name(branches.data, s.branchId)}</td>
                    <td className="whitespace-nowrap">{s.days.map((d) => DAYS[d]).join(' ')}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {s.from} a {s.to}
                    </td>
                    <td className="whitespace-nowrap">{s.slotMinutes} min</td>
                    <td>
                      {s.capacity}
                      {!s.online && <Badge className="ml-2">Solo interno</Badge>}
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="flex justify-end gap-1">
                        <IconButton label="Modificar" onClick={() => setEditing(s)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton label="Quitar" onClick={() => void remove(s)}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <Button className="mt-4" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Agregar horario
          </Button>
        </>
      )}
      {editing && <ScheduleModal schedule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function ScheduleModal({ schedule, onClose }: { schedule: BookingScheduleDTO | null; onClose: () => void }) {
  const { terms } = useAuth();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const branches = useBranches();
  const services = useServices();
  const [form, setForm] = useState<BookingScheduleInput>(
    schedule ?? { branchId: '', serviceId: '', days: [1, 2, 3, 4, 5], from: '08:00', to: '12:00', slotMinutes: 20, capacity: 1, online: true, active: true },
  );
  const set = <K extends keyof BookingScheduleInput>(k: K, v: BookingScheduleInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const body = { ...form, branchId: form.branchId || branches.data?.[0]?.id || '', serviceId: form.serviceId || services.data?.[0]?.id || '' };
  const save = useMutation({
    mutationFn: () => (schedule ? api.put(`/appointment-schedules/${schedule.id}`, body) : api.post('/appointment-schedules', body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['appointment-schedules'] });
      toast('Horario guardado');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const slots = Math.max(0, Math.floor(((Number(form.to.slice(0, 2)) * 60 + Number(form.to.slice(3))) - (Number(form.from.slice(0, 2)) * 60 + Number(form.from.slice(3)))) / form.slotMinutes));

  return (
    <Modal
      open
      onClose={onClose}
      title={schedule ? 'Modificar horario' : 'Nuevo horario con cita'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!form.days.length} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={terms.service}>
            <Select value={body.serviceId} onChange={(e) => set('serviceId', e.target.value)}>
              {services.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={terms.branch}>
            <Select value={body.branchId} onChange={(e) => set('branchId', e.target.value)}>
              {branches.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium">Días</span>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = form.days.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set('days', on ? form.days.filter((x) => x !== i) : [...form.days, i].sort())}
                  className={cx('h-9 w-12 rounded-ui border text-sm font-medium transition', on ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:bg-subtle')}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Desde">
            <Input type="time" value={form.from} onChange={(e) => set('from', e.target.value)} />
          </Field>
          <Field label="Hasta">
            <Input type="time" value={form.to} onChange={(e) => set('to', e.target.value)} />
          </Field>
          <Field label="Cada (min)">
            <Input type="number" min={5} max={480} value={form.slotMinutes} onChange={(e) => set('slotMinutes', Math.max(5, Number(e.target.value) || 5))} />
          </Field>
          <Field label="Citas por horario" hint="P. ej. profesionales.">
            <Input type="number" min={1} max={200} value={form.capacity} onChange={(e) => set('capacity', Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        </div>
        <p className="text-sm text-muted">
          {slots} horario(s) por día · {slots * form.capacity} cita(s) por día.
        </p>
        <div className="space-y-3">
          <Toggle checked={form.online} onChange={(v) => set('online', v)} label="Ofrecer en la reserva en línea" hint="Apagado: solo se usa al agendar desde el panel." />
          <Toggle checked={form.active} onChange={(v) => set('active', v)} label="Activo" />
        </div>
      </div>
    </Modal>
  );
}
