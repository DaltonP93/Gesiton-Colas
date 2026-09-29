import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BUILTIN_CUSTOMER_FIELDS,
  displayConfigSchema,
  kioskConfigSchema,
  normalizeConfig,
  type CallDTO,
  type DisplayBootstrapDTO,
  type IssuedTicketDTO,
  type KioskBootstrapDTO,
  type PublicTicketDTO,
} from '@gc/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import {
  agentWorkstations,
  branches,
  branchServices,
  departments,
  displays,
  kiosks,
  media,
  playlistItems,
  playlists,
  priorities,
  services,
  tenants,
  tickets,
} from '../../db/schema';
import {
  tenantSettings,
  toCallDTO,
  toDepartmentDTO,
  toDisplayDTO,
  toKioskDTO,
  toPlaylistDTO,
  toPlaylistItemDTO,
  toPriorityDTO,
  toPublicTenantDTO,
  toServiceDTO,
} from '../../lib/dto';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { dayInTimezone } from '../../lib/tz';
import { customerSchema } from '../tickets/routes';
import { cancelTicket, countAhead, findTickets, issueTicket, loadTicket } from '../tickets/queue';

const tokenParam = z.object({ token: z.string().min(10).max(64) });

export async function loadPlaylist(db: DbOrTx, playlistId: string | null) {
  if (!playlistId) return null;
  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, playlistId)).limit(1);
  if (!playlist) return null;
  const rows = await db
    .select({ item: playlistItems, media })
    .from(playlistItems)
    .innerJoin(media, eq(media.id, playlistItems.mediaId))
    .where(eq(playlistItems.playlistId, playlist.id))
    .orderBy(asc(playlistItems.position));
  return toPlaylistDTO(
    playlist,
    rows.map((r) => toPlaylistItemDTO(r.item, r.media)),
  );
}

export const publicRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Público (pantallas, kioscos y seguimiento)'];

  async function activeTenant(tenantId: string) {
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw notFound('Organización');
    if (tenant.status !== 'active') throw forbidden('Servicio suspendido');
    return tenant;
  }

  /* ------------------------------ Pantalla ---------------------------- */
  app.get(
    '/public/displays/:token',
    { schema: { tags, summary: 'Configuración completa de una pantalla (layout, playlist, últimos llamados)', params: tokenParam, security: [] } },
    async (request): Promise<DisplayBootstrapDTO> => {
      const [display] = await ctx.db.select().from(displays).where(eq(displays.token, request.params.token)).limit(1);
      if (!display) throw notFound('Pantalla');
      const tenant = await activeTenant(display.tenantId);
      const [branch] = await ctx.db.select().from(branches).where(eq(branches.id, display.branchId));
      const config = normalizeConfig(displayConfigSchema, display.config);
      const settings = tenantSettings(tenant);
      const day = dayInTimezone(new Date(), branch?.timezone ?? settings.timezone);

      const recent = await findTickets(
        ctx.db,
        and(
          eq(tickets.branchId, display.branchId),
          isNotNull(tickets.calledAt),
          eq(tickets.serviceDay, day),
          config.services.length ? inArray(tickets.serviceId, config.services) : undefined,
        ),
        [desc(tickets.calledAt)],
        config.historySize + 1,
      );
      const recentCalls: CallDTO[] = recent.map((t) => {
        const call = toCallDTO(t);
        if (!settings.tickets.announceCustomerName) call.customerName = null;
        return call;
      });

      await ctx.db.update(displays).set({ lastSeenAt: new Date() }).where(eq(displays.id, display.id));
      const dto = toDisplayDTO(display);
      return {
        display: { ...dto, config },
        tenant: toPublicTenantDTO(tenant),
        branch: { id: display.branchId, name: branch?.name ?? '' },
        playlist: await loadPlaylist(ctx.db, display.playlistId),
        recentCalls,
      };
    },
  );

  /* ------------------------------- Kiosco ----------------------------- */
  async function kioskContext(token: string) {
    const [kiosk] = await ctx.db.select().from(kiosks).where(eq(kiosks.token, token)).limit(1);
    if (!kiosk) throw notFound('Kiosco');
    const tenant = await activeTenant(kiosk.tenantId);
    const config = normalizeConfig(kioskConfigSchema, kiosk.config);
    return { kiosk, tenant, config };
  }

  app.get(
    '/public/kiosks/:token',
    { schema: { tags, summary: 'Configuración de un kiosco: servicios, prioridades y campos', params: tokenParam, security: [] } },
    async (request): Promise<KioskBootstrapDTO> => {
      const { kiosk, tenant, config } = await kioskContext(request.params.token);
      const [branch] = await ctx.db.select().from(branches).where(eq(branches.id, kiosk.branchId));
      const rows = await ctx.db
        .select({ service: services, prefix: branchServices.prefix })
        .from(branchServices)
        .innerJoin(services, eq(services.id, branchServices.serviceId))
        .where(
          and(
            eq(branchServices.branchId, kiosk.branchId),
            eq(branchServices.enabled, true),
            eq(services.active, true),
            config.services.length ? inArray(services.id, config.services) : undefined,
          ),
        )
        .orderBy(asc(services.sortOrder), asc(services.name));
      const waiting = await ctx.db.execute<{ service_id: string; n: number }>(sql`
        SELECT service_id, count(*)::int AS n FROM tickets
        WHERE branch_id = ${kiosk.branchId} AND status = 'waiting' GROUP BY service_id`);
      const waitingBy = new Map(waiting.rows.map((r) => [r.service_id, r.n]));
      const [deps, prios] = await Promise.all([
        ctx.db.select().from(departments).where(and(eq(departments.tenantId, tenant.id), eq(departments.active, true))).orderBy(asc(departments.sortOrder)),
        ctx.db.select().from(priorities).where(and(eq(priorities.tenantId, tenant.id), eq(priorities.active, true))).orderBy(asc(priorities.sortOrder), asc(priorities.weight)),
      ]);
      const settings = tenantSettings(tenant);
      await ctx.db.update(kiosks).set({ lastSeenAt: new Date() }).where(eq(kiosks.id, kiosk.id));
      return {
        kiosk: { ...toKioskDTO(kiosk), config },
        tenant: toPublicTenantDTO(tenant),
        branch: { id: kiosk.branchId, name: branch?.name ?? '' },
        departments: deps.map(toDepartmentDTO),
        services: rows.map((r) => ({
          ...toServiceDTO(r.service),
          effectivePrefix: r.prefix ?? r.service.prefix,
          waiting: waitingBy.get(r.service.id) ?? 0,
        })),
        priorities: prios.map(toPriorityDTO),
        customerFields: [...BUILTIN_CUSTOMER_FIELDS, ...settings.customerFields],
      };
    },
  );

  app.post(
    '/public/kiosks/:token/tickets',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Emitir un turno desde un kiosco o desde el celular (fila virtual)',
        params: tokenParam,
        security: [],
        body: z.object({
          serviceId: z.uuid(),
          priorityId: z.uuid().nullish(),
          customer: customerSchema,
          channel: z.enum(['kiosk', 'mobile']).default('kiosk'),
        }),
      },
    },
    async (request, reply): Promise<IssuedTicketDTO> => {
      const { kiosk, tenant, config } = await kioskContext(request.params.token);
      if (config.services.length && !config.services.includes(request.body.serviceId)) {
        throw badRequest('El servicio no está disponible en este kiosco');
      }
      if (config.priorityMode === 'none' && request.body.priorityId) throw badRequest('Este kiosco no emite turnos preferenciales');
      const settings = tenantSettings(tenant);
      const customer = (request.body.customer ?? {}) as Record<string, string | null>;
      const fields = [...BUILTIN_CUSTOMER_FIELDS, ...settings.customerFields];
      for (const key of config.askFields) {
        const field = fields.find((f) => f.key === key);
        if (field?.required && !customer[key]) throw badRequest(`El campo "${field.label}" es obligatorio`);
      }
      const allowed = Object.fromEntries(Object.entries(customer).filter(([k]) => config.askFields.includes(k)));
      const result = await issueTicket(ctx, {
        tenantId: tenant.id,
        branchId: kiosk.branchId,
        serviceId: request.body.serviceId,
        priorityId: config.priorityMode === 'none' ? null : request.body.priorityId,
        customer: allowed,
        channel: request.body.channel,
      });
      reply.code(201);
      return { ...result, trackingUrl: `${ctx.config.PUBLIC_URL.replace(/\/$/, '')}/t/${result.ticket.publicToken}` };
    },
  );

  /* --------------------------- Seguimiento ---------------------------- */
  async function trackedTicket(token: string) {
    const [row] = await ctx.db.select().from(tickets).where(eq(tickets.publicToken, token)).limit(1);
    if (!row) throw notFound('Turno');
    return row;
  }

  app.get(
    '/public/tickets/:token',
    { schema: { tags, summary: 'Seguimiento de un turno desde el celular', params: tokenParam, security: [] } },
    async (request): Promise<PublicTicketDTO> => {
      const row = await trackedTicket(request.params.token);
      const tenant = await activeTenant(row.tenantId);
      const ticket = await loadTicket(ctx.db, row.tenantId, row.id);
      const [branch] = await ctx.db.select({ name: branches.name }).from(branches).where(eq(branches.id, row.branchId));
      const [service] = await ctx.db.select().from(services).where(eq(services.id, row.serviceId));
      let waitingAhead = 0;
      let estimatedMinutes: number | null = null;
      if (ticket.status === 'waiting') {
        waitingAhead = await countAhead(ctx.db, ticket);
        const agents = await ctx.db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM ${agentWorkstations}
          WHERE branch_id = ${row.branchId} AND paused = false
            AND service_ids @> ${JSON.stringify([row.serviceId])}::jsonb
            AND updated_at > now() - interval '12 hours'`);
        const activeAgents = Math.max(1, agents.rows[0]?.n ?? 1);
        estimatedMinutes = Math.ceil(((waitingAhead + 1) * (service?.estimatedMinutes ?? 5)) / activeAgents);
      }
      return {
        code: ticket.code,
        status: ticket.status,
        service: ticket.service?.name ?? '',
        priority: ticket.priority?.name ?? '',
        branch: branch?.name ?? '',
        counter: ticket.counter?.name ?? null,
        waitingAhead,
        estimatedMinutes,
        createdAt: ticket.createdAt,
        calledAt: ticket.calledAt,
        finishedAt: ticket.finishedAt,
        tenant: toPublicTenantDTO(tenant),
      };
    },
  );

  app.post(
    '/public/tickets/:token/cancel',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags, summary: 'El cliente cancela su turno', params: tokenParam, security: [] } },
    async (request) => {
      const row = await trackedTicket(request.params.token);
      if (row.status !== 'waiting') throw badRequest('Solo se pueden cancelar turnos en espera');
      await cancelTicket(ctx, row.tenantId, { userId: null, role: 'agent' }, row.id, 'Cancelado por el cliente');
      return { ok: true };
    },
  );
};
