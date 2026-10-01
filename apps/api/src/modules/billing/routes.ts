import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  PLANS,
  gatewayBodySchema,
  invoiceBodySchema,
  manualPaymentSchema,
  monthlyCharges,
  toMinor,
  type BillingOverviewDTO,
  type BillingStatsDTO,
  type InvoiceDTO,
} from '@gc/shared';
import type { AppContext } from '../../context';
import { invoices, tenants } from '../../db/schema';
import { tenantIdOf, userIdOf } from '../../lib/auth';
import { badRequest, notFound } from '../../lib/errors';
import { PLATFORM_PAY_SCOPE, toInvoiceDTO } from '../../lib/payments/service';
import { idParam } from '../../lib/schemas';

export const billingRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Facturación'];
  const superadmin = ctx.auth.require({ role: 'superadmin' });
  // El administrador puede ver y pagar sus facturas aunque la organización esté suspendida por falta de pago.
  const tenantAdmin = ctx.auth.require({ role: 'admin', allowBillingSuspended: true });

  async function invoiceRows(where?: SQL) {
    const rows = await ctx.db
      .select({ invoice: invoices, tenantName: tenants.name })
      .from(invoices)
      .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
      .where(where)
      .orderBy(desc(invoices.issuedAt), desc(invoices.seq))
      .limit(1000);
    return rows.map((r) => toInvoiceDTO(r.invoice, r.tenantName));
  }

  async function ownInvoice(id: string, tenantId?: string) {
    const [row] = await ctx.db
      .select()
      .from(invoices)
      .where(tenantId ? and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)) : eq(invoices.id, id));
    if (!row) throw notFound('Factura');
    return row;
  }

  /* --------------------------- Superadministrador ---------------------- */

  app.get(
    '/platform/billing/invoices',
    {
      preHandler: superadmin,
      schema: { tags, summary: 'Facturas emitidas a las organizaciones', querystring: z.object({ tenantId: z.uuid().optional(), status: z.enum(['pending', 'paid', 'void', 'overdue']).optional() }) },
    },
    async (request): Promise<InvoiceDTO[]> => {
      const filters: SQL[] = [];
      if (request.query.tenantId) filters.push(eq(invoices.tenantId, request.query.tenantId));
      if (request.query.status === 'overdue') filters.push(sql`${invoices.status} = 'pending' AND ${invoices.dueDate} < current_date`);
      else if (request.query.status) filters.push(eq(invoices.status, request.query.status));
      return invoiceRows(filters.length ? and(...filters) : undefined);
    },
  );

  app.get('/platform/billing/stats', { preHandler: superadmin, schema: { tags, summary: 'Facturado, cobrado y pendiente' } }, async (): Promise<BillingStatsDTO> => {
    const settings = await ctx.platform.get();
    const currency = settings.plans.pro.currency;
    const [row] = (
      await ctx.db.execute<{ issued: number; paid: number; pending: number; overdue: number; overdue_tenants: number }>(sql`
        SELECT
          coalesce(sum(amount) FILTER (WHERE status <> 'void' AND date_trunc('month', issued_at) = date_trunc('month', now())), 0)::float AS issued,
          coalesce(sum(amount) FILTER (WHERE status = 'paid' AND date_trunc('month', paid_at) = date_trunc('month', now())), 0)::float AS paid,
          coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0)::float AS pending,
          coalesce(sum(amount) FILTER (WHERE status = 'pending' AND due_date < current_date), 0)::float AS overdue,
          count(DISTINCT tenant_id) FILTER (WHERE status = 'pending' AND due_date < current_date)::int AS overdue_tenants
        FROM invoices WHERE currency = ${currency}`)
    ).rows;
    return {
      currency,
      issuedThisMonth: row?.issued ?? 0,
      paidThisMonth: row?.paid ?? 0,
      pending: row?.pending ?? 0,
      overdue: row?.overdue ?? 0,
      overdueTenants: row?.overdue_tenants ?? 0,
    };
  });

  app.post(
    '/platform/billing/invoices',
    { preHandler: superadmin, schema: { tags, summary: 'Emitir una factura a una organización', body: invoiceBodySchema } },
    async (request, reply): Promise<InvoiceDTO> => {
      const { tenantId, amount, currency, notify, period, ...rest } = request.body;
      const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
      if (!tenant) throw notFound('Organización');
      const [row] = await ctx.db
        .insert(invoices)
        .values({ ...rest, tenantId, period: period ?? null, amount: toMinor(amount, currency), currency, createdBy: userIdOf(request) })
        .onConflictDoNothing()
        .returning();
      if (!row) throw badRequest(`${tenant.name} ya tiene la factura del período ${period}`);
      if (notify) await ctx.payments.notifyInvoice(row, tenant);
      reply.code(201);
      return toInvoiceDTO(row, tenant.name);
    },
  );

  app.post(
    '/platform/billing/generate',
    {
      preHandler: superadmin,
      schema: { tags, summary: 'Generar las facturas del plan de un mes (no duplica)', body: z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional(), notify: z.boolean().default(true) }) },
    },
    async (request) => {
      const period = request.body.period ?? new Date().toISOString().slice(0, 7);
      const created = await ctx.payments.generateMonthly(period, { notify: request.body.notify, userId: userIdOf(request) });
      return { period, created };
    },
  );

  app.post(
    '/platform/billing/invoices/:id/pay',
    { preHandler: superadmin, schema: { tags, summary: 'Registrar el pago de una factura (transferencia, efectivo…)', params: idParam, body: manualPaymentSchema } },
    async (request): Promise<InvoiceDTO> => {
      const invoice = await ownInvoice(request.params.id);
      if (invoice.status !== 'pending') throw badRequest('La factura no está pendiente');
      await ctx.payments.recordManual({
        tenantId: invoice.tenantId,
        kind: 'invoice',
        invoiceId: invoice.id,
        amount: invoice.amount,
        currency: invoice.currency,
        description: invoice.description,
        method: request.body.method,
        reference: request.body.reference,
        userId: userIdOf(request),
      });
      const [row] = await invoiceRows(eq(invoices.id, invoice.id));
      return row!;
    },
  );

  app.post('/platform/billing/invoices/:id/void', { preHandler: superadmin, schema: { tags, summary: 'Anular una factura pendiente', params: idParam } }, async (request) => {
    const invoice = await ownInvoice(request.params.id);
    if (invoice.status !== 'pending') throw badRequest('Solo se anulan facturas pendientes');
    await ctx.db.update(invoices).set({ status: 'void' }).where(eq(invoices.id, invoice.id));
    await ctx.payments.reactivateIfSettled(invoice.tenantId);
    const [row] = await invoiceRows(eq(invoices.id, invoice.id));
    return row!;
  });

  app.post('/platform/billing/invoices/:id/resend', { preHandler: superadmin, schema: { tags, summary: 'Reenviar la factura por correo', params: idParam } }, async (request) => {
    const invoice = await ownInvoice(request.params.id);
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, invoice.tenantId));
    if (tenant) await ctx.payments.notifyInvoice(invoice, tenant);
    return { ok: true };
  });

  app.get('/platform/payments/gateway', { preHandler: superadmin, schema: { tags, summary: 'Pasarela con la que las organizaciones pagan sus facturas' } }, async () =>
    ctx.payments.gatewayStatus(PLATFORM_PAY_SCOPE),
  );

  app.put('/platform/payments/gateway', { preHandler: superadmin, schema: { tags, summary: 'Guardar la pasarela de la plataforma', body: gatewayBodySchema } }, async (request) =>
    ctx.payments.saveGateway(PLATFORM_PAY_SCOPE, null, request.body),
  );

  app.post(
    '/platform/payments/gateway/test',
    { preHandler: superadmin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags, summary: 'Crear un pago de prueba en la pasarela' } },
    async () => ctx.payments.testGateway(PLATFORM_PAY_SCOPE, (await ctx.platform.get()).plans.pro.currency),
  );

  /* ------------------------------ Organización ------------------------- */

  app.get('/billing', { preHandler: tenantAdmin, schema: { tags, summary: 'Plan y facturas de la organización' } }, async (request): Promise<BillingOverviewDTO> => {
    const tenantId = tenantIdOf(request);
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw notFound('Organización');
    const settings = await ctx.platform.get();
    const plan = settings.plans[tenant.plan];
    const gateway = await ctx.payments.activeGateway(PLATFORM_PAY_SCOPE);
    return {
      enabled: settings.billing.enabled,
      plan: { id: tenant.plan, name: PLANS[tenant.plan].name, monthlyPrice: plan.monthlyPrice, currency: plan.currency },
      monthly: monthlyCharges(settings, tenant),
      suspended: tenant.status === 'suspended',
      onlinePayment: gateway?.rt.provider ?? null,
      instructions: settings.billing.instructions,
      issuer: { name: settings.billing.issuerName || settings.brand.appName, taxId: settings.billing.issuerTaxId },
      invoices: (await invoiceRows(eq(invoices.tenantId, tenantId))).filter((i) => i.status !== 'void'),
    };
  });

  app.post(
    '/billing/invoices/:id/pay',
    { preHandler: tenantAdmin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags, summary: 'Pagar una factura en línea', params: idParam } },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const invoice = await ownInvoice(request.params.id, tenantId);
      if (invoice.status !== 'pending') throw badRequest('La factura no está pendiente');
      const user = request.auth?.kind === 'user' ? request.auth.user : null;
      const { url } = await ctx.payments.startPayment({
        tenantId,
        kind: 'invoice',
        invoiceId: invoice.id,
        amount: invoice.amount,
        currency: invoice.currency,
        description: invoice.description,
        returnUrl: '/app/facturacion',
        email: user?.email,
        name: user?.name,
      });
      return { url };
    },
  );
};
