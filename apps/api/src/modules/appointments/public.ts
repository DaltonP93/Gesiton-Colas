import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AvailabilityDayDTO, BookingPageDTO, BookingResultDTO, PublicAppointmentDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { appointments, bookingSchedules, branchServices, branches, services, tenants, tickets } from '../../db/schema';
import { assertModuleActive, assertTenantAvailable } from '../../lib/auth';
import { tenantSettings, toPublicTenantDTO } from '../../lib/dto';
import { conflict, notFound } from '../../lib/errors';
import { dayInTimezone } from '../../lib/tz';

const slugParam = z.object({ slug: z.string().trim().min(1).max(80) });
const tokenParam = z.object({ token: z.string().min(10).max(64) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const customer = z.object({
  name: z.string().trim().min(2, 'Indique su nombre').max(120),
  document: z.string().trim().max(30).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.union([z.literal(''), z.email().max(200)]).optional(),
});

/** Reserva en línea (/reservar/<organización>) y enlace del cliente para ver o cancelar su cita. */
export const bookingRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Público (reserva de citas)'];

  async function bookingTenant(slug: string) {
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.slug, slug.toLowerCase())).limit(1);
    if (!tenant) throw notFound('Organización');
    assertTenantAvailable(tenant);
    await assertModuleActive(ctx.modulesOf, tenant, 'appointments');
    if (!tenantSettings(tenant).appointments.booking.enabled) throw notFound('Reserva en línea');
    return tenant;
  }

  app.get('/public/booking/:slug', { schema: { tags, summary: 'Sucursales y servicios con reserva en línea', params: slugParam, security: [] } }, async (request): Promise<BookingPageDTO> => {
    const tenant = await bookingTenant(request.params.slug);
    const rows = await ctx.db
      .selectDistinct({ branch: branches, service: services })
      .from(bookingSchedules)
      .innerJoin(branches, eq(branches.id, bookingSchedules.branchId))
      .innerJoin(services, eq(services.id, bookingSchedules.serviceId))
      .innerJoin(branchServices, and(eq(branchServices.branchId, bookingSchedules.branchId), eq(branchServices.serviceId, bookingSchedules.serviceId)))
      .where(
        and(
          eq(bookingSchedules.tenantId, tenant.id),
          eq(bookingSchedules.active, true),
          eq(bookingSchedules.online, true),
          eq(branches.active, true),
          eq(services.active, true),
          eq(branchServices.enabled, true),
        ),
      )
      .orderBy(asc(services.sortOrder), asc(services.name));
    const branchMap = new Map<string, BookingPageDTO['branches'][number]>();
    const serviceMap = new Map<string, BookingPageDTO['services'][number]>();
    for (const r of rows) {
      branchMap.set(r.branch.id, { id: r.branch.id, name: r.branch.name, address: r.branch.address });
      const s = serviceMap.get(r.service.id) ?? { id: r.service.id, name: r.service.name, description: r.service.description, color: r.service.color, branchIds: [] };
      if (!s.branchIds.includes(r.branch.id)) s.branchIds.push(r.branch.id);
      serviceMap.set(r.service.id, s);
    }
    const b = tenantSettings(tenant).appointments.booking;
    return {
      tenant: toPublicTenantDTO(tenant),
      branches: [...branchMap.values()].sort((x, y) => x.name.localeCompare(y.name)),
      services: [...serviceMap.values()],
      booking: { daysAhead: b.daysAhead, requireDocument: b.requireDocument, requirePhone: b.requirePhone, requireEmail: b.requireEmail, message: b.message, cancelUntilHours: b.cancelUntilHours },
    };
  });

  app.get(
    '/public/booking/:slug/availability',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Horarios libres para reservar',
        params: slugParam,
        security: [],
        querystring: z.object({ branchId: z.uuid(), serviceId: z.uuid(), from: day.optional(), days: z.coerce.number().int().min(1).max(31).default(14) }),
      },
    },
    async (request): Promise<AvailabilityDayDTO[]> => {
      const tenant = await bookingTenant(request.params.slug);
      const from = request.query.from ?? dayInTimezone(new Date(), tenantSettings(tenant).timezone);
      return ctx.appointments.availability(tenant, { ...request.query, from, online: true });
    },
  );

  app.post(
    '/public/booking/:slug',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Reservar una cita',
        params: slugParam,
        security: [],
        body: z.object({ branchId: z.uuid(), serviceId: z.uuid(), scheduledAt: z.iso.datetime({ offset: true }), customer }),
      },
    },
    async (request, reply): Promise<BookingResultDTO> => {
      const tenant = await bookingTenant(request.params.slug);
      const result = await ctx.appointments.book(tenant, { ...request.body, scheduledAt: new Date(request.body.scheduledAt), customer: request.body.customer });
      return reply.code(201).send(result);
    },
  );

  /* ---------------------- Enlace del cliente ---------------------- */

  async function byToken(token: string) {
    const [row] = await ctx.db.select({ appointment: appointments, tenant: tenants }).from(appointments).innerJoin(tenants, eq(tenants.id, appointments.tenantId)).where(eq(appointments.publicToken, token)).limit(1);
    if (!row) throw notFound('Cita');
    return row;
  }

  async function view(token: string): Promise<PublicAppointmentDTO> {
    const { appointment, tenant } = await byToken(token);
    const full = (await ctx.appointments.find(tenant.id, eq(appointments.id, appointment.id)))!;
    const out = ctx.appointments.publicView(tenant, full);
    let trackingUrl: string | null = null;
    if (appointment.ticketId && ['checked_in'].includes(appointment.status)) {
      const [t] = await ctx.db.select({ token: tickets.publicToken }).from(tickets).where(eq(tickets.id, appointment.ticketId));
      if (t) trackingUrl = `${ctx.config.PUBLIC_URL.replace(/\/$/, '')}/t/${t.token}`;
    }
    const { token: _token, manageUrl: _url, ...rest } = out;
    return { ...rest, canCancel: out.canCancel && tenant.status === 'active', trackingUrl };
  }

  app.get('/public/appointments/:token', { schema: { tags, summary: 'Ver una cita (enlace del cliente)', params: tokenParam, security: [] } }, async (request) => view(request.params.token));

  app.post(
    '/public/appointments/:token/cancel',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags, summary: 'Cancelar la cita (enlace del cliente)', params: tokenParam, security: [] } },
    async (request): Promise<PublicAppointmentDTO> => {
      const current = await view(request.params.token);
      if (!current.canCancel) throw conflict('La cita ya no se puede cancelar desde aquí. Comuníquese con la organización.');
      const { appointment, tenant } = await byToken(request.params.token);
      await ctx.appointments.cancel(tenant, appointment.id, 'Cancelada por el cliente', { notify: true });
      return view(request.params.token);
    },
  );
};
