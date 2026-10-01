import { createHash, createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatMoney, toMinor } from '@gc/shared';
import { invoices, tenants } from '../src/db/schema';
import { verifyStripeSignature } from '../src/lib/payments/gateways';
import { api, createTestApp, registerTenant, uniqueEmail, type TenantSession } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };
const sha1 = (v: string) => createHash('sha1').update(v).digest('hex');
const md5 = (v: string) => createHash('md5').update(v).digest('hex');

let app: FastifyInstance;
let root: { headers: { authorization: string } };
let org: TenantSession;

/* Pasarelas simuladas: validan las firmas como las reales y guardan lo que reciben. */
let fake: Server;
let base = '';
const received: { path: string; body: string; headers: Record<string, unknown> }[] = [];
let stripePaid = false;
let bancardConfirmed = false;
const KEYS = { pagoparPublic: 'pub-pp', pagoparPrivate: 'priv-pp', bancardPublic: 'pub-bc', bancardPrivate: 'priv-bc' };

beforeAll(async () => {
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', body, headers: req.headers });
      const json = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
      const url = req.url ?? '';
      if (url === '/v1/checkout/sessions') {
        if (req.headers.authorization !== 'Bearer sk_test_123') return json(401, { error: { message: 'Invalid API Key' } });
        const n = received.filter((r) => r.path === '/v1/checkout/sessions').length;
        return json(200, { id: `cs_test_${n}`, url: `https://checkout.stripe.test/c/cs_test_${n}` });
      }
      if (url.startsWith('/v1/checkout/sessions/')) return json(200, { payment_status: stripePaid ? 'paid' : 'unpaid', status: 'open' });
      if (url === '/api/comercios/2.0/iniciar-transaccion') {
        const b = JSON.parse(body) as { token: string; id_pedido_comercio: string; monto_total: number; public_key: string };
        const ok = b.public_key === KEYS.pagoparPublic && b.token === sha1(`${KEYS.pagoparPrivate}${b.id_pedido_comercio}${String(b.monto_total)}`);
        return json(200, ok ? { respuesta: true, resultado: [{ data: `hash-${b.id_pedido_comercio}`, pedido: '991' }] } : { respuesta: false, resultado: 'Token no corresponde' });
      }
      if (url === '/vpos/api/0.3/single_buy') {
        const b = JSON.parse(body) as { public_key: string; operation: { token: string; shop_process_id: number; amount: string; currency: string } };
        const o = b.operation;
        const ok = b.public_key === KEYS.bancardPublic && o.token === md5(`${KEYS.bancardPrivate}${o.shop_process_id}${o.amount}${o.currency}`);
        return json(200, ok ? { status: 'success', process_id: `proc-${o.shop_process_id}` } : { status: 'error', messages: [{ dsc: 'Token inválido' }] });
      }
      if (url === '/vpos/api/0.3/single_buy/confirmations') {
        return json(200, bancardConfirmed ? { status: 'success', confirmation: { response: 'S', response_code: '00' } } : { status: 'error', messages: [{ key: 'PaymentNotFoundError' }] });
      }
      json(404, {});
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password });
  root = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', ROOT)).body.token}` } };
  org = await registerTenant(app, 'Cobros SA');
  await api(app, root, 'PUT', `/platform/tenants/${org.tenantId}`, { plan: 'pro' });
});

afterAll(async () => {
  await api(app, root, 'PUT', '/platform/settings', { billing: { enabled: false, autoSuspend: false }, plans: { pro: { monthlyPrice: 0 } }, addons: { payments: 0 } });
  await api(app, root, 'PUT', '/platform/payments/gateway', { enabled: false, provider: 'stripe' });
  await app.close();
  fake.close();
});

const webhookPath = (url: string) => url.replace('http://colas.test/api/v1', '');
const tokenOf = (url: string) => url.split('/pago/')[1]!;

describe('montos', () => {
  it('guarda en la unidad mínima y formatea por moneda', () => {
    expect(toMinor(150000, 'PYG')).toBe(150000);
    expect(toMinor(12.5, 'USD')).toBe(1250);
    expect(formatMoney(150000, 'PYG')).toBe('Gs. 150.000');
    expect(formatMoney(1250, 'USD')).toBe('US$ 12,50');
  });

  it('verifica la firma de Stripe', () => {
    const body = '{"a":1}';
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', 'whsec_x').update(`${t}.${body}`).digest('hex');
    expect(verifyStripeSignature(`t=${t},v1=${sig}`, body, 'whsec_x')).toBe(true);
    expect(verifyStripeSignature(`t=${t},v1=${sig}`, '{"a":2}', 'whsec_x')).toBe(false);
    expect(verifyStripeSignature(`t=${t - 3600},v1=${sig}`, body, 'whsec_x')).toBe(false);
  });
});

describe('facturación de la plataforma', () => {
  it('genera la factura del mes una sola vez y la organización la ve', async () => {
    await api(app, root, 'PUT', '/platform/settings', { billing: { enabled: true, dueDays: 10, instructions: 'Transferir a la cuenta 123' }, plans: { pro: { monthlyPrice: 150000, currency: 'PYG' } } });
    const first = await api(app, root, 'POST', '/platform/billing/generate', { period: '2099-01', notify: true });
    expect(first.body.created).toBeGreaterThanOrEqual(1);
    expect((await api(app, root, 'POST', '/platform/billing/generate', { period: '2099-01' })).body.created).toBe(0);
    const mail = app.ctx.mailer.outbox().find((m) => m.tag === 'invoice' && m.text.includes('Cobros SA'));
    expect(mail?.subject).toMatch(/Factura F-\d{6} · Gs\. 150\.000/);

    const billing = await api(app, org, 'GET', '/billing');
    expect(billing.body).toMatchObject({ enabled: true, plan: { id: 'pro', monthlyPrice: 150000 }, instructions: 'Transferir a la cuenta 123', onlinePayment: null });
    const invoice = billing.body.invoices.find((i: { period: string }) => i.period === '2099-01');
    expect(invoice).toMatchObject({ amount: 150000, currency: 'PYG', status: 'pending', overdue: false });
    // Un operador no ve la facturación.
    const email = uniqueEmail('op');
    await api(app, org, 'POST', '/users', { email, name: 'Op', password: 'password123', role: 'agent' });
    const agent = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', { email, password: 'password123' })).body.token}` } };
    expect((await api(app, agent, 'GET', '/billing')).status).toBe(403);

    const paid = await api(app, root, 'POST', `/platform/billing/invoices/${invoice.id}/pay`, { method: 'transfer', reference: 'TRX-1' });
    expect(paid.body).toMatchObject({ status: 'paid', method: 'transfer', reference: 'TRX-1' });
    const stats = await api(app, root, 'GET', '/platform/billing/stats');
    expect(stats.body.currency).toBe('PYG');
  });

  it('suspende por falta de pago, deja pagar y reactiva al acreditarse (Stripe)', async () => {
    const invoice = (await api(app, root, 'POST', '/platform/billing/invoices', { tenantId: org.tenantId, description: 'Plan Profesional · agosto', amount: 150000, currency: 'PYG', dueDate: '2020-01-10', notify: false })).body;
    expect(invoice.overdue).toBe(true);
    await api(app, root, 'PUT', '/platform/settings', { billing: { autoSuspend: true, graceDays: 3 } });
    await app.ctx.payments.runCycle();
    const [tenant] = await app.ctx.db.select().from(tenants).where(eq(tenants.id, org.tenantId));
    expect(tenant).toMatchObject({ status: 'suspended', suspendedReason: 'billing' });

    const blocked = await api(app, org, 'GET', '/branches');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('billing_suspended');
    expect((await api(app, org, 'GET', '/auth/me')).body.tenant).toMatchObject({ status: 'suspended', suspendedReason: 'billing' });

    // Pasarela de la plataforma: Stripe.
    expect((await api(app, root, 'PUT', '/platform/payments/gateway', { enabled: true, provider: 'stripe', secret: 'no-es-clave' })).status).toBe(400);
    const gw = await api(app, root, 'PUT', '/platform/payments/gateway', { enabled: true, provider: 'stripe', apiUrl: base, secret: 'sk_test_123', webhookSecret: 'whsec_test' });
    expect(gw.body).toMatchObject({ enabled: true, provider: 'stripe', hasSecret: true, hasWebhookSecret: true });
    expect(JSON.stringify(gw.body)).not.toContain('sk_test_123');
    expect(gw.body.webhookUrl).toMatch(/\/api\/v1\/public\/payments\/webhook\/stripe\/[A-Za-z0-9]+$/);

    const start = await api(app, org, 'POST', `/billing/invoices/${invoice.id}/pay`);
    expect(start.status).toBe(200);
    const page = await api(app, null, 'GET', `/public/payments/${tokenOf(start.body.url)}`);
    expect(page.body).toMatchObject({ status: 'pending', amount: 150000, provider: 'stripe', checkoutUrl: expect.stringMatching(/^https:\/\/checkout\.stripe\.test\//), returnUrl: '/app/facturacion' });
    const session = received.filter((r) => r.path === '/v1/checkout/sessions').at(-1)!;
    expect(session.body).toContain('line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=pyg');
    expect(session.body).toContain('unit_amount%5D=150000');
    const sessionId = page.body.checkoutUrl.split('/c/')[1];

    const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: sessionId, payment_status: 'paid', payment_intent: 'pi_1' } } });
    const bad = await app.inject({ method: 'POST', url: `/api/v1${webhookPath(gw.body.webhookUrl)}`, headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=abc' }, payload: event });
    expect(bad.statusCode).toBe(400);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', 'whsec_test').update(`${t}.${event}`).digest('hex');
    const ok = await app.inject({ method: 'POST', url: `/api/v1${webhookPath(gw.body.webhookUrl)}`, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, payload: event });
    expect(ok.statusCode).toBe(200);

    const [after] = await app.ctx.db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(after).toMatchObject({ status: 'paid', reference: 'pi_1' });
    const [reactivated] = await app.ctx.db.select().from(tenants).where(eq(tenants.id, org.tenantId));
    expect(reactivated).toMatchObject({ status: 'active', suspendedReason: null });
    expect((await api(app, org, 'GET', '/branches')).status).toBe(200);
    await api(app, root, 'PUT', '/platform/settings', { billing: { autoSuspend: false } });
  });
});

describe('cobros de turnos', () => {
  let service: { id: string };
  let branch: { id: string };

  it('es un módulo activable', async () => {
    expect((await api(app, org, 'GET', '/payments/gateway')).status).toBe(403);
    await api(app, root, 'PUT', `/platform/tenants/${org.tenantId}`, { modules: { payments: true } });
    expect((await api(app, org, 'GET', '/payments/gateway')).status).toBe(200);
    branch = (await api(app, org, 'GET', '/branches')).body[0];
    service = (await api(app, org, 'GET', '/services')).body[0];
    const updated = await api(app, org, 'PUT', `/services/${service.id}`, { price: 50000 });
    expect(updated.body.price).toBe(50000);
  });

  const issue = async () => (await api(app, org, 'POST', '/tickets', { branchId: branch.id, serviceId: service.id, customer: { name: 'Paciente Uno' } })).body.ticket as { id: string; publicToken: string; code: string };

  it('el paciente paga en línea con PagoPar', async () => {
    const ticket = await issue();
    const before = await api(app, null, 'GET', `/public/tickets/${ticket.publicToken}`);
    expect(before.body.charge).toMatchObject({ amount: 50000, currency: 'PYG', status: 'pending', online: false });

    const gw = await api(app, org, 'PUT', '/payments/gateway', { enabled: true, provider: 'pagopar', apiUrl: base, publicKey: KEYS.pagoparPublic, secret: KEYS.pagoparPrivate });
    expect(gw.status).toBe(200);
    expect((await api(app, null, 'GET', `/public/tickets/${ticket.publicToken}`)).body.charge.online).toBe(true);

    const start = await api(app, null, 'POST', `/public/tickets/${ticket.publicToken}/pay`);
    expect(start.status).toBe(200);
    const page = await api(app, null, 'GET', `/public/payments/${tokenOf(start.body.url)}`);
    expect(page.body).toMatchObject({ status: 'pending', provider: 'pagopar', returnUrl: `/t/${ticket.publicToken}`, brand: { name: 'Cobros SA' } });
    const hash = page.body.checkoutUrl.split('/pagos/')[1];
    expect(hash).toMatch(/^hash-\d+$/);

    const hook = `/api/v1${webhookPath(gw.body.webhookUrl)}`;
    const forged = await app.inject({ method: 'POST', url: hook, headers: { 'content-type': 'application/json' }, payload: { respuesta: true, resultado: [{ hash_pedido: hash, token: 'falso', pagado: true }] } });
    expect(forged.statusCode).toBe(400);
    const result = [{ hash_pedido: hash, token: sha1(`${KEYS.pagoparPrivate}${hash}`), pagado: true, cancelado: false, forma_pago: 'Tigo Money', numero_pedido: 991 }];
    const confirmed = await app.inject({ method: 'POST', url: hook, headers: { 'content-type': 'application/json' }, payload: { respuesta: true, resultado: result } });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toEqual(result);

    const after = await api(app, null, 'GET', `/public/tickets/${ticket.publicToken}`);
    expect(after.body.charge).toMatchObject({ status: 'paid', method: 'Tigo Money' });
    expect((await api(app, null, 'POST', `/public/tickets/${ticket.publicToken}/pay`)).status).toBe(400);
  });

  it('Bancard: checkout en iframe y confirmación firmada', async () => {
    const gw = await api(app, org, 'PUT', '/payments/gateway', { enabled: true, provider: 'bancard', sandbox: true, apiUrl: base, publicKey: KEYS.bancardPublic, secret: KEYS.bancardPrivate });
    // Cambiar de pasarela no reutiliza la clave anterior: aquí se envió la nueva.
    expect(gw.body).toMatchObject({ provider: 'bancard', hasSecret: true });
    const ticket = await issue();
    const start = await api(app, null, 'POST', `/public/tickets/${ticket.publicToken}/pay`);
    const page = await api(app, null, 'GET', `/public/payments/${tokenOf(start.body.url)}`);
    expect(page.body.bancard).toMatchObject({ processId: expect.stringMatching(/^proc-\d+$/), scriptUrl: `${base}/checkout/javascript/dist/bancard-checkout-4.0.0.js` });
    const sent = JSON.parse(received.filter((r) => r.path === '/vpos/api/0.3/single_buy').at(-1)!.body);
    expect(sent.operation).toMatchObject({ amount: '50000.00', currency: 'PYG' });

    const seq = sent.operation.shop_process_id as number;
    const op = { shop_process_id: seq, response: 'S', response_code: '00', amount: '50000.00', currency: 'PYG', authorization_number: '123456', ticket_number: '987' };
    const hook = `/api/v1${webhookPath(gw.body.webhookUrl)}`;
    expect((await app.inject({ method: 'POST', url: hook, headers: { 'content-type': 'application/json' }, payload: { operation: { ...op, token: 'x' } } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: hook, headers: { 'content-type': 'application/json' }, payload: { operation: { ...op, token: md5(`${KEYS.bancardPrivate}${seq}confirm50000.00PYG`) } } });
    expect(ok.json()).toEqual({ status: 'success' });
    expect((await api(app, null, 'GET', `/public/tickets/${ticket.publicToken}`)).body.charge).toMatchObject({ status: 'paid' });
  });

  it('un doble clic no abre dos cobros y se puede pagar después de la atención', async () => {
    const ticket = await issue();
    const before = received.filter((r) => r.path === '/vpos/api/0.3/single_buy').length;
    const results = await Promise.all([1, 2, 3].map(() => api(app, null, 'POST', `/public/tickets/${ticket.publicToken}/pay`)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => r.body.url)).size).toBe(1);
    expect(received.filter((r) => r.path === '/vpos/api/0.3/single_buy').length - before).toBe(1);

    // Turno ya atendido con el cobro pendiente: el pago en línea sigue disponible.
    await api(app, org, 'PUT', '/agent/workstation', { branchId: branch.id, counterId: (await api(app, org, 'GET', `/counters?branchId=${branch.id}`)).body[0].id, serviceIds: [service.id], paused: false });
    const finished = await issue();
    await api(app, org, 'POST', `/tickets/${finished.id}/cancel`, {}).catch(() => undefined);
    const served = await issue();
    const called = (await api(app, org, 'POST', `/agent/tickets/${served.id}/call`)).body.ticket;
    expect(called.id).toBe(served.id);
    await api(app, org, 'POST', `/agent/tickets/${served.id}/finish`);
    const tracking = await api(app, null, 'GET', `/public/tickets/${served.publicToken}`);
    expect(tracking.body).toMatchObject({ status: 'finished', charge: { status: 'pending', online: true } });
    expect((await api(app, null, 'POST', `/public/tickets/${served.publicToken}/pay`)).status).toBe(200);
    // Un turno cancelado ya no se cobra.
    expect((await api(app, null, 'POST', `/public/tickets/${finished.publicToken}/pay`)).status).toBe(400);
  });

  it('si la confirmación no llega, se consulta a la pasarela al volver', async () => {
    const ticket = await issue();
    const start = await api(app, null, 'POST', `/public/tickets/${ticket.publicToken}/pay`);
    const token = tokenOf(start.body.url);
    expect((await api(app, null, 'GET', `/public/payments/${token}`)).body.status).toBe('pending');
    bancardConfirmed = true;
    await new Promise((r) => setTimeout(r, 3100));
    expect((await api(app, null, 'GET', `/public/payments/${token}`)).body.status).toBe('paid');
    bancardConfirmed = false;
  });

  it('el operador registra el cobro en efectivo y el listado suma', async () => {
    const ticket = await issue();
    const charge = await api(app, org, 'GET', `/tickets/${ticket.id}/charge`);
    expect(charge.body.charge).toMatchObject({ amount: 50000, status: 'pending' });
    const paid = await api(app, org, 'POST', `/tickets/${ticket.id}/charge/manual`, { method: 'cash' });
    expect(paid.body.charge).toMatchObject({ status: 'paid', method: 'cash' });
    expect((await api(app, org, 'POST', `/tickets/${ticket.id}/charge/manual`, { method: 'cash' })).status).toBe(400);

    const list = await api(app, org, 'GET', '/payments');
    expect(list.status).toBe(200);
    expect(list.body.totals.count).toBe(4);
    expect(list.body.totals.amount).toBe(200000);
    expect(list.body.totals.manual).toBe(50000);
    expect(list.body.items.find((i: { method: string }) => i.method === 'cash')).toMatchObject({ provider: 'manual', recordedBy: 'Admin', ticketCode: ticket.code });
  });

  it('la factura del mes suma los módulos adicionales activados', async () => {
    // El plan Profesional no incluye «Cobros a clientes»; la organización lo tiene activado aparte.
    await api(app, root, 'PUT', '/platform/settings', { plans: { pro: { monthlyPrice: 150000 } }, addons: { payments: 80000, surveys: 50000 } });
    const billing = await api(app, org, 'GET', '/billing');
    expect(billing.body.monthly).toEqual({
      currency: 'PYG',
      total: 230000,
      lines: [
        { description: 'Plan Profesional', amount: 150000 },
        { description: 'Módulo adicional: Cobros a clientes', amount: 80000, module: 'payments' },
      ],
    });
    await api(app, root, 'POST', '/platform/billing/generate', { period: '2099-02', notify: false });
    const invoice = (await api(app, org, 'GET', '/billing')).body.invoices.find((i: { period: string }) => i.period === '2099-02');
    expect(invoice).toMatchObject({ amount: 230000, description: 'Plan Profesional + 1 módulo adicional · febrero de 2099' });
    expect(invoice.lines).toHaveLength(2);
  });

  it('la pasarela de una organización no confirma pagos de otra', async () => {
    const other = await registerTenant(app, 'Ajena SA');
    await api(app, root, 'PUT', `/platform/tenants/${other.tenantId}`, { modules: { payments: true } });
    const gw = await api(app, other, 'PUT', '/payments/gateway', { enabled: true, provider: 'bancard', apiUrl: base, publicKey: KEYS.bancardPublic, secret: KEYS.bancardPrivate });
    const ticket = await issue();
    const start = await api(app, null, 'POST', `/public/tickets/${ticket.publicToken}/pay`);
    await api(app, null, 'GET', `/public/payments/${tokenOf(start.body.url)}`);
    const seq = JSON.parse(received.filter((r) => r.path === '/vpos/api/0.3/single_buy').at(-1)!.body).operation.shop_process_id as number;
    const op = { shop_process_id: seq, response: 'S', response_code: '00', amount: '50000.00', currency: 'PYG' };
    await app.inject({
      method: 'POST',
      url: `/api/v1${webhookPath(gw.body.webhookUrl)}`,
      headers: { 'content-type': 'application/json' },
      payload: { operation: { ...op, token: md5(`${KEYS.bancardPrivate}${seq}confirm50000.00PYG`) } },
    });
    expect((await api(app, null, 'GET', `/public/tickets/${ticket.publicToken}`)).body.charge.status).toBe('pending');
  });
});
