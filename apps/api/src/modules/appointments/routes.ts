import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  bookingScheduleSchema,
  type AppointmentImportResultDTO,
  type AppointmentPageDTO,
  type BookingScheduleDTO,
} from '@gc/shared';
import type { AppContext } from '../../context';
import { appointments, bookingSchedules, branches, type BookingSchedule } from '../../db/schema';
import type { AppointmentInput } from '../../lib/appointments';
import { tenantIdOf, userIdOf } from '../../lib/auth';
import { parseCsv, toCsv } from '../../lib/csv';
import { tenantSettings } from '../../lib/dto';
import { AppError, badRequest, forbidden, isUniqueViolation, notFound } from '../../lib/errors';
import { addDays, dayInTimezone, localParts, localToUtc } from '../../lib/tz';

const idParam = z.object({ id: z.uuid() });
const externalParam = z.object({ externalId: z.string().trim().min(1).max(120) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');

const customer = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/), z.string().max(300));

/** Sucursal y servicio por id o, para otros sistemas, por código de sucursal y nombre/prefijo del servicio. */
const place = {
  branchId: z.uuid().optional(),
  branchCode: z.string().trim().max(40).optional(),
  serviceId: z.uuid().optional(),
  serviceName: z.string().trim().max(120).optional(),
};

const appointmentBody = z.object({
  ...place,
  scheduledAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  customer: customer.default({}),
  professional: z.string().trim().max(120).nullish(),
  notes: z.string().max(2000).optional(),
  externalId: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['booked', 'confirmed']).optional(),
  /** Enviar la confirmación al cliente (WhatsApp/SMS/correo). Por defecto, sí. */
  notify: z.boolean().optional(),
});

// Sin valores por defecto: lo que no se envía queda como está.
const appointmentPatch = z.object({
  ...place,
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  customer: customer.optional(),
  professional: z.string().trim().max(120).nullish(),
  notes: z.string().max(2000).optional(),
  status: z.enum(['booked', 'confirmed']).optional(),
});

const listQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  branchId: z.uuid().optional(),
  serviceId: z.uuid().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
});

const toScheduleDTO = (s: BookingSchedule): BookingScheduleDTO => ({
  id: s.id,
  branchId: s.branchId,
  serviceId: s.serviceId,
  days: s.days,
  from: s.from,
  to: s.to,
  slotMinutes: s.slotMinutes,
  capacity: s.capacity,
  online: s.online,
  active: s.active,
});

/** Nombres de columna aceptados en el CSV (sin acentos ni mayúsculas). */
const CSV_COLUMNS: Record<string, string> = {
  fecha: 'date',
  date: 'date',
  dia: 'date',
  hora: 'time',
  time: 'time',
  fecha_hora: 'datetime',
  fechahora: 'datetime',
  datetime: 'datetime',
  documento: 'document',
  ci: 'document',
  cedula: 'document',
  document: 'document',
  nombre: 'name',
  paciente: 'name',
  cliente: 'name',
  name: 'name',
  telefono: 'phone',
  celular: 'phone',
  phone: 'phone',
  email: 'email',
  correo: 'email',
  servicio: 'service',
  especialidad: 'service',
  service: 'service',
  sucursal: 'branch',
  branch: 'branch',
  profesional: 'professional',
  medico: 'professional',
  doctor: 'professional',
  professional: 'professional',
  notas: 'notes',
  observaciones: 'notes',
  notes: 'notes',
  id_externo: 'externalId',
  id: 'externalId',
  external_id: 'externalId',
  duracion: 'duration',
  duration: 'duration',
};

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');

/** 05/10/2026, 5-10-2026 o 2026-10-05 → 2026-10-05. */
function parseDay(value: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!y || !m || !d) return null;
  // Date normaliza fechas imposibles (31/02 → 03/03): se exige que el día exista.
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseTime(value: string): number | null {
  const m = /^(\d{1,2})[:.h](\d{2})(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(value.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const pm = m[3]?.toLowerCase().startsWith('p');
  if (m[3] && h === 12) h = 0;
  if (pm) h += 12;
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Citas: agenda del personal, integración con otros sistemas (API / CSV) y horarios. */
export const appointmentRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Citas'];
  const module = 'appointments' as const;
  const read = ctx.auth.require({ role: 'agent', module, scope: 'appointments:read' });
  const write = ctx.auth.require({ role: 'agent', module, scope: 'appointments:write' });
  const manager = ctx.auth.require({ role: 'manager', module, scope: 'appointments:write' });
  const admin = ctx.auth.require({ role: 'admin', module });

  const tenantOf = (request: FastifyRequest) => {
    const tenant = request.auth?.tenant;
    if (!tenant) throw forbidden('Esta acción requiere operar dentro de una organización');
    return tenant;
  };

  /** Convierte el cuerpo (con sucursal/servicio por id o por código) en los datos de la cita. */
  async function toInput(tenantId: string, body: z.infer<typeof appointmentPatch>, current?: { branchId: string; serviceId: string }): Promise<Partial<AppointmentInput>> {
    const hasPlace = body.branchId || body.branchCode || body.serviceId || body.serviceName;
    const placeRow = hasPlace
      ? await ctx.appointments.resolvePlace(tenantId, {
          branchId: body.branchId ?? (body.branchCode ? null : current?.branchId),
          branchCode: body.branchCode,
          serviceId: body.serviceId ?? (body.serviceName ? null : current?.serviceId),
          serviceName: body.serviceName,
        })
      : null;
    return {
      ...(placeRow ? { branchId: placeRow.branch.id, serviceId: placeRow.service.id } : {}),
      ...(body.scheduledAt ? { scheduledAt: new Date(body.scheduledAt) } : {}),
      ...(body.durationMinutes !== undefined ? { durationMinutes: body.durationMinutes } : {}),
      ...(body.customer ? { customer: body.customer } : {}),
      ...(body.professional !== undefined ? { professional: body.professional } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.status ? { status: body.status } : {}),
    };
  }

  /** Rango de días (zona de la sucursal o de la organización); por defecto, hoy. */
  async function range(tenant: NonNullable<FastifyRequest['auth']>['tenant'], query: z.infer<typeof listQuery>) {
    let tz = tenantSettings(tenant!).timezone;
    if (query.branchId) {
      const [b] = await ctx.db.select({ timezone: branches.timezone }).from(branches).where(and(eq(branches.id, query.branchId), eq(branches.tenantId, tenant!.id)));
      if (!b) throw notFound('Sucursal');
      tz = b.timezone ?? tz;
    }
    const from = query.from ?? dayInTimezone(new Date(), tz);
    const to = query.to ?? from;
    if (to < from) throw badRequest('La fecha final es anterior a la inicial');
    if (addDays(from, 92) < to) throw badRequest('Consulte como máximo 3 meses por vez');
    return { from: localToUtc(from, 0, tz), to: localToUtc(addDays(to, 1), 0, tz), tz };
  }

  /* ------------------------------- Agenda ------------------------------- */

  app.get('/appointments', { preHandler: read, schema: { tags, summary: 'Citas de un día o un rango (filtros por sucursal, servicio, estado o búsqueda)', querystring: listQuery } }, async (request): Promise<AppointmentPageDTO> => {
    const tenant = tenantOf(request);
    const { from, to } = await range(tenant, request.query);
    return ctx.appointments.list(tenant.id, { ...request.query, from, to });
  });

  app.get('/appointments.csv', { preHandler: manager, schema: { tags, summary: 'Exportar citas (CSV)', querystring: listQuery } }, async (request, reply) => {
    const tenant = tenantOf(request);
    const { from, to, tz } = await range(tenant, request.query);
    const { items } = await ctx.appointments.list(tenant.id, { ...request.query, from, to, limit: 20_000 });
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="citas_${dayInTimezone(from, tz)}.csv"`);
    return toCsv(
      ['fecha', 'hora', 'sucursal', 'servicio', 'profesional', 'nombre', 'documento', 'telefono', 'email', 'estado', 'origen', 'codigo', 'turno', 'id_externo', 'notas'],
      items.map((a) => {
        const at = localParts(new Date(a.scheduledAt), tz);
        return [at.day, at.time, a.branch.name, a.service.name, a.professional, a.customer.name, a.customer.document, a.customer.phone, a.customer.email, APPOINTMENT_STATUS_LABELS[a.status], APPOINTMENT_SOURCE_LABELS[a.source], a.code, a.ticketCode, a.externalId, a.notes];
      }),
    );
  });

  app.get(
    '/appointments/availability',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Horarios libres de un servicio en una sucursal',
        querystring: z.object({ branchId: z.uuid(), serviceId: z.uuid(), from: day.optional(), days: z.coerce.number().int().min(1).max(62).default(7) }),
      },
    },
    async (request) => {
      const tenant = tenantOf(request);
      const tz = tenantSettings(tenant).timezone;
      return ctx.appointments.availability(tenant, { ...request.query, from: request.query.from ?? dayInTimezone(new Date(), tz), online: false });
    },
  );

  app.get('/appointments/:id', { preHandler: read, schema: { tags, summary: 'Detalle de una cita', params: idParam } }, async (request) =>
    ctx.appointments.toDTO(await ctx.appointments.get(tenantIdOf(request), request.params.id)),
  );

  app.post('/appointments', { preHandler: write, schema: { tags, summary: 'Agendar una cita', body: appointmentBody } }, async (request, reply) => {
    const tenant = tenantOf(request);
    const input = (await toInput(tenant.id, request.body)) as AppointmentInput;
    if (!input.branchId) throw badRequest('Indique la sucursal y el servicio');
    try {
      const dto = await ctx.appointments.create(
        tenant,
        { ...input, externalId: request.body.externalId },
        { source: request.auth?.kind === 'apiKey' ? 'api' : 'manual', userId: userIdOf(request), notify: request.body.notify },
      );
      return reply.code(201).send(dto);
    } catch (error) {
      if (isUniqueViolation(error, 'appointments_external_idx')) {
        throw new AppError(409, 'duplicate_external_id', 'Ya existe una cita con ese identificador externo; use PUT /appointments/external/{externalId} para actualizarla');
      }
      throw error;
    }
  });

  app.put('/appointments/:id', { preHandler: write, schema: { tags, summary: 'Modificar o reprogramar una cita', params: idParam, body: appointmentPatch } }, async (request) => {
    const tenant = tenantOf(request);
    const current = (await ctx.appointments.get(tenant.id, request.params.id)).appointment;
    return ctx.appointments.update(tenant, current.id, await toInput(tenant.id, request.body, current));
  });

  const cancelBody = z.object({ reason: z.string().trim().max(300).optional(), notify: z.boolean().optional() });

  app.post('/appointments/:id/cancel', { preHandler: write, schema: { tags, summary: 'Cancelar una cita', params: idParam, body: cancelBody } }, async (request) =>
    ctx.appointments.cancel(tenantOf(request), request.params.id, request.body.reason ?? null, { notify: request.body.notify }),
  );

  app.post('/appointments/:id/no-show', { preHandler: write, schema: { tags, summary: 'Marcar que el cliente no vino', params: idParam } }, async (request) =>
    ctx.appointments.markNoShow(tenantIdOf(request), request.params.id),
  );

  const checkInBody = z.object({
    /** Dar llegada aunque esté fuera del horario permitido (recepción). */
    force: z.boolean().optional(),
    priorityId: z.uuid().nullish(),
  });

  app.post('/appointments/:id/check-in', { preHandler: write, schema: { tags, summary: 'Dar llegada: emite el turno ordenado por la hora de la cita', params: idParam, body: checkInBody } }, async (request) =>
    ctx.appointments.checkIn(tenantOf(request), request.params.id, {
      channel: request.auth?.kind === 'apiKey' ? 'api' : 'agent',
      userId: userIdOf(request),
      priorityId: request.body.priorityId ?? undefined,
      force: request.body.force,
    }),
  );

  /* ------------------- Integración por id del otro sistema ------------------- */

  app.put(
    '/appointments/external/:externalId',
    { preHandler: write, schema: { tags, summary: 'Crear o actualizar una cita por su id en su sistema (HIS, ERP, agenda)', params: externalParam, body: appointmentBody.omit({ externalId: true }) } },
    async (request, reply) => {
      const tenant = tenantOf(request);
      const input = (await toInput(tenant.id, request.body)) as AppointmentInput;
      if (!input.branchId) throw badRequest('Indique la sucursal y el servicio');
      const result = await ctx.appointments.upsertExternal(tenant, request.params.externalId, input, {
        source: request.auth?.kind === 'apiKey' ? 'api' : 'manual',
        userId: userIdOf(request),
        notify: request.body.notify,
      });
      return reply.code(result.created ? 201 : 200).send(result.appointment);
    },
  );

  const byExternal = async (tenantId: string, externalId: string) => {
    const row = await ctx.appointments.find(tenantId, eq(appointments.externalId, externalId));
    if (!row) throw notFound('Cita');
    return row.appointment.id;
  };

  app.get('/appointments/external/:externalId', { preHandler: read, schema: { tags, summary: 'Consultar una cita por su id externo', params: externalParam } }, async (request) =>
    ctx.appointments.toDTO(await ctx.appointments.get(tenantIdOf(request), await byExternal(tenantIdOf(request), request.params.externalId))),
  );

  app.post('/appointments/external/:externalId/cancel', { preHandler: write, schema: { tags, summary: 'Cancelar una cita por su id externo', params: externalParam, body: cancelBody } }, async (request) => {
    const tenant = tenantOf(request);
    return ctx.appointments.cancel(tenant, await byExternal(tenant.id, request.params.externalId), request.body.reason ?? null, { notify: request.body.notify });
  });

  app.post('/appointments/external/:externalId/check-in', { preHandler: write, schema: { tags, summary: 'Dar llegada por id externo (p. ej. desde la recepción del HIS)', params: externalParam, body: checkInBody } }, async (request) => {
    const tenant = tenantOf(request);
    return ctx.appointments.checkIn(tenant, await byExternal(tenant.id, request.params.externalId), {
      channel: request.auth?.kind === 'apiKey' ? 'api' : 'agent',
      userId: userIdOf(request),
      priorityId: request.body.priorityId ?? undefined,
      force: request.body.force,
    });
  });

  /* --------------------------------- CSV --------------------------------- */

  app.post(
    '/appointments/import',
    {
      preHandler: manager,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Importar citas desde un CSV (exportado de otro sistema)',
        body: z.object({
          csv: z.string().min(1).max(5_000_000),
          /** Sucursal y servicio para las filas que no los indiquen. */
          branchId: z.uuid().optional(),
          serviceId: z.uuid().optional(),
          notify: z.boolean().default(false),
        }),
      },
    },
    async (request): Promise<AppointmentImportResultDTO> => {
      const tenant = tenantOf(request);
      const rows = parseCsv(request.body.csv);
      if (rows.length < 2) throw badRequest('El archivo no tiene filas (la primera fila debe ser el encabezado)');
      if (rows.length > 5001) throw badRequest('Importe como máximo 5.000 citas por archivo');
      const header = rows[0]!.map((h) => CSV_COLUMNS[plain(h)] ?? null);
      const has = (k: string) => header.includes(k);
      if (!has('datetime') && !(has('date') && has('time'))) throw badRequest('Faltan las columnas «fecha» y «hora» (o «fecha_hora»)');
      if (!has('name') && !has('document')) throw badRequest('Falta la columna «nombre» o «documento»');
      if (!has('service') && !request.body.serviceId) throw badRequest('Falta la columna «servicio» (o elija un servicio para todas las filas)');
      if (!has('branch') && !request.body.branchId) throw badRequest('Falta la columna «sucursal» (o elija una sucursal para todas las filas)');

      const settings = tenantSettings(tenant);
      const result: AppointmentImportResultDTO = { created: 0, updated: 0, errors: [] };
      const places = new Map<string, Awaited<ReturnType<typeof ctx.appointments.resolvePlace>>>();
      for (let i = 1; i < rows.length; i++) {
        const line = i + 1;
        const cell = (k: string) => {
          const idx = header.indexOf(k);
          return idx >= 0 ? (rows[i]![idx] ?? '').trim() : '';
        };
        try {
          const branchRef = cell('branch');
          const serviceRef = cell('service');
          const key = `${branchRef || request.body.branchId}|${serviceRef || request.body.serviceId}`;
          let placeRow = places.get(key);
          if (!placeRow) {
            placeRow = await ctx.appointments
              .resolvePlace(tenant.id, {
                branchId: branchRef ? null : request.body.branchId,
                branchCode: branchRef || null,
                serviceId: serviceRef ? null : request.body.serviceId,
                serviceName: serviceRef || null,
              })
              .catch(async (error) => {
                // La sucursal también puede venir por nombre.
                if (!branchRef) throw error;
                const [b] = await ctx.db
                  .select({ id: branches.id })
                  .from(branches)
                  .where(and(eq(branches.tenantId, tenant.id), sql`lower(${branches.name}) = lower(${branchRef})`))
                  .limit(1);
                if (!b) throw badRequest(`No existe la sucursal «${branchRef}»`);
                return ctx.appointments.resolvePlace(tenant.id, { branchId: b.id, serviceId: serviceRef ? null : request.body.serviceId, serviceName: serviceRef || null });
              });
            places.set(key, placeRow);
          }
          const tz = placeRow.branch.timezone ?? settings.timezone;
          let scheduledAt: Date | null = null;
          if (cell('datetime')) {
            const [d, t] = cell('datetime').split(/[ T]/);
            const dd = d ? parseDay(d) : null;
            const tt = t ? parseTime(t) : null;
            if (dd && tt !== null) scheduledAt = localToUtc(dd, tt, tz);
          } else {
            const dd = parseDay(cell('date'));
            const tt = parseTime(cell('time'));
            if (dd && tt !== null) scheduledAt = localToUtc(dd, tt, tz);
          }
          if (!scheduledAt) throw badRequest('Fecha u hora inválida');
          const duration = Number(cell('duration'));
          const input: AppointmentInput = {
            branchId: placeRow.branch.id,
            serviceId: placeRow.service.id,
            scheduledAt,
            ...(duration > 0 && duration <= 1440 ? { durationMinutes: Math.round(duration) } : {}),
            customer: { name: cell('name'), document: cell('document'), phone: cell('phone'), email: cell('email') },
            professional: cell('professional') || null,
            notes: cell('notes'),
          };
          const externalId = cell('externalId');
          const options = { source: 'import' as const, userId: userIdOf(request), notify: request.body.notify };
          if (externalId) {
            const r = await ctx.appointments.upsertExternal(tenant, externalId.slice(0, 120), input, options);
            if (r.created) result.created++;
            else result.updated++;
          } else {
            await ctx.appointments.create(tenant, input, options);
            result.created++;
          }
        } catch (error) {
          if (result.errors.length < 200) result.errors.push({ line, message: error instanceof Error ? error.message : 'Error' });
        }
      }
      return result;
    },
  );

  /* ------------------------------- Horarios ------------------------------- */

  app.get('/appointment-schedules', { preHandler: ctx.auth.require({ role: 'manager', module }), schema: { tags, summary: 'Horarios de atención con cita' } }, async (request) => {
    const rows = await ctx.db.select().from(bookingSchedules).where(eq(bookingSchedules.tenantId, tenantIdOf(request))).orderBy(asc(bookingSchedules.createdAt));
    return rows.map(toScheduleDTO);
  });

  app.post('/appointment-schedules', { preHandler: admin, schema: { tags, summary: 'Agregar un horario con cita', body: bookingScheduleSchema } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    await ctx.appointments.resolvePlace(tenantId, request.body);
    const [row] = await ctx.db.insert(bookingSchedules).values({ ...request.body, days: [...new Set(request.body.days)].sort(), tenantId }).returning();
    return reply.code(201).send(toScheduleDTO(row!));
  });

  app.put('/appointment-schedules/:id', { preHandler: admin, schema: { tags, summary: 'Modificar un horario con cita', params: idParam, body: bookingScheduleSchema } }, async (request) => {
    const tenantId = tenantIdOf(request);
    await ctx.appointments.resolvePlace(tenantId, request.body);
    const [row] = await ctx.db
      .update(bookingSchedules)
      .set({ ...request.body, days: [...new Set(request.body.days)].sort() })
      .where(and(eq(bookingSchedules.id, request.params.id), eq(bookingSchedules.tenantId, tenantId)))
      .returning();
    if (!row) throw notFound('Horario');
    return toScheduleDTO(row);
  });

  app.delete('/appointment-schedules/:id', { preHandler: admin, schema: { tags, summary: 'Quitar un horario con cita', params: idParam } }, async (request, reply) => {
    const [row] = await ctx.db
      .delete(bookingSchedules)
      .where(and(eq(bookingSchedules.id, request.params.id), eq(bookingSchedules.tenantId, tenantIdOf(request))))
      .returning({ id: bookingSchedules.id });
    if (!row) throw notFound('Horario');
    return reply.code(204).send();
  });
};
