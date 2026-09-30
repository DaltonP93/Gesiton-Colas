import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  PAYMENT_GATEWAY_INFO,
  PLANS,
  formatMoney,
  toMinor,
  type BillingSettings,
  type Currency,
  type GatewayBody,
  type GatewayDTO,
  type InvoiceDTO,
  type PaymentGateway,
  type PaymentStatus,
  type PlatformSettings,
} from '@gc/shared';
import type { AppConfig } from '../../config';
import type { Database } from '../../db/client';
import { invoices, paymentGateways, payments, tenants, users, type Invoice, type Payment, type PaymentGatewayRow, type Tenant } from '../../db/schema';
import { decryptSecret, encryptSecret, randomToken } from '../crypto';
import { invoiceMail, type EmailBrand } from '../emails';
import { badRequest } from '../errors';
import type { Mailer } from '../mailer';
import { createCheckout, fetchStatus, GatewayError, parseWebhook, type GatewayRuntime } from './gateways';

export const PLATFORM_PAY_SCOPE = 'platform';

export const invoiceNumber = (seq: number) => `F-${String(seq).padStart(6, '0')}`;

/** «YYYY-MM-DD» de hoy en UTC (las fechas de vencimiento son de calendario). */
const todayISO = (now = new Date()) => now.toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function toInvoiceDTO(row: Invoice, tenantName: string, now = new Date()): InvoiceDTO {
  return {
    id: row.id,
    number: invoiceNumber(row.seq),
    tenantId: row.tenantId,
    tenantName,
    period: row.period,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    overdue: row.status === 'pending' && row.dueDate < todayISO(now),
    dueDate: row.dueDate,
    issuedAt: row.issuedAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
  };
}

interface PaymentsDeps {
  config: AppConfig;
  db: Database;
  log: FastifyBaseLogger;
  mailer: Mailer;
  platformSettings(): Promise<PlatformSettings>;
  emailBrand(tenant: Tenant | null): Promise<EmailBrand>;
  /** Se llama cuando se paga un turno (tiempo real y webhooks). */
  onTicketPaid?(payment: Payment): void;
}

export interface StartPaymentInput {
  tenantId: string;
  kind: 'invoice' | 'ticket';
  invoiceId?: string | null;
  ticketId?: string | null;
  amount: number;
  currency: Currency;
  description: string;
  returnUrl?: string | null;
  email?: string | null;
  name?: string | null;
}

export class Payments {
  constructor(private readonly deps: PaymentsDeps) {}

  private get base() {
    return this.deps.config.PUBLIC_URL.replace(/\/$/, '');
  }

  /* ---------------------------- Pasarelas ---------------------------- */

  private async gatewayRow(scope: string) {
    const [row] = await this.deps.db.select().from(paymentGateways).where(eq(paymentGateways.scope, scope)).limit(1);
    return row;
  }

  private runtime(row: PaymentGatewayRow): GatewayRuntime {
    const key = this.deps.config.JWT_SECRET;
    return {
      provider: row.provider,
      sandbox: row.sandbox,
      publicKey: row.config.publicKey ?? '',
      apiUrl: row.config.apiUrl ?? '',
      secret: decryptSecret(key, row.secretEnc, 'payments') ?? '',
      webhookSecret: decryptSecret(key, row.webhookSecretEnc, 'payments') ?? '',
      allowPrivate: this.deps.config.WEBHOOKS_ALLOW_PRIVATE,
    };
  }

  /** Pasarela activa de la plataforma o de una organización. */
  async activeGateway(scope: string): Promise<{ row: PaymentGatewayRow; rt: GatewayRuntime } | null> {
    const row = await this.gatewayRow(scope);
    if (!row?.enabled) return null;
    return { row, rt: this.runtime(row) };
  }

  private toDTO(row: PaymentGatewayRow | undefined): GatewayDTO {
    return {
      enabled: row?.enabled ?? false,
      provider: row?.provider ?? 'bancard',
      sandbox: row?.sandbox ?? true,
      publicKey: row?.config.publicKey ?? '',
      apiUrl: row?.config.apiUrl ?? '',
      hasSecret: Boolean(row?.secretEnc),
      hasWebhookSecret: Boolean(row?.webhookSecretEnc),
      webhookUrl: row ? `${this.base}/api/v1/public/payments/webhook/${row.provider}/${row.webhookToken}` : '',
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  async gatewayStatus(scope: string): Promise<GatewayDTO> {
    return this.toDTO(await this.gatewayRow(scope));
  }

  async saveGateway(scope: string, tenantId: string | null, body: GatewayBody): Promise<GatewayDTO> {
    const current = await this.gatewayRow(scope);
    const sameProvider = current?.provider === body.provider;
    const key = this.deps.config.JWT_SECRET;
    // La clave guardada solo se conserva con la misma pasarela.
    const secretEnc = body.secret !== undefined ? (body.secret ? encryptSecret(key, body.secret, 'payments') : '') : sameProvider ? (current?.secretEnc ?? '') : '';
    const webhookSecretEnc =
      body.webhookSecret !== undefined ? (body.webhookSecret ? encryptSecret(key, body.webhookSecret, 'payments') : '') : sameProvider ? (current?.webhookSecretEnc ?? '') : '';
    if (body.enabled) {
      if (!secretEnc) throw badRequest(body.provider === 'stripe' ? 'Escriba la clave secreta de Stripe (sk_…)' : 'Escriba la clave privada de la pasarela');
      if (body.provider !== 'stripe' && !body.publicKey) throw badRequest('Escriba la clave pública de la pasarela');
      if (body.provider === 'stripe' && body.secret && !/^(sk|rk)_/.test(body.secret)) throw badRequest('La clave de Stripe empieza con sk_ (o rk_ si es restringida)');
    }
    const config = { publicKey: body.publicKey, apiUrl: body.apiUrl };
    await this.deps.db
      .insert(paymentGateways)
      .values({ scope, tenantId, provider: body.provider, enabled: body.enabled, sandbox: body.sandbox, config, secretEnc, webhookSecretEnc, webhookToken: randomToken(24) })
      .onConflictDoUpdate({
        target: paymentGateways.scope,
        set: { provider: body.provider, enabled: body.enabled, sandbox: body.sandbox, config, secretEnc, webhookSecretEnc, updatedAt: new Date() },
      });
    return this.gatewayStatus(scope);
  }

  /** Crea un cobro de prueba en la pasarela (sin guardarlo) para comprobar las claves. */
  async testGateway(scope: string, currency: Currency) {
    const gw = await this.activeGateway(scope);
    if (!gw) throw badRequest('Active y guarde la pasarela antes de probarla');
    if (!PAYMENT_GATEWAY_INFO[gw.rt.provider].currencies.includes(currency)) throw badRequest(`${PAYMENT_GATEWAY_INFO[gw.rt.provider].name} no cobra en ${currency}`);
    try {
      const seq = 900_000_000 + Math.floor(Math.random() * 99_999_999);
      const result = await createCheckout(gw.rt, {
        seq,
        token: randomToken(12),
        amount: currency === 'PYG' ? 1000 : 100,
        currency,
        description: 'Pago de prueba',
        returnUrl: `${this.base}/`,
        cancelUrl: `${this.base}/`,
      });
      return {
        ok: true,
        checkoutUrl: result.checkoutUrl,
        message: result.checkoutUrl
          ? 'La pasarela respondió bien. Puede abrir el pago de prueba (no lo complete con una tarjeta real en producción).'
          : `La pasarela respondió bien (proceso ${result.processId}).`,
      };
    } catch (error) {
      throw badRequest(this.describe(error));
    }
  }

  private describe(error: unknown) {
    if ((error as { code?: string }).code === 'EPRIVATE') return 'La dirección de la pasarela está en una red privada.';
    if (error instanceof GatewayError) return error.message;
    return error instanceof Error ? `No se pudo conectar con la pasarela: ${error.message}` : 'No se pudo conectar con la pasarela';
  }

  /* ------------------------------ Pagos ------------------------------ */

  scopeOf(payment: Pick<Payment, 'kind' | 'tenantId'>) {
    return payment.kind === 'invoice' ? PLATFORM_PAY_SCOPE : payment.tenantId;
  }

  /** Inicia (o reutiliza) un pago en línea y devuelve la URL de la página de pago. */
  async startPayment(input: StartPaymentInput): Promise<{ payment: Payment; url: string }> {
    const scope = input.kind === 'invoice' ? PLATFORM_PAY_SCOPE : input.tenantId;
    const gw = await this.activeGateway(scope);
    if (!gw) throw badRequest('No hay una pasarela de pago en línea activa');
    if (!PAYMENT_GATEWAY_INFO[gw.rt.provider].currencies.includes(input.currency)) throw badRequest(`${PAYMENT_GATEWAY_INFO[gw.rt.provider].name} no cobra en ${input.currency}`);
    const target = input.kind === 'invoice' ? eq(payments.invoiceId, input.invoiceId!) : eq(payments.ticketId, input.ticketId!);
    const [reusable] = await this.deps.db
      .select()
      .from(payments)
      .where(
        and(
          target,
          eq(payments.status, 'pending'),
          eq(payments.provider, gw.rt.provider),
          eq(payments.amount, input.amount),
          sql`${payments.createdAt} > now() - interval '1 hour'`,
        ),
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);
    if (reusable && (reusable.checkoutUrl || reusable.raw?.processId)) return { payment: reusable, url: `${this.base}/pago/${reusable.publicToken}` };

    const [payment] = await this.deps.db
      .insert(payments)
      .values({
        tenantId: input.tenantId,
        kind: input.kind,
        invoiceId: input.invoiceId ?? null,
        ticketId: input.ticketId ?? null,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        provider: gw.rt.provider,
        publicToken: randomToken(24),
        returnUrl: input.returnUrl ?? null,
      })
      .returning();
    try {
      const result = await createCheckout(gw.rt, {
        seq: payment!.seq,
        token: payment!.publicToken,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        returnUrl: `${this.base}/pago/${payment!.publicToken}?r=ok`,
        cancelUrl: `${this.base}/pago/${payment!.publicToken}?r=cancel`,
        email: input.email,
        name: input.name,
      });
      const [updated] = await this.deps.db
        .update(payments)
        .set({ providerRef: result.providerRef, checkoutUrl: result.checkoutUrl, raw: result.processId ? { processId: result.processId } : null })
        .where(eq(payments.id, payment!.id))
        .returning();
      return { payment: updated!, url: `${this.base}/pago/${updated!.publicToken}` };
    } catch (error) {
      await this.deps.db.update(payments).set({ status: 'failed', raw: { error: this.describe(error) } }).where(eq(payments.id, payment!.id));
      this.deps.log.warn({ err: error, payment: payment!.id }, 'pagos: no se pudo iniciar el cobro');
      throw badRequest(this.describe(error));
    }
  }

  /** Registra un pago hecho fuera de la pasarela (efectivo, POS, transferencia). */
  async recordManual(input: Omit<StartPaymentInput, 'returnUrl' | 'email' | 'name'> & { method: string; reference?: string; userId: string | null }) {
    const [payment] = await this.deps.db
      .insert(payments)
      .values({
        tenantId: input.tenantId,
        kind: input.kind,
        invoiceId: input.invoiceId ?? null,
        ticketId: input.ticketId ?? null,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        provider: 'manual',
        method: input.method,
        reference: input.reference || null,
        recordedBy: input.userId,
        publicToken: randomToken(24),
      })
      .returning();
    return this.applyStatus(payment!, 'paid', { method: input.method, reference: input.reference || null });
  }

  /** Aplica el estado que informó la pasarela (idempotente: un pago acreditado no cambia). */
  async applyStatus(payment: Payment, status: PaymentStatus, info: { method?: string | null; reference?: string | null; raw?: Record<string, unknown> } = {}) {
    if (payment.status === 'paid' || status === 'pending' || payment.status === status) return payment;
    const [updated] = await this.deps.db
      .update(payments)
      .set({
        status,
        method: info.method ?? payment.method,
        reference: info.reference ?? payment.reference,
        raw: info.raw ? { ...(payment.raw ?? {}), ...info.raw } : payment.raw,
        paidAt: status === 'paid' ? new Date() : null,
      })
      .where(and(eq(payments.id, payment.id), ne(payments.status, 'paid')))
      .returning();
    if (!updated) return payment;
    if (status === 'paid') await this.onPaid(updated);
    return updated;
  }

  private async onPaid(payment: Payment) {
    if (payment.kind === 'invoice' && payment.invoiceId) {
      await this.deps.db
        .update(invoices)
        .set({ status: 'paid', paidAt: payment.paidAt ?? new Date(), method: payment.method ?? payment.provider, reference: payment.reference })
        .where(and(eq(invoices.id, payment.invoiceId), eq(invoices.status, 'pending')));
      await this.reactivateIfSettled(payment.tenantId);
    } else if (payment.kind === 'ticket') {
      this.deps.onTicketPaid?.(payment);
    }
  }

  /** Si la organización estaba suspendida por falta de pago y ya no debe nada vencido, se reactiva. */
  async reactivateIfSettled(tenantId: string) {
    const settings = (await this.deps.platformSettings()).billing;
    const limit = addDays(todayISO(), -settings.graceDays);
    const [overdue] = await this.deps.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'pending'), lt(invoices.dueDate, limit)))
      .limit(1);
    if (overdue) return false;
    const res = await this.deps.db
      .update(tenants)
      .set({ status: 'active', suspendedReason: null })
      .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'suspended'), eq(tenants.suspendedReason, 'billing')))
      .returning({ id: tenants.id });
    if (res.length) this.deps.log.info({ tenantId }, 'facturación: organización reactivada al pagar');
    return res.length > 0;
  }

  /** Consulta a la pasarela un pago pendiente (cuando el cliente vuelve del checkout). */
  async refresh(payment: Payment): Promise<Payment> {
    if (payment.status !== 'pending' || payment.provider === 'manual') return payment;
    if (Date.now() - payment.updatedAt.getTime() < 3_000 && Date.now() - payment.createdAt.getTime() > 3_000) return payment;
    const gw = await this.activeGateway(this.scopeOf(payment));
    if (!gw || gw.rt.provider !== payment.provider) return payment;
    try {
      const status = await fetchStatus(gw.rt, payment);
      await this.deps.db.update(payments).set({ updatedAt: new Date() }).where(eq(payments.id, payment.id));
      return this.applyStatus(payment, status);
    } catch (error) {
      this.deps.log.warn({ err: error, payment: payment.id }, 'pagos: no se pudo consultar el estado');
      return payment;
    }
  }

  /** Confirmación de la pasarela (webhook). Devuelve lo que hay que responderle. */
  async handleWebhook(provider: PaymentGateway, webhookToken: string, headers: Record<string, string | string[] | undefined>, rawBody: string) {
    const [row] = await this.deps.db
      .select()
      .from(paymentGateways)
      .where(and(eq(paymentGateways.webhookToken, webhookToken), eq(paymentGateways.provider, provider)))
      .limit(1);
    if (!row) throw badRequest('Pasarela desconocida');
    const result = parseWebhook(this.runtime(row), headers, rawBody);
    const where = result.match.providerRef ? eq(payments.providerRef, result.match.providerRef) : eq(payments.seq, result.match.seq ?? -1);
    const [payment] = await this.deps.db.select().from(payments).where(and(where, eq(payments.provider, provider))).limit(1);
    // El pago debe corresponder a la pasarela que confirma (plataforma → facturas; organización → sus turnos).
    if (payment && this.scopeOf(payment) === row.scope) {
      await this.applyStatus(payment, result.status, { method: result.method, reference: result.reference, raw: result.raw });
    } else {
      this.deps.log.warn({ provider, match: result.match }, 'pagos: confirmación sin pago asociado');
    }
    return result.respond;
  }

  /* ---------------------------- Facturación --------------------------- */

  /** Genera la factura del plan del mes para cada organización con plan pago (idempotente). */
  async generateMonthly(period: string, options: { notify?: boolean; userId?: string | null } = {}) {
    const settings = await this.deps.platformSettings();
    const periodStart = new Date(`${period}-01T00:00:00Z`);
    const rows = await this.deps.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.isDemo, false), lt(tenants.createdAt, periodStart)));
    const today = todayISO();
    let created = 0;
    for (const tenant of rows) {
      const plan = settings.plans[tenant.plan];
      if (!plan || plan.monthlyPrice <= 0) continue;
      const amount = toMinor(plan.monthlyPrice, plan.currency);
      const [invoice] = await this.deps.db
        .insert(invoices)
        .values({
          tenantId: tenant.id,
          period,
          description: `Plan ${PLANS[tenant.plan].name} · ${new Date(`${period}-15T12:00:00Z`).toLocaleDateString('es', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
          amount,
          currency: plan.currency,
          dueDate: addDays(today, settings.billing.dueDays),
          createdBy: options.userId ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (invoice) {
        created += 1;
        if (options.notify !== false) await this.notifyInvoice(invoice, tenant);
      }
    }
    return created;
  }

  async notifyInvoice(invoice: Invoice, tenant: Tenant) {
    const settings = await this.deps.platformSettings();
    const admins = await this.deps.db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, tenant.id), eq(users.role, 'admin'), eq(users.active, true)));
    const brand = await this.deps.emailBrand(null);
    const dto = toInvoiceDTO(invoice, tenant.name);
    for (const admin of admins) {
      try {
        await this.deps.mailer.send(
          invoiceMail(
            admin.email,
            admin.name,
            { number: dto.number, description: dto.description, amount: formatMoney(dto.amount, dto.currency), dueDate: dto.dueDate.split('-').reverse().join('/'), organization: tenant.name },
            `${this.base}/app/facturacion`,
            settings.billing.instructions,
            brand,
          ),
          { tenantId: null },
        );
      } catch (error) {
        this.deps.log.warn({ err: error, invoice: invoice.id }, 'facturación: no se pudo enviar la factura');
      }
    }
  }

  /** Suspende las organizaciones con facturas vencidas hace más de `graceDays` días. */
  async suspendOverdue(billing: BillingSettings) {
    if (!billing.autoSuspend) return 0;
    const limit = addDays(todayISO(), -billing.graceDays);
    const overdue = await this.deps.db
      .selectDistinct({ tenantId: invoices.tenantId })
      .from(invoices)
      .where(and(eq(invoices.status, 'pending'), lt(invoices.dueDate, limit)));
    if (!overdue.length) return 0;
    const res = await this.deps.db
      .update(tenants)
      .set({ status: 'suspended', suspendedReason: 'billing' })
      .where(and(inArray(tenants.id, overdue.map((o) => o.tenantId)), eq(tenants.status, 'active'), eq(tenants.isDemo, false)))
      .returning({ id: tenants.id });
    if (res.length) this.deps.log.warn({ count: res.length }, 'facturación: organizaciones suspendidas por falta de pago');
    return res.length;
  }

  /** Ciclo de facturación (lo corre el mantenimiento). */
  async runCycle(now = new Date()) {
    const { billing } = await this.deps.platformSettings();
    if (!billing.enabled) return;
    if (billing.autoGenerate) await this.generateMonthly(now.toISOString().slice(0, 7));
    await this.suspendOverdue(billing);
  }
}
