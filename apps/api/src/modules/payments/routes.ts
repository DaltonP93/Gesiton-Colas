import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  PAYMENT_GATEWAYS,
  PAYMENT_GATEWAY_INFO,
  gatewayBodySchema,
  manualPaymentSchema,
  type PaymentDTO,
  type PublicPaymentDTO,
  type TicketChargeDTO,
} from '@gc/shared';
import type { AppContext } from '../../context';
import { payments, services, tenants, tickets, users, type Payment, type Tenant, type Ticket } from '../../db/schema';
import { assertModuleActive, assertTenantAvailable, tenantIdOf, userIdOf } from '../../lib/auth';
import { tenantSettings } from '../../lib/dto';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { bancardScript } from '../../lib/payments/gateways';
import { idParam } from '../../lib/schemas';
import { dayInTimezone } from '../../lib/tz';

/** Cobro de un turno: precio del servicio y si ya se pagó. null = el servicio no tiene precio o el módulo está apagado. */
export async function ticketCharge(ctx: AppContext, tenant: Tenant, ticket: Pick<Ticket, 'id' | 'serviceId'>): Promise<TicketChargeDTO | null> {
  if (!(await ctx.modulesOf(tenant)).includes('payments')) return null;
  const [service] = await ctx.db.select({ price: services.price }).from(services).where(eq(services.id, ticket.serviceId));
  const [paid] = await ctx.db
    .select()
    .from(payments)
    .where(and(eq(payments.ticketId, ticket.id), eq(payments.status, 'paid')))
    .orderBy(desc(payments.paidAt))
    .limit(1);
  const settings = tenantSettings(tenant).payments;
  if (!paid && !service?.price) return null;
  const gateway = settings.online ? await ctx.payments.activeGateway(tenant.id) : null;
  return {
    amount: paid?.amount ?? service!.price!,
    currency: paid?.currency ?? settings.currency,
    status: paid ? 'paid' : 'pending',
    method: paid?.method ?? null,
    paidAt: paid?.paidAt?.toISOString() ?? null,
    online: Boolean(gateway && PAYMENT_GATEWAY_INFO[gateway.rt.provider].currencies.includes(settings.currency)),
  };
}

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['pending', 'paid', 'failed', 'cancelled']).optional(),
});

export const paymentRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Pagos'];
  const admin = ctx.auth.require({ role: 'admin', module: 'payments' });
  const manager = ctx.auth.require({ role: 'manager', module: 'payments' });
  const staff = ctx.auth.require({ role: 'agent', module: 'payments' });

  async function ownTicket(tenantId: string, id: string) {
    const [row] = await ctx.db.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.tenantId, tenantId)));
    if (!row) throw notFound('Turno');
    return row;
  }

  async function tenantOf(id: string) {
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, id));
    if (!tenant) throw notFound('Organización');
    return tenant;
  }

  /* ---------------------------- Pasarela propia ------------------------ */

  app.get('/payments/gateway', { preHandler: admin, schema: { tags, summary: 'Pasarela de pagos de la organización' } }, async (request) =>
    ctx.payments.gatewayStatus(tenantIdOf(request)),
  );

  app.put('/payments/gateway', { preHandler: admin, schema: { tags, summary: 'Guardar la pasarela (Bancard, PagoPar o Stripe)', body: gatewayBodySchema } }, async (request) => {
    const tenantId = tenantIdOf(request);
    return ctx.payments.saveGateway(tenantId, tenantId, request.body);
  });

  app.post(
    '/payments/gateway/test',
    { preHandler: admin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags, summary: 'Crear un pago de prueba en la pasarela' } },
    async (request) => {
      const tenant = await tenantOf(tenantIdOf(request));
      return ctx.payments.testGateway(tenant.id, tenantSettings(tenant).payments.currency);
    },
  );

  /* ------------------------------ Cobros ------------------------------- */

  app.get('/payments', { preHandler: manager, schema: { tags, summary: 'Cobros de turnos', querystring: listQuery } }, async (request) => {
    const tenantId = tenantIdOf(request);
    const tenant = await tenantOf(tenantId);
    const tz = tenantSettings(tenant).timezone;
    const today = dayInTimezone(new Date(), tz);
    const from = request.query.from ?? today;
    const to = request.query.to ?? today;
    const filters: SQL[] = [eq(payments.tenantId, tenantId), eq(payments.kind, 'ticket'), sql`(${payments.createdAt} AT TIME ZONE ${tz})::date BETWEEN ${from} AND ${to}`];
    if (request.query.status) filters.push(eq(payments.status, request.query.status));
    const rows = await ctx.db
      .select({ p: payments, code: tickets.code, service: services.name, recordedBy: users.name })
      .from(payments)
      .leftJoin(tickets, eq(tickets.id, payments.ticketId))
      .leftJoin(services, eq(services.id, tickets.serviceId))
      .leftJoin(users, eq(users.id, payments.recordedBy))
      .where(and(...filters))
      .orderBy(desc(payments.createdAt))
      .limit(1000);
    const items: PaymentDTO[] = rows.map(({ p, code, service, recordedBy }) => ({
      id: p.id,
      kind: p.kind,
      invoiceId: p.invoiceId,
      ticketId: p.ticketId,
      ticketCode: code,
      service,
      description: p.description,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      provider: p.provider,
      method: p.method,
      reference: p.reference,
      recordedBy,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    }));
    const paid = items.filter((i) => i.status === 'paid');
    return {
      from,
      to,
      items,
      totals: {
        count: paid.length,
        amount: paid.reduce((a, i) => a + i.amount, 0),
        online: paid.filter((i) => i.provider !== 'manual').reduce((a, i) => a + i.amount, 0),
        manual: paid.filter((i) => i.provider === 'manual').reduce((a, i) => a + i.amount, 0),
      },
    };
  });

  app.get('/tickets/:id/charge', { preHandler: staff, schema: { tags, summary: 'Cobro de un turno (precio y estado)', params: idParam } }, async (request) => {
    const tenantId = tenantIdOf(request);
    const ticket = await ownTicket(tenantId, request.params.id);
    return { charge: await ticketCharge(ctx, await tenantOf(tenantId), ticket) };
  });

  app.post(
    '/tickets/:id/charge/manual',
    { preHandler: staff, schema: { tags, summary: 'Registrar el cobro en el puesto (efectivo, POS, transferencia)', params: idParam, body: manualPaymentSchema } },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const tenant = await tenantOf(tenantId);
      const ticket = await ownTicket(tenantId, request.params.id);
      const charge = await ticketCharge(ctx, tenant, ticket);
      if (!charge) throw badRequest('El servicio de este turno no tiene precio');
      if (charge.status === 'paid') throw badRequest('El turno ya está pagado');
      await ctx.payments.recordManual({
        tenantId,
        kind: 'ticket',
        ticketId: ticket.id,
        amount: charge.amount,
        currency: charge.currency,
        description: `Turno ${ticket.code}`,
        method: request.body.method,
        reference: request.body.reference,
        userId: userIdOf(request),
      });
      return { charge: await ticketCharge(ctx, tenant, ticket) };
    },
  );

  /* ------------------------------ Público ------------------------------ */

  app.post(
    '/public/tickets/:token/pay',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags, summary: 'El cliente paga su turno en línea', params: z.object({ token: z.string().min(10).max(64) }), security: [] },
    },
    async (request) => {
      const [ticket] = await ctx.db.select().from(tickets).where(eq(tickets.publicToken, request.params.token)).limit(1);
      if (!ticket) throw notFound('Turno');
      const tenant = await tenantOf(ticket.tenantId);
      assertTenantAvailable(tenant);
      await assertModuleActive(ctx.modulesOf, tenant, 'payments');
      const charge = await ticketCharge(ctx, tenant, ticket);
      if (!charge) throw badRequest('Este turno no tiene cobro');
      if (charge.status === 'paid') throw badRequest('El turno ya está pagado');
      if (!charge.online) throw badRequest('El pago en línea no está disponible. Puede pagar en el puesto de atención.');
      if (['cancelled', 'no_show'].includes(ticket.status)) throw badRequest('El turno ya no está activo');
      const customer = ticket.customer as Record<string, string | null>;
      const { url } = await ctx.payments.startPayment({
        tenantId: tenant.id,
        kind: 'ticket',
        ticketId: ticket.id,
        amount: charge.amount,
        currency: charge.currency,
        description: `${tenant.name} · Turno ${ticket.code}`,
        returnUrl: `/t/${ticket.publicToken}`,
        email: customer.email ?? null,
        name: customer.name ?? null,
      });
      return { url };
    },
  );

  async function publicPayment(payment: Payment): Promise<PublicPaymentDTO> {
    const tenant = await tenantOf(payment.tenantId);
    const platform = await ctx.platform.get();
    const brand =
      payment.kind === 'invoice'
        ? { name: platform.brand.appName, logoUrl: platform.brand.logoUrl || null, primaryColor: platform.brand.primaryColor }
        : { name: tenant.name, logoUrl: tenantSettings(tenant).branding.logoUrl || null, primaryColor: tenantSettings(tenant).branding.primaryColor };
    let bancard: PublicPaymentDTO['bancard'] = null;
    if (payment.provider === 'bancard' && typeof payment.raw?.processId === 'string') {
      const gw = await ctx.payments.activeGateway(ctx.payments.scopeOf(payment));
      if (gw) bancard = { processId: payment.raw.processId, scriptUrl: bancardScript(gw.rt) };
    }
    return {
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      description: payment.description,
      provider: payment.provider,
      checkoutUrl: payment.status === 'pending' ? payment.checkoutUrl : null,
      bancard: payment.status === 'pending' ? bancard : null,
      returnUrl: payment.returnUrl,
      brand,
    };
  }

  app.get(
    '/public/payments/:token',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { tags, summary: 'Estado de un pago (página de pago)', params: z.object({ token: z.string().min(10).max(64) }), security: [] },
    },
    async (request): Promise<PublicPaymentDTO> => {
      const [row] = await ctx.db.select().from(payments).where(eq(payments.publicToken, request.params.token)).limit(1);
      if (!row) throw notFound('Pago');
      // Si la confirmación de la pasarela no llegó (p. ej. servidor sin acceso desde Internet), se consulta.
      return publicPayment(await ctx.payments.refresh(row));
    },
  );

  /* -------------------- Confirmaciones de las pasarelas ----------------- */

  await app.register(async (plugin) => {
    const hook = plugin.withTypeProvider<ZodTypeProvider>();
    // Cuerpo sin procesar: Stripe firma los bytes exactos que envía.
    hook.removeAllContentTypeParsers();
    hook.addContentTypeParser('*', { parseAs: 'string', bodyLimit: 256 * 1024 }, (_request, body, done) => done(null, body));
    hook.post(
      '/public/payments/webhook/:provider/:token',
      {
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
        schema: {
          tags,
          summary: 'Confirmación de pago de la pasarela (URL que se configura en Bancard, PagoPar o Stripe)',
          params: z.object({ provider: z.enum(PAYMENT_GATEWAYS), token: z.string().min(10).max(64) }),
          security: [],
        },
      },
      async (request) => {
        try {
          return await ctx.payments.handleWebhook(request.params.provider, request.params.token, request.headers, typeof request.body === 'string' ? request.body : '');
        } catch (error) {
          if (error instanceof AppError) throw error;
          ctx.log.warn({ err: error, provider: request.params.provider }, 'pagos: confirmación rechazada');
          throw badRequest(error instanceof Error ? error.message : 'Confirmación inválida');
        }
      },
    );
  });
};
