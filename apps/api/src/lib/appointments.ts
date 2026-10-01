import { and, asc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  RT,
  normalizeDocument,
  renderTemplate,
  type AppointmentCustomer,
  type AppointmentDTO,
  type AppointmentSource,
  type AppointmentStatus,
  type AvailabilityDayDTO,
  type KioskAppointmentMatchDTO,
  type PublicAppointmentDTO,
  type SlotDTO,
  type TicketChannel,
  type WebhookEvent,
} from '@gc/shared';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db/client';
import { appointments, bookingSchedules, branchServices, branches, services, tenants, tickets, type Appointment, type Tenant } from '../db/schema';
import { issueTicket } from '../modules/tickets/queue';
import { rooms } from '../realtime';
import { randomToken } from './crypto';
import { tenantSettings } from './dto';
import { appointmentMail } from './emails';
import { AppError, badRequest, conflict, isUniqueViolation, notFound } from './errors';
import { addDays, dayInTimezone, localParts, localToUtc } from './tz';

/*
 * Citas con fecha y hora. Llegan de otro sistema (API / CSV), las carga el personal o las
 * reserva el cliente en la página pública. Al presentarse se emite un turno ordenado por la
 * hora de la cita (sort_at).
 */

type Deps = Pick<AppContext, 'config' | 'db' | 'log' | 'mailer' | 'notifier' | 'webhooks' | 'rt' | 'modulesOf' | 'emailBrand' | 'publishTicket'>;

/** Sin letras ni números que se confundan (O/0, I/1, S/5, B/8). */
const CODE_ALPHABET = 'ACDEFHJKLMNPRTUVWXY34679';
export const APPOINTMENT_CODE = /^[A-Z0-9]{6}$/;

function randomCode() {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

/** Datos del cliente: solo claves simples y textos cortos. */
export function sanitizeAppointmentCustomer(customer: Record<string, unknown> | undefined): AppointmentCustomer {
  const out: AppointmentCustomer = {};
  for (const [key, value] of Object.entries(customer ?? {}).slice(0, 20)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    out[key] = String(value).trim().slice(0, 300);
  }
  return out;
}

/** «María López» → «María L.» (para mostrar en el kiosco sin exponer el nombre completo). */
export const shortName = (name: string | undefined) => {
  const [first = '', last = ''] = (name ?? '').trim().split(/\s+/);
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first;
};

export interface AppointmentInput {
  branchId: string;
  serviceId: string;
  scheduledAt: Date;
  durationMinutes?: number;
  customer?: Record<string, unknown>;
  professional?: string | null;
  notes?: string;
  externalId?: string | null;
  status?: Extract<AppointmentStatus, 'booked' | 'confirmed'>;
}

type Row = { appointment: Appointment; service: { id: string; name: string; color: string }; branch: { id: string; name: string; address: string; timezone: string | null }; ticketCode: string | null };

export class Appointments {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: Deps) {}

  start(intervalMs = 5 * 60_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.processDue().catch((error) => this.deps.log.error({ err: error }, 'citas: error al procesar recordatorios')), intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private get base() {
    return this.deps.config.PUBLIC_URL.replace(/\/$/, '');
  }

  manageUrl(token: string) {
    return `${this.base}/cita/${token}`;
  }

  /* ----------------------------- Lectura ----------------------------- */

  private select(db: DbOrTx = this.deps.db) {
    return db
      .select({
        appointment: appointments,
        service: { id: services.id, name: services.name, color: services.color },
        branch: { id: branches.id, name: branches.name, address: branches.address, timezone: branches.timezone },
        ticketCode: tickets.code,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(branches, eq(branches.id, appointments.branchId))
      .leftJoin(tickets, eq(tickets.id, appointments.ticketId));
  }

  toDTO(r: Row): AppointmentDTO {
    const a = r.appointment;
    return {
      id: a.id,
      branchId: a.branchId,
      serviceId: a.serviceId,
      code: a.code,
      externalId: a.externalId,
      source: a.source,
      status: a.status,
      scheduledAt: a.scheduledAt.toISOString(),
      durationMinutes: a.durationMinutes,
      customer: a.customer ?? {},
      professional: a.professional,
      notes: a.notes,
      ticketId: a.ticketId,
      ticketCode: r.ticketCode,
      checkedInAt: a.checkedInAt?.toISOString() ?? null,
      cancelledAt: a.cancelledAt?.toISOString() ?? null,
      cancelReason: a.cancelReason,
      reminderSentAt: a.reminderSentAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      service: r.service,
      branch: { id: r.branch.id, name: r.branch.name },
      manageUrl: this.manageUrl(a.publicToken),
    };
  }

  async find(tenantId: string, where: SQL, db: DbOrTx = this.deps.db) {
    const [row] = await this.select(db)
      .where(and(eq(appointments.tenantId, tenantId), where))
      .limit(1);
    return row ?? null;
  }

  async get(tenantId: string, id: string) {
    const row = await this.find(tenantId, eq(appointments.id, id));
    if (!row) throw notFound('Cita');
    return row;
  }

  async list(tenantId: string, filter: { from: Date; to: Date; branchId?: string; serviceId?: string; status?: AppointmentStatus; q?: string; limit?: number }) {
    const q = filter.q?.trim();
    const doc = normalizeDocument(q);
    const where = and(
      eq(appointments.tenantId, tenantId),
      gte(appointments.scheduledAt, filter.from),
      lt(appointments.scheduledAt, filter.to),
      filter.branchId ? eq(appointments.branchId, filter.branchId) : undefined,
      filter.serviceId ? eq(appointments.serviceId, filter.serviceId) : undefined,
      q
        ? sql`(${appointments.code} = ${q.toUpperCase()} OR ${appointments.externalId} = ${q} OR (${doc} <> '' AND ${appointments.document} = ${doc})
               OR ${appointments.customer}->>'name' ILIKE ${`%${q.replace(/[%_\\]/g, '\\$&')}%`} OR ${appointments.professional} ILIKE ${`%${q.replace(/[%_\\]/g, '\\$&')}%`})`
        : undefined,
    );
    const [rows, counts] = await Promise.all([
      this.select()
        .where(and(where, filter.status ? eq(appointments.status, filter.status) : undefined))
        .orderBy(asc(appointments.scheduledAt), asc(appointments.createdAt))
        .limit(filter.limit ?? 1000),
      this.deps.db
        .select({ status: appointments.status, n: sql<number>`count(*)::int` })
        .from(appointments)
        .where(where)
        .groupBy(appointments.status),
    ]);
    return { items: rows.map((r) => this.toDTO(r)), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  }

  /* --------------------------- Altas y cambios ------------------------ */

  /** Sucursal y servicio de la organización, con el servicio habilitado en la sucursal. */
  async resolvePlace(tenantId: string, ref: { branchId?: string | null; branchCode?: string | null; serviceId?: string | null; serviceName?: string | null }, db: DbOrTx = this.deps.db) {
    const branchWhere = ref.branchId ? eq(branches.id, ref.branchId) : ref.branchCode ? sql`lower(${branches.code}) = lower(${ref.branchCode})` : null;
    const serviceWhere = ref.serviceId ? eq(services.id, ref.serviceId) : ref.serviceName ? sql`(lower(${services.name}) = lower(${ref.serviceName}) OR (${services.prefix} <> '' AND lower(${services.prefix}) = lower(${ref.serviceName})))` : null;
    if (!branchWhere) throw badRequest('Indique la sucursal');
    if (!serviceWhere) throw badRequest('Indique el servicio');
    const [row] = await db
      .select({ branch: branches, service: services, enabled: branchServices.enabled })
      .from(branchServices)
      .innerJoin(branches, eq(branches.id, branchServices.branchId))
      .innerJoin(services, eq(services.id, branchServices.serviceId))
      .where(and(eq(branchServices.tenantId, tenantId), branchWhere, serviceWhere))
      .limit(1);
    if (!row) throw notFound('Servicio en la sucursal');
    if (!row.branch.active || !row.service.active || !row.enabled) throw badRequest('El servicio no está disponible en esa sucursal');
    return row;
  }

  private async insert(db: DbOrTx, tenantId: string, input: AppointmentInput, source: AppointmentSource, userId: string | null) {
    const customer = sanitizeAppointmentCustomer(input.customer);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const values = {
          tenantId,
          branchId: input.branchId,
          serviceId: input.serviceId,
          code: randomCode(),
          externalId: input.externalId || null,
          source,
          status: input.status ?? 'booked',
          scheduledAt: input.scheduledAt,
          durationMinutes: input.durationMinutes ?? 15,
          customer,
          document: normalizeDocument(customer.document),
          professional: input.professional?.trim() || null,
          notes: input.notes?.slice(0, 2000) ?? '',
          publicToken: randomToken(20),
          createdBy: userId,
        } satisfies typeof appointments.$inferInsert;
        // Punto de guardado: si el código se repite, se reintenta sin anular la transacción de afuera.
        const [row] = await db.transaction((sp) => sp.insert(appointments).values(values).returning());
        return row!;
      } catch (error) {
        // Código repetido (muy raro): se prueba otro.
        if (isUniqueViolation(error, 'appointments_tenant_code_idx')) continue;
        throw error;
      }
    }
    throw new AppError(500, 'code_exhausted', 'No se pudo generar el código de la cita');
  }

  async create(tenant: Tenant, input: AppointmentInput, options: { source: AppointmentSource; userId?: string | null; notify?: boolean }) {
    await this.resolvePlace(tenant.id, input);
    const row = await this.insert(this.deps.db, tenant.id, input, options.source, options.userId ?? null);
    const dto = await this.emit(tenant.id, row.id, 'appointment.created');
    if (options.notify !== false) void this.notify(tenant, row.id, 'confirmation');
    return dto;
  }

  /**
   * Crea o actualiza una cita por su identificador en el sistema de origen (integraciones).
   * Devuelve si se creó.
   */
  async upsertExternal(
    tenant: Tenant,
    externalId: string,
    input: AppointmentInput,
    options: { source: AppointmentSource; userId?: string | null; notify?: boolean },
  ): Promise<{ created: boolean; appointment: AppointmentDTO }> {
    const existing = await this.find(tenant.id, eq(appointments.externalId, externalId));
    if (!existing) {
      try {
        return { created: true, appointment: await this.create(tenant, { ...input, externalId }, options) };
      } catch (error) {
        // Otra sincronización la creó al mismo tiempo: se actualiza esa.
        if (!isUniqueViolation(error, 'appointments_external_idx')) throw error;
        return this.upsertExternal(tenant, externalId, input, options);
      }
    }
    return { created: false, appointment: await this.update(tenant, existing.appointment.id, input) };
  }

  async update(tenant: Tenant, id: string, patch: Partial<AppointmentInput>) {
    const current = (await this.get(tenant.id, id)).appointment;
    if (!ACTIVE_APPOINTMENT_STATUSES.includes(current.status)) throw conflict('Solo se pueden modificar citas agendadas o confirmadas');
    const next = { branchId: patch.branchId ?? current.branchId, serviceId: patch.serviceId ?? current.serviceId };
    if (patch.branchId || patch.serviceId) await this.resolvePlace(tenant.id, next);
    const customer = patch.customer ? sanitizeAppointmentCustomer(patch.customer) : undefined;
    const rescheduled = patch.scheduledAt && patch.scheduledAt.getTime() !== current.scheduledAt.getTime();
    await this.deps.db
      .update(appointments)
      .set({
        ...next,
        ...(patch.scheduledAt ? { scheduledAt: patch.scheduledAt } : {}),
        ...(rescheduled ? { reminderSentAt: null } : {}),
        ...(patch.durationMinutes !== undefined ? { durationMinutes: patch.durationMinutes } : {}),
        ...(customer ? { customer, document: normalizeDocument(customer.document) } : {}),
        ...(patch.professional !== undefined ? { professional: patch.professional?.trim() || null } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes.slice(0, 2000) } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(appointments.id, id), eq(appointments.tenantId, tenant.id)));
    return this.emit(tenant.id, id, 'appointment.updated');
  }

  async cancel(tenant: Tenant, id: string, reason: string | null, options: { notify?: boolean } = {}) {
    const [row] = await this.deps.db
      .update(appointments)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason?.slice(0, 300) || null, updatedAt: new Date() })
      .where(and(eq(appointments.id, id), eq(appointments.tenantId, tenant.id), inArray(appointments.status, [...ACTIVE_APPOINTMENT_STATUSES])))
      .returning({ id: appointments.id });
    if (!row) {
      await this.get(tenant.id, id);
      throw conflict('La cita ya no se puede cancelar');
    }
    if (options.notify) void this.notify(tenant, id, 'cancelled');
    return this.emit(tenant.id, id, 'appointment.cancelled');
  }

  async markNoShow(tenantId: string, id: string) {
    const [row] = await this.deps.db
      .update(appointments)
      .set({ status: 'no_show', updatedAt: new Date() })
      .where(and(eq(appointments.id, id), eq(appointments.tenantId, tenantId), inArray(appointments.status, [...ACTIVE_APPOINTMENT_STATUSES])))
      .returning({ id: appointments.id });
    if (!row) {
      await this.get(tenantId, id);
      throw conflict('Solo una cita agendada o confirmada puede marcarse como «No vino»');
    }
    return this.emit(tenantId, id, 'appointment.no_show');
  }

  /** Avisa al panel y a las integraciones. */
  private async emit(tenantId: string, id: string, event: WebhookEvent, extra: Record<string, unknown> = {}) {
    const dto = this.toDTO((await this.find(tenantId, eq(appointments.id, id)))!);
    this.deps.rt.emit(rooms.tenant(tenantId), RT.appointmentsChanged, { id, event });
    void this.deps.webhooks.dispatch(tenantId, event, { appointment: dto, ...extra }).catch((error) => this.deps.log.error({ err: error }, 'webhooks: cita'));
    return dto;
  }

  /* ------------------------------ Llegada ------------------------------ */

  /** ¿Se puede presentar ahora? Devuelve el motivo si no. */
  checkInWindow(tenant: Tenant, a: Pick<Appointment, 'scheduledAt' | 'status'>, tz: string, now = new Date()) {
    const s = tenantSettings(tenant).appointments.checkIn;
    if (a.status === 'checked_in' || a.status === 'completed') return { ok: false, reason: 'Ya se presentó: espere el llamado en la pantalla.' };
    if (!ACTIVE_APPOINTMENT_STATUSES.includes(a.status)) return { ok: false, reason: 'La cita no está vigente. Acérquese a recepción.' };
    const opens = a.scheduledAt.getTime() - s.before * 60_000;
    const closes = a.scheduledAt.getTime() + s.after * 60_000;
    if (now.getTime() < opens) return { ok: false, reason: `Todavía es temprano: puede presentarse desde las ${localParts(new Date(opens), tz).time}.` };
    if (now.getTime() > closes) return { ok: false, reason: 'Pasó el horario de tolerancia de su cita. Acérquese a recepción.' };
    return { ok: true, reason: null };
  }

  /** Emite el turno de la cita. `force` permite presentarse fuera de la ventana (recepción). */
  async checkIn(tenant: Tenant, id: string, options: { channel: TicketChannel; userId?: string | null; priorityId?: string | null; force?: boolean }) {
    const row = await this.get(tenant.id, id);
    const a = row.appointment;
    const tz = row.branch.timezone ?? tenantSettings(tenant).timezone;
    const window = this.checkInWindow(tenant, a, tz);
    if (!window.ok && !(options.force && ACTIVE_APPOINTMENT_STATUSES.includes(a.status))) {
      // Fuera de horario la recepción puede confirmar y dar llegada igual (force).
      throw new AppError(409, ACTIVE_APPOINTMENT_STATUSES.includes(a.status) ? 'outside_window' : 'not_active', window.reason ?? 'No se puede presentar');
    }

    // Se toma la cita primero (atómico): aunque se presente desde dos lugares a la vez, sale un solo turno.
    const now = new Date();
    const [claimed] = await this.deps.db
      .update(appointments)
      .set({ status: 'checked_in', checkedInAt: now, updatedAt: now })
      .where(and(eq(appointments.id, id), inArray(appointments.status, [...ACTIVE_APPOINTMENT_STATUSES])))
      .returning({ id: appointments.id });
    if (!claimed) throw conflict('La cita ya fue presentada');

    const s = tenantSettings(tenant).appointments.checkIn;
    // Si llega antes espera su horario; si llega tarde (dentro de la tolerancia) conserva su lugar.
    const sortAt = s.byAppointmentTime ? new Date(Math.max(a.scheduledAt.getTime(), now.getTime() - s.after * 60_000)) : now;
    const time = localParts(a.scheduledAt, tz).time;
    try {
      const result = await issueTicket(this.deps, {
        tenantId: tenant.id,
        branchId: a.branchId,
        serviceId: a.serviceId,
        priorityId: options.priorityId ?? s.priorityId ?? null,
        customer: a.customer,
        notes: `Cita de las ${time}${a.professional ? ` · ${a.professional}` : ''}${a.notes ? ` · ${a.notes}` : ''}`,
        channel: options.channel,
        userId: options.userId ?? null,
        sortAt,
        appointmentId: a.id,
      });
      await this.deps.db.update(appointments).set({ ticketId: result.ticket.id }).where(eq(appointments.id, id));
      const appointment = await this.emit(tenant.id, id, 'appointment.checked_in', { ticket: result.ticket });
      return { ...result, appointment, trackingUrl: `${this.base}/t/${result.ticket.publicToken}` };
    } catch (error) {
      // Sin turno, la cita vuelve a quedar pendiente.
      await this.deps.db.update(appointments).set({ status: a.status, checkedInAt: null }).where(eq(appointments.id, id));
      if (error instanceof AppError && error.code === 'not_found' && options.priorityId === undefined && s.priorityId) {
        throw badRequest('La prioridad configurada para las citas ya no existe: revise Configuración → Citas');
      }
      throw error;
    }
  }

  /** Citas de hoy en la sucursal que coinciden con el documento o el código (kiosco). */
  async lookupToday(tenant: Tenant, branchId: string, query: string): Promise<{ rows: Row[]; matches: KioskAppointmentMatchDTO[] }> {
    const q = query.trim().toUpperCase();
    const doc = normalizeDocument(q);
    if (!doc) return { rows: [], matches: [] };
    const [branch] = await this.deps.db.select({ timezone: branches.timezone }).from(branches).where(eq(branches.id, branchId)).limit(1);
    const tz = branch?.timezone ?? tenantSettings(tenant).timezone;
    const today = dayInTimezone(new Date(), tz);
    const rows = await this.select()
      .where(
        and(
          eq(appointments.tenantId, tenant.id),
          eq(appointments.branchId, branchId),
          gte(appointments.scheduledAt, localToUtc(today, 0, tz)),
          lt(appointments.scheduledAt, localToUtc(addDays(today, 1), 0, tz)),
          inArray(appointments.status, ['booked', 'confirmed', 'checked_in']),
          sql`(${appointments.document} = ${doc} OR ${appointments.code} = ${q})`,
        ),
      )
      .orderBy(asc(appointments.scheduledAt))
      .limit(10);
    const matches = rows.map((r) => {
      const w = this.checkInWindow(tenant, r.appointment, tz);
      return {
        id: r.appointment.id,
        time: localParts(r.appointment.scheduledAt, tz).time,
        service: r.service.name,
        customer: shortName(r.appointment.customer?.name),
        professional: r.appointment.professional,
        canCheckIn: w.ok,
        reason: w.reason,
      };
    });
    return { rows, matches };
  }

  /** Al terminar la atención del turno, la cita queda como atendida. */
  async onTicketFinished(appointmentId: string) {
    const [row] = await this.deps.db
      .update(appointments)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(and(eq(appointments.id, appointmentId), eq(appointments.status, 'checked_in')))
      .returning({ tenantId: appointments.tenantId });
    if (row) this.deps.rt.emit(rooms.tenant(row.tenantId), RT.appointmentsChanged, { id: appointmentId, event: 'completed' });
  }

  /* --------------------------- Disponibilidad -------------------------- */

  /** Horarios libres de un servicio en una sucursal, día por día. */
  async availability(tenant: Tenant, input: { branchId: string; serviceId: string; from: string; days: number; online: boolean }, now = new Date()): Promise<AvailabilityDayDTO[]> {
    const days = await this.slots(tenant, input, now);
    return days.map((d) => ({ date: d.date, slots: d.slots.map(({ time, at, available }) => ({ time, at, available })) }));
  }

  private async slots(tenant: Tenant, input: { branchId: string; serviceId: string; from: string; days: number; online: boolean }, now = new Date()) {
    const settings = tenantSettings(tenant).appointments;
    const place = await this.resolvePlace(tenant.id, input);
    const tz = place.branch.timezone ?? tenantSettings(tenant).timezone;
    const schedules = await this.deps.db
      .select()
      .from(bookingSchedules)
      .where(
        and(
          eq(bookingSchedules.tenantId, tenant.id),
          eq(bookingSchedules.branchId, input.branchId),
          eq(bookingSchedules.serviceId, input.serviceId),
          eq(bookingSchedules.active, true),
          input.online ? eq(bookingSchedules.online, true) : undefined,
        ),
      );
    const days = Math.min(Math.max(input.days, 1), 62);
    const today = dayInTimezone(now, tz);
    const last = input.online ? addDays(today, settings.booking.daysAhead) : addDays(today, 365);
    const cutoff = input.online ? now.getTime() + settings.booking.minNoticeMinutes * 60_000 : now.getTime();
    const start = input.from < today ? today : input.from;
    const rangeFrom = localToUtc(start, 0, tz);
    const rangeTo = localToUtc(addDays(start, days), 0, tz);
    const taken = await this.deps.db
      .select({ at: appointments.scheduledAt, n: sql<number>`count(*)::int` })
      .from(appointments)
      .where(
        and(
          eq(appointments.branchId, input.branchId),
          eq(appointments.serviceId, input.serviceId),
          gte(appointments.scheduledAt, rangeFrom),
          lt(appointments.scheduledAt, rangeTo),
          inArray(appointments.status, ['booked', 'confirmed', 'checked_in', 'completed']),
        ),
      )
      .groupBy(appointments.scheduledAt);
    const used = new Map(taken.map((t) => [t.at.getTime(), t.n]));
    const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const out: { date: string; slots: (SlotDTO & { capacity: number })[] }[] = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(start, i);
      if (date > last) break;
      const slots = new Map<number, SlotDTO & { capacity: number }>();
      if (!settings.booking.closedDates.includes(date)) {
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
        for (const sch of schedules.filter((x) => x.days.includes(weekday))) {
          for (let m = toMin(sch.from); m + sch.slotMinutes <= toMin(sch.to); m += sch.slotMinutes) {
            const at = localToUtc(date, m, tz);
            const prev = slots.get(at.getTime());
            const capacity = (prev?.capacity ?? 0) + sch.capacity;
            slots.set(at.getTime(), { time: localParts(at, tz).time, at: at.toISOString(), capacity, available: 0 });
          }
        }
      }
      const list = [...slots.entries()]
        .filter(([ms]) => ms >= cutoff)
        .sort(([a], [b]) => a - b)
        .map(([ms, s]) => ({ time: s.time, at: s.at, capacity: s.capacity, available: Math.max(0, s.capacity - (used.get(ms) ?? 0)) }));
      out.push({ date, slots: list });
    }
    return out;
  }

  /** Reserva en línea: valida el horario y la disponibilidad con bloqueo (no se sobrevende). */
  async book(tenant: Tenant, input: AppointmentInput) {
    const settings = tenantSettings(tenant).appointments.booking;
    const customer = sanitizeAppointmentCustomer(input.customer);
    if (!customer.name) throw badRequest('Indique su nombre');
    if (settings.requireDocument && !normalizeDocument(customer.document)) throw badRequest('Indique su documento');
    if (settings.requirePhone && !customer.phone) throw badRequest('Indique su teléfono');
    if (settings.requireEmail && !customer.email) throw badRequest('Indique su correo');
    if (customer.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) throw badRequest('Correo inválido');

    const place = await this.resolvePlace(tenant.id, input);
    const tz = place.branch.timezone ?? tenantSettings(tenant).timezone;
    const day = dayInTimezone(input.scheduledAt, tz);
    const [availability] = await this.slots(tenant, { branchId: input.branchId, serviceId: input.serviceId, from: day, days: 1, online: true });
    const slot = availability?.date === day ? availability.slots.find((s) => s.at === input.scheduledAt.toISOString()) : undefined;
    if (!slot || slot.available <= 0) throw conflict('Ese horario no está disponible. Elija otro.');

    const doc = normalizeDocument(customer.document);
    const id = await this.deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`appt:${input.branchId}:${input.serviceId}:${input.scheduledAt.toISOString()}`}))`);
      if (doc) {
        const [dup] = await tx
          .select({ id: appointments.id })
          .from(appointments)
          .where(
            and(
              eq(appointments.tenantId, tenant.id),
              eq(appointments.serviceId, input.serviceId),
              eq(appointments.document, doc),
              inArray(appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
              gte(appointments.scheduledAt, localToUtc(day, 0, tz)),
              lt(appointments.scheduledAt, localToUtc(addDays(day, 1), 0, tz)),
            ),
          )
          .limit(1);
        if (dup) throw conflict('Ya tiene una cita ese día para este servicio');
      }
      const [{ n }] = (
        await tx.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM appointments
          WHERE branch_id = ${input.branchId} AND service_id = ${input.serviceId} AND scheduled_at = ${input.scheduledAt.toISOString()}
            AND status IN ('booked', 'confirmed', 'checked_in', 'completed')`)
      ).rows as [{ n: number }];
      // Se vuelve a contar dentro del bloqueo: dos reservas simultáneas no superan el cupo.
      if (n >= slot.capacity) throw conflict('Ese horario se acaba de ocupar. Elija otro.');
      const row = await this.insert(tx, tenant.id, { ...input, customer, status: 'booked' }, 'online', null);
      return row.id;
    });
    void this.notify(tenant, id, 'confirmation');
    await this.emit(tenant.id, id, 'appointment.created');
    return this.publicView(tenant, (await this.find(tenant.id, eq(appointments.id, id)))!);
  }

  /* ---------------------------- Vista pública -------------------------- */

  publicView(tenant: Tenant, r: Row): PublicAppointmentDTO & { token: string; manageUrl: string } {
    const settings = tenantSettings(tenant);
    const tz = r.branch.timezone ?? settings.timezone;
    const a = r.appointment;
    const cancelUntil = a.scheduledAt.getTime() - settings.appointments.booking.cancelUntilHours * 3_600_000;
    return {
      token: a.publicToken,
      manageUrl: this.manageUrl(a.publicToken),
      code: a.code,
      status: a.status,
      scheduledAt: a.scheduledAt.toISOString(),
      date: this.formatDate(a.scheduledAt, tz, settings.locale),
      time: localParts(a.scheduledAt, tz).time,
      service: r.service.name,
      branch: { name: r.branch.name, address: r.branch.address },
      organization: { name: tenant.name, logoUrl: settings.branding.logoUrl ?? null, primaryColor: settings.branding.primaryColor },
      professional: a.professional,
      customerName: shortName(a.customer?.name),
      canCancel: ACTIVE_APPOINTMENT_STATUSES.includes(a.status) && Date.now() < cancelUntil,
      trackingUrl: null,
    };
  }

  formatDate(date: Date, tz: string, locale = 'es') {
    try {
      return new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
    } catch {
      return dayInTimezone(date, tz);
    }
  }

  /* ----------------------- Mensajes al cliente ------------------------- */

  /** Confirmación, recordatorio o cancelación por WhatsApp/SMS (módulo de avisos) y correo. */
  async notify(tenant: Tenant, id: string, kind: 'confirmation' | 'reminder' | 'cancelled') {
    try {
      const r = await this.find(tenant.id, eq(appointments.id, id));
      if (!r) return;
      const settings = tenantSettings(tenant);
      const cfg = kind === 'cancelled' ? null : settings.appointments[kind];
      if (cfg && !cfg.enabled) return;
      const view = this.publicView(tenant, r);
      const vars = {
        name: (r.appointment.customer?.name ?? '').split(' ')[0] ?? '',
        date: view.date,
        time: view.time,
        service: r.service.name,
        branch: r.branch.name,
        address: r.branch.address,
        professional: r.appointment.professional ?? '',
        code: r.appointment.code,
        link: view.manageUrl,
        organization: tenant.name,
      };
      const phone = r.appointment.customer?.phone;
      if (cfg && phone && (await this.deps.modulesOf(tenant)).includes('notifications')) {
        await this.deps.notifier.sendText(tenant, phone, renderTemplate(cfg.template, vars).slice(0, 1000), kind === 'reminder' ? 'reminder' : 'appointment');
      }
      const email = r.appointment.customer?.email;
      if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        const brand = await this.deps.emailBrand(tenant);
        await this.deps.mailer.send(
          appointmentMail(email, kind, { ...vars, name: r.appointment.customer?.name ?? '', professional: r.appointment.professional, organization: tenant.name }, view.manageUrl, brand),
          { tenantId: tenant.id },
        );
      }
    } catch (error) {
      this.deps.log.warn({ err: error, appointmentId: id }, 'citas: no se pudo avisar al cliente');
    }
  }

  /** Recordatorios y «No vino»: se ejecuta cada 5 minutos. */
  async processDue(now = new Date()) {
    if (this.running) return { reminders: 0, noShows: 0 };
    this.running = true;
    try {
      const candidates = await this.deps.db
        .select({ appointment: appointments, tenant: tenants })
        .from(appointments)
        .innerJoin(tenants, eq(tenants.id, appointments.tenantId))
        .where(
          and(
            inArray(appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
            eq(tenants.status, 'active'),
            gte(appointments.scheduledAt, new Date(now.getTime() - 2 * 86_400_000)),
            lt(appointments.scheduledAt, new Date(now.getTime() + 7 * 86_400_000)),
          ),
        )
        .limit(5000);
      const modules = new Map<string, boolean>();
      let reminders = 0;
      let noShows = 0;
      for (const { appointment: a, tenant } of candidates) {
        if (!modules.has(tenant.id)) modules.set(tenant.id, (await this.deps.modulesOf(tenant)).includes('appointments'));
        if (!modules.get(tenant.id)) continue;
        const s = tenantSettings(tenant).appointments;
        const until = a.scheduledAt.getTime() - now.getTime();
        if (until > 0) {
          // Recordatorio: dentro del plazo, y solo si la cita no se agendó hace un rato.
          if (a.reminderSentAt || !s.reminder.enabled || until > s.reminderHours * 3_600_000) continue;
          if (a.scheduledAt.getTime() - a.createdAt.getTime() < 3 * 3_600_000) continue;
          const [claimed] = await this.deps.db
            .update(appointments)
            .set({ reminderSentAt: now })
            .where(and(eq(appointments.id, a.id), isNull(appointments.reminderSentAt)))
            .returning({ id: appointments.id });
          if (claimed) {
            reminders++;
            await this.notify(tenant, a.id, 'reminder');
          }
        } else if (s.noShowAfter > 0 && -until > s.noShowAfter * 60_000) {
          await this.markNoShow(tenant.id, a.id).then(
            () => noShows++,
            () => undefined,
          );
        }
      }
      return { reminders, noShows };
    } finally {
      this.running = false;
    }
  }
}
