import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { normalizePhone, type NotifyMessageDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { notifyMessages, tenants, tickets } from '../../db/schema';
import { assertModuleActive, assertTenantAvailable, tenantIdOf } from '../../lib/auth';
import { tenantSettings } from '../../lib/dto';
import { badRequest, notFound } from '../../lib/errors';
import { PLATFORM_NOTIFY_SCOPE, notifyProviderBody } from '../../lib/notifier';
import { idParam } from '../../lib/schemas';
import { findTickets } from '../tickets/queue';

const testBody = notifyProviderBody.extend({ to: z.string().trim().min(6).max(30) });

export const notificationRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Avisos por WhatsApp y SMS'];
  const admin = ctx.auth.require({ role: 'admin', module: 'notifications' });
  const manager = ctx.auth.require({ role: 'manager', module: 'notifications' });
  const superadmin = ctx.auth.require({ role: 'superadmin' });
  const testLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  /* ---------------------- Proveedor de la organización ---------------- */

  app.get('/notifications/provider', { preHandler: admin, schema: { tags, summary: 'Proveedor propio y el que se usa hoy' } }, async (request) => {
    const tenantId = tenantIdOf(request);
    return ctx.notifier.status(tenantId, tenantId);
  });

  app.put(
    '/notifications/provider',
    { preHandler: admin, schema: { tags, summary: 'Guardar el proveedor propio (desactivado = el de la plataforma)', body: notifyProviderBody } },
    async (request) => {
      const tenantId = tenantIdOf(request);
      return ctx.notifier.save(tenantId, tenantId, request.body);
    },
  );

  app.post(
    '/notifications/provider/test',
    { preHandler: admin, config: testLimit, schema: { tags, summary: 'Enviar un mensaje de prueba', body: testBody } },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
      return ctx.notifier.test(tenantId, { ...request.body, countryCode: tenant ? tenantSettings(tenant).notifications.countryCode : '595' });
    },
  );

  /* ----------------------------- Historial ---------------------------- */

  app.get(
    '/notifications/messages',
    { preHandler: manager, schema: { tags, summary: 'Últimos avisos enviados', querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }) } },
    async (request): Promise<NotifyMessageDTO[]> => {
      const tenantId = tenantIdOf(request);
      const rows = await ctx.db
        .select({ m: notifyMessages, code: tickets.code })
        .from(notifyMessages)
        .leftJoin(tickets, eq(tickets.id, notifyMessages.ticketId))
        .where(eq(notifyMessages.tenantId, tenantId))
        .orderBy(desc(notifyMessages.createdAt))
        .limit(request.query.limit);
      return rows.map(({ m, code }) => ({
        id: m.id,
        event: m.event as NotifyMessageDTO['event'],
        to: m.to,
        body: m.body,
        provider: m.provider,
        status: m.status,
        attempts: m.attempts,
        error: m.error,
        ticketCode: code,
        createdAt: m.createdAt.toISOString(),
        sentAt: m.sentAt?.toISOString() ?? null,
      }));
    },
  );

  app.post('/notifications/messages/:id/retry', { preHandler: admin, schema: { tags, summary: 'Reintentar un aviso', params: idParam } }, async (request) => {
    const [row] = await ctx.db
      .update(notifyMessages)
      .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), error: null })
      .where(and(eq(notifyMessages.id, request.params.id), eq(notifyMessages.tenantId, tenantIdOf(request))))
      .returning({ id: notifyMessages.id });
    if (!row) throw notFound('Aviso');
    await ctx.notifier.processDue();
    return { ok: true };
  });

  /* ------------------------ Proveedor de la plataforma ---------------- */

  app.get('/platform/notifications', { preHandler: superadmin, schema: { tags, summary: 'Proveedor de avisos de la plataforma' } }, async () =>
    ctx.notifier.status(PLATFORM_NOTIFY_SCOPE, null),
  );

  app.put(
    '/platform/notifications',
    { preHandler: superadmin, schema: { tags, summary: 'Guardar el proveedor de la plataforma (lo usan las organizaciones sin proveedor propio)', body: notifyProviderBody } },
    async (request) => ctx.notifier.save(PLATFORM_NOTIFY_SCOPE, null, request.body),
  );

  app.post(
    '/platform/notifications/test',
    { preHandler: superadmin, config: testLimit, schema: { tags, summary: 'Enviar un mensaje de prueba con el proveedor de la plataforma', body: testBody } },
    async (request) => ctx.notifier.test(PLATFORM_NOTIFY_SCOPE, request.body),
  );

  /* --------------------- Alta del teléfono (público) ------------------ */

  app.post(
    '/public/tickets/:token/notify',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'El cliente deja su teléfono para recibir avisos de su turno',
        security: [],
        params: z.object({ token: z.string().min(10).max(64) }),
        body: z.object({ phone: z.string().trim().min(6).max(30) }),
      },
    },
    async (request) => {
      const [row] = await ctx.db.select().from(tickets).where(eq(tickets.publicToken, request.params.token)).limit(1);
      if (!row) throw notFound('Turno');
      const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, row.tenantId)).limit(1);
      if (!tenant) throw notFound('Turno');
      assertTenantAvailable(tenant);
      await assertModuleActive(ctx.modulesOf, tenant, 'notifications');
      if (row.status !== 'waiting') throw badRequest('El turno ya no está en espera');
      const settings = tenantSettings(tenant).notifications;
      const phone = normalizePhone(request.body.phone, settings.countryCode);
      if (!phone) throw badRequest('Revise el número de teléfono');
      await ctx.db.update(tickets).set({ customer: { ...row.customer, phone: request.body.phone } }).where(eq(tickets.id, row.id));
      const [ticket] = await findTickets(ctx.db, eq(tickets.id, row.id), [], 1);
      if (ticket) await ctx.notifier.onTicketEvent(tenant.id, 'ticket.created', ticket);
      return { ok: true, phone: `+${phone}` };
    },
  );
};
