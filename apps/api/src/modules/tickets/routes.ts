import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { TICKET_CHANNELS, TICKET_STATUSES, hasRole, type Paginated, type TicketDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { branches, ticketEvents, tickets } from '../../db/schema';
import { tenantIdOf, userIdOf } from '../../lib/auth';
import { forbidden, notFound } from '../../lib/errors';
import { dateOnly, idParam, pagination, uuidList } from '../../lib/schemas';
import { cancelTicket, countAhead, findTickets, issueTicket, loadTicket, queueSnapshot, resetBranchQueue, userScope } from './queue';

export const customerSchema = z.record(z.string().max(40), z.union([z.string().max(300), z.null()])).optional();

export const ticketRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Turnos'];
  const read = ctx.auth.require({ scope: 'tickets:read' });
  const write = ctx.auth.require({ scope: 'tickets:write' });

  /**
   * Sucursales que puede ver quien consulta: un operador asignado a sucursales solo ve esas
   * (con datos personales de los clientes); supervisores, administradores y API keys ven todas.
   */
  async function branchScope(request: FastifyRequest): Promise<string[] | null> {
    const auth = request.auth;
    if (!auth || auth.kind !== 'user' || hasRole(auth.role, 'manager')) return null;
    const scope = await userScope(ctx.db, auth.userId);
    return scope.branchIds.length ? scope.branchIds : null;
  }

  app.post(
    '/tickets',
    {
      preHandler: write,
      schema: {
        tags,
        summary: 'Emitir un turno',
        description: 'Crea un turno en la cola. Útil para integrar turnos desde una web, app, WhatsApp, CRM o ERP.',
        body: z.object({
          branchId: z.uuid(),
          serviceId: z.uuid(),
          priorityId: z.uuid().nullish(),
          customer: customerSchema,
          notes: z.string().max(2000).optional(),
          channel: z.enum(TICKET_CHANNELS).optional(),
        }),
      },
    },
    async (request, reply) => {
      const tenantId = tenantIdOf(request);
      const channel = request.body.channel ?? (request.auth?.kind === 'apiKey' ? 'api' : 'web');
      const result = await issueTicket(ctx, {
        ...request.body,
        customer: request.body.customer as Record<string, string | null> | undefined,
        tenantId,
        channel,
        userId: userIdOf(request),
      });
      return reply.code(201).send({
        ...result,
        trackingUrl: `${ctx.config.PUBLIC_URL.replace(/\/$/, '')}/t/${result.ticket.publicToken}`,
      });
    },
  );

  app.get(
    '/tickets',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Buscar turnos',
        querystring: pagination.extend({
          branchId: z.uuid().optional(),
          serviceId: z.uuid().optional(),
          status: z
            .string()
            .optional()
            .transform((v) => (v ? v.split(',') : []))
            .pipe(z.array(z.enum(TICKET_STATUSES))),
          from: dateOnly.optional(),
          to: dateOnly.optional(),
          q: z.string().max(100).optional(),
        }),
      },
    },
    async (request): Promise<Paginated<TicketDTO>> => {
      const tenantId = tenantIdOf(request);
      const { page, pageSize, branchId, serviceId, status, from, to, q } = request.query;
      const allowed = await branchScope(request);
      if (allowed && branchId && !allowed.includes(branchId)) return { items: [], total: 0, page, pageSize };
      const where = and(
        eq(tickets.tenantId, tenantId),
        allowed ? inArray(tickets.branchId, allowed) : undefined,
        branchId ? eq(tickets.branchId, branchId) : undefined,
        serviceId ? eq(tickets.serviceId, serviceId) : undefined,
        status.length ? inArray(tickets.status, status) : undefined,
        from ? gte(tickets.serviceDay, from) : undefined,
        to ? lte(tickets.serviceDay, to) : undefined,
        q ? or(ilike(tickets.code, `%${q}%`), sql`${tickets.customer}->>'name' ILIKE ${`%${q}%`}`, sql`${tickets.customer}->>'document' ILIKE ${`%${q}%`}`) : undefined,
      );
      const [items, total] = await Promise.all([
        findTicketsPage(where, page, pageSize),
        ctx.db.select({ n: count() }).from(tickets).where(where),
      ]);
      return { items, total: total[0]?.n ?? 0, page, pageSize };
    },
  );

  async function findTicketsPage(where: SQL | undefined, page: number, pageSize: number) {
    const ids = await ctx.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(where)
      .orderBy(desc(tickets.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    if (ids.length === 0) return [];
    return findTickets(ctx.db, inArray(tickets.id, ids.map((r) => r.id)), [desc(tickets.createdAt)], pageSize);
  }

  app.get('/tickets/:id', { preHandler: read, schema: { tags, params: idParam, summary: 'Detalle e historial de un turno' } }, async (request) => {
    const tenantId = tenantIdOf(request);
    const ticket = await loadTicket(ctx.db, tenantId, request.params.id);
    const allowed = await branchScope(request);
    if (allowed && !allowed.includes(ticket.branchId)) throw notFound('Turno');
    const events = await ctx.db
      .select()
      .from(ticketEvents)
      .where(eq(ticketEvents.ticketId, ticket.id))
      .orderBy(asc(ticketEvents.createdAt));
    const waitingAhead = ticket.status === 'waiting' ? await countAhead(ctx.db, ticket) : 0;
    return {
      ticket,
      waitingAhead,
      events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    };
  });

  app.post(
    '/tickets/:id/cancel',
    { preHandler: write, schema: { tags, params: idParam, body: z.object({ reason: z.string().max(300).optional() }).nullish() } },
    async (request) => {
      const auth = request.auth!;
      return cancelTicket(ctx, tenantIdOf(request), { userId: userIdOf(request), role: auth.role }, request.params.id, request.body?.reason);
    },
  );

  app.get(
    '/branches/:id/queue',
    {
      preHandler: read,
      schema: { tags, summary: 'Estado de la cola de una sucursal', params: idParam, querystring: z.object({ serviceIds: uuidList }) },
    },
    async (request) => {
      const allowed = await branchScope(request);
      if (allowed && !allowed.includes(request.params.id)) throw forbidden('No tiene acceso a esta sucursal');
      return queueSnapshot(ctx.db, tenantIdOf(request), request.params.id, request.query.serviceIds);
    },
  );

  app.post(
    '/branches/:id/queue/reset',
    {
      preHandler: ctx.auth.require({ role: 'manager' }),
      schema: { tags, summary: 'Cerrar jornada: cancela pendientes y reinicia la numeración', params: idParam },
    },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const [branch] = await ctx.db
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, request.params.id), eq(branches.tenantId, tenantId)));
      if (!branch) throw notFound('Sucursal');
      const cancelled = await resetBranchQueue(ctx, tenantId, branch.id, { userId: userIdOf(request), role: request.auth!.role });
      return { cancelled };
    },
  );
};
