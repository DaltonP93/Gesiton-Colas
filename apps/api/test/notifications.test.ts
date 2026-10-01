import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizePhone } from '@gc/shared';
import { notifyMessages, notifyProviders } from '../src/db/schema';
import { runMaintenance } from '../src/lib/maintenance';
import { api, createTestApp, registerTenant, uniqueEmail, type TenantSession } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };
let app: FastifyInstance;
let root: { headers: { authorization: string } };
let org: TenantSession;

/** Servidor que imita WAHA (/api/sendText) y un proveedor de SMS (/sms). */
interface Received {
  path: string;
  method: string;
  headers: IncomingMessage['headers'];
  body: string;
}
let fake: Server;
let base = '';
const received: Received[] = [];
let failNext = 0;

beforeAll(async () => {
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', method: req.method ?? '', headers: req.headers, body });
      if (failNext > 0) {
        failNext -= 1;
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'sesión no iniciada' }));
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ id: { _serialized: `true_${received.length}` } }));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password });
  root = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', ROOT)).body.token}` } };
  org = await registerTenant(app, 'Avisos SA');
});

afterAll(async () => {
  await app.ctx.db.delete(notifyProviders).where(eq(notifyProviders.scope, 'platform'));
  await app.close();
  fake.close();
});

const waha = (extra: Record<string, unknown> = {}) => ({ enabled: true, provider: 'waha', wahaUrl: base, wahaSession: 'turnos', secret: 'clave-waha', ...extra });

/** Espera a que el proveedor reciba `count` mensajes nuevos. */
async function waitFor(count: number, from: number) {
  for (let i = 0; i < 100 && received.length - from < count; i++) {
    await app.ctx.notifier.processDue();
    await new Promise((r) => setTimeout(r, 20));
  }
  return received.slice(from);
}

describe('normalización de teléfonos', () => {
  it('agrega el código de país y quita el 0 del número local', () => {
    expect(normalizePhone('0981 123-456', '595')).toBe('595981123456');
    expect(normalizePhone('+595 981 123456', '595')).toBe('595981123456');
    expect(normalizePhone('595981123456', '595')).toBe('595981123456');
    expect(normalizePhone('+54 9 11 5555-1234', '595')).toBe('5491155551234');
    expect(normalizePhone('abc', '595')).toBeNull();
    expect(normalizePhone('12', '595')).toBeNull();
  });
});

describe('avisos por WhatsApp y SMS', () => {
  it('es un módulo: sin él no hay configuración ni alta del teléfono', async () => {
    expect((await api(app, org, 'GET', '/notifications/provider')).status).toBe(403);
    const branch = (await api(app, org, 'GET', '/branches')).body[0];
    const service = (await api(app, org, 'GET', '/services')).body[0];
    const ticket = (await api(app, org, 'POST', '/tickets', { branchId: branch.id, serviceId: service.id })).body.ticket;
    const optIn = await api(app, null, 'POST', `/public/tickets/${ticket.publicToken}/notify`, { phone: '0981123456' });
    expect(optIn.status).toBe(403);
    expect(optIn.body.error).toBe('module_disabled');
    await api(app, org, 'POST', `/tickets/${ticket.id}/cancel`, {});

    await api(app, root, 'PUT', `/platform/tenants/${org.tenantId}`, { modules: { notifications: true } });
    expect((await api(app, org, 'GET', '/notifications/provider')).status).toBe(200);
  });

  it('guarda el proveedor con la clave cifrada y nunca la devuelve', async () => {
    const empty = await api(app, org, 'GET', '/notifications/provider');
    expect(empty.body).toMatchObject({ active: 'none', settings: { enabled: false, hasSecret: false } });

    expect((await api(app, org, 'PUT', '/notifications/provider', { enabled: true, provider: 'waha' })).status).toBe(400);
    expect((await api(app, org, 'PUT', '/notifications/provider', { enabled: true, provider: 'http', httpUrl: `${base}/sms` })).body.message).toMatch(/\{\{phone\}\}/);

    const saved = await api(app, org, 'PUT', '/notifications/provider', waha());
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ active: 'tenant', settings: { provider: 'waha', wahaUrl: base, hasSecret: true } });
    expect(JSON.stringify(saved.body)).not.toContain('clave-waha');

    const [row] = await app.ctx.db.select().from(notifyProviders).where(eq(notifyProviders.scope, org.tenantId));
    expect(row!.secretEnc).not.toContain('clave-waha');
    expect(row!.secretEnc.length).toBeGreaterThan(20);
  });

  it('envía un mensaje de prueba y no reutiliza la clave con otra dirección', async () => {
    const from = received.length;
    const test = await api(app, org, 'POST', '/notifications/provider/test', { ...waha({ secret: undefined }), to: '0981 111 222' });
    expect(test.status).toBe(200);
    expect(test.body.message).toContain('+595981111222');
    const [msg] = received.slice(from);
    expect(msg!.path).toBe('/api/sendText');
    expect(msg!.headers['x-api-key']).toBe('clave-waha');
    expect(JSON.parse(msg!.body)).toMatchObject({ session: 'turnos', chatId: '595981111222@c.us' });

    // Datos de otros canales en el formulario no cuentan: solo la dirección de WAHA.
    expect((await api(app, org, 'POST', '/notifications/provider/test', { ...waha({ secret: undefined, httpUrl: 'https://otro.example/sms' }), to: '0981111222' })).status).toBe(200);
    const other = await api(app, org, 'POST', '/notifications/provider/test', { ...waha({ secret: undefined, wahaUrl: 'http://10.9.9.9:3000' }), to: '0981111222' });
    expect(other.status).toBe(400);
    expect(other.body.message).toMatch(/escriba la clave/);
  });

  it('avisa al sacar el turno, cuando se acerca y cuando lo llaman', async () => {
    await api(app, org, 'PUT', '/tenant', { settings: { notifications: { nearAhead: 1 } } });
    const branch = (await api(app, org, 'GET', '/branches')).body[0];
    const service = (await api(app, org, 'GET', '/services')).body[0];
    const counter = (await api(app, org, 'GET', `/counters?branchId=${branch.id}`)).body[0];
    const issue = (customer: Record<string, string>) => api(app, org, 'POST', '/tickets', { branchId: branch.id, serviceId: service.id, customer });

    const from = received.length;
    const first = (await issue({ name: 'Ana Gómez', phone: '0981 200 001' })).body.ticket;
    await issue({ name: 'Sin teléfono' });
    const third = (await issue({ name: 'Beto', phone: '0981200003' })).body.ticket;
    const created = await waitFor(2, from);
    expect(created).toHaveLength(2);
    const toAna = created.map((m) => JSON.parse(m.body) as { chatId: string; text: string }).find((t) => t.chatId === '595981200001@c.us')!;
    expect(toAna.text).toContain(`Hola Ana. Su turno ${first.code}`);
    expect(toAna.text).toContain(`http://colas.test/t/${first.publicToken}`);

    // Al llamar al primero, avisa al llamado y a quien quedó con 1 turno por delante (el tercero).
    const beforeCall = received.length;
    await api(app, org, 'PUT', '/agent/workstation', { branchId: branch.id, counterId: counter.id, serviceIds: [service.id], paused: false });
    const called = await api(app, org, 'POST', '/agent/call-next');
    expect(called.body.ticket.id).toBe(first.id);
    const sent = (await waitFor(2, beforeCall)).map((m) => JSON.parse(m.body) as { chatId: string; text: string });
    expect(sent).toHaveLength(2);
    expect(sent.find((t) => t.chatId === '595981200001@c.us')!.text).toBe(`¡Es su turno! ${first.code}, por favor diríjase a ${counter.name}.`);
    expect(sent.find((t) => t.chatId === '595981200003@c.us')!.text).toContain(`${third.code}: ya casi es su turno`);

    const log = await api(app, org, 'GET', '/notifications/messages');
    expect(log.status).toBe(200);
    expect(log.body.filter((m: { status: string }) => m.status === 'sent').length).toBeGreaterThanOrEqual(4);
    expect(log.body.find((m: { event: string; ticketCode: string }) => m.event === 'called')).toMatchObject({ ticketCode: first.code, provider: 'waha' });
    await api(app, org, 'POST', `/agent/tickets/${first.id}/finish`);
    await api(app, org, 'POST', `/branches/${branch.id}/queue/reset`);
  });

  it('el cliente se anota desde la página de seguimiento', async () => {
    const branch = (await api(app, org, 'GET', '/branches')).body[0];
    const service = (await api(app, org, 'GET', '/services')).body[0];
    const ticket = (await api(app, org, 'POST', '/tickets', { branchId: branch.id, serviceId: service.id })).body.ticket;
    expect((await api(app, null, 'GET', `/public/tickets/${ticket.publicToken}`)).body.notify).toEqual({ available: true, phone: null });

    const from = received.length;
    expect((await api(app, null, 'POST', `/public/tickets/${ticket.publicToken}/notify`, { phone: 'no' })).status).toBe(400);
    const optIn = await api(app, null, 'POST', `/public/tickets/${ticket.publicToken}/notify`, { phone: '0971 555 444' });
    expect(optIn.status).toBe(200);
    expect(optIn.body.phone).toBe('+595971555444');
    const [msg] = await waitFor(1, from);
    expect(JSON.parse(msg!.body).chatId).toBe('595971555444@c.us');
    // El teléfono se muestra enmascarado en el seguimiento.
    expect((await api(app, null, 'GET', `/public/tickets/${ticket.publicToken}`)).body.notify.phone).toMatch(/^\+5959•+44$/);
  });

  it('reintenta ante un error del proveedor y registra el fallo', async () => {
    const branch = (await api(app, org, 'GET', '/branches')).body[0];
    const service = (await api(app, org, 'GET', '/services')).body[0];
    failNext = 1;
    const from = received.length;
    const ticket = (await api(app, org, 'POST', '/tickets', { branchId: branch.id, serviceId: service.id, customer: { phone: '0981300300' } })).body.ticket;
    await waitFor(1, from);
    const [pending] = await app.ctx.db.select().from(notifyMessages).where(eq(notifyMessages.ticketId, ticket.id));
    expect(pending).toMatchObject({ status: 'pending', attempts: 1 });
    expect(pending!.error).toMatch(/WAHA respondió 500: sesión no iniciada/);

    const retry = await api(app, org, 'POST', `/notifications/messages/${pending!.id}/retry`);
    expect(retry.status).toBe(200);
    const [sent] = await app.ctx.db.select().from(notifyMessages).where(eq(notifyMessages.id, pending!.id));
    expect(sent).toMatchObject({ status: 'sent', error: null });
  });

  it('SMS por HTTP con {{phone}} y {{message}}', async () => {
    await api(app, org, 'PUT', '/notifications/provider', {
      enabled: true,
      provider: 'http',
      httpMethod: 'POST',
      httpUrl: `${base}/sms?to={{phone}}`,
      httpBody: '{"texto":"{{message}}"}',
      httpContentType: 'application/json',
      httpAuthHeader: 'Authorization',
      secret: 'Bearer sms-123',
    });
    const from = received.length;
    const res = await api(app, org, 'POST', '/notifications/provider/test', {
      enabled: true,
      provider: 'http',
      httpUrl: `${base}/sms?to={{phone}}`,
      httpBody: '{"texto":"{{message}}"}',
      httpAuthHeader: 'Authorization',
      to: '0981 400 400',
    });
    expect(res.status).toBe(200);
    const [msg] = received.slice(from);
    expect(msg!.path).toBe('/sms?to=595981400400');
    expect(msg!.headers.authorization).toBe('Bearer sms-123');
    expect(JSON.parse(msg!.body).texto).toMatch(/Mensaje de prueba/);
  });

  it('el borrado a pedido y el plazo de conservación alcanzan al historial de avisos', async () => {
    const log = (await api(app, org, 'GET', '/notifications/messages')).body as { to: string }[];
    expect(log.some((m) => m.to === '595981200001')).toBe(true);
    const erased = await api(app, org, 'POST', '/privacy/erase', { field: 'phone', value: '0981 200 001' });
    expect(erased.status).toBe(200);
    expect(erased.body.messages).toBeGreaterThanOrEqual(2);
    const after = (await api(app, org, 'GET', '/notifications/messages')).body as { to: string }[];
    expect(after.some((m) => m.to === '595981200001')).toBe(false);

    // Plazo de conservación de 30 días: los avisos más viejos se borran.
    await api(app, org, 'PUT', '/tenant', { settings: { privacy: { retentionDays: 30 } } });
    const [old] = await app.ctx.db.select().from(notifyMessages).where(eq(notifyMessages.tenantId, org.tenantId)).limit(1);
    await app.ctx.db.update(notifyMessages).set({ createdAt: sql`now() - interval '40 days'` }).where(eq(notifyMessages.id, old!.id));
    await runMaintenance(app.ctx);
    expect(await app.ctx.db.select().from(notifyMessages).where(eq(notifyMessages.id, old!.id))).toEqual([]);
    await api(app, org, 'PUT', '/tenant', { settings: { privacy: { retentionDays: 0 } } });
  });

  it('sin proveedor propio usa el de la plataforma', async () => {
    await api(app, org, 'PUT', '/notifications/provider', { enabled: false, provider: 'waha' });
    expect((await api(app, org, 'GET', '/notifications/provider')).body.active).toBe('none');

    const email = uniqueEmail('agente');
    await api(app, org, 'POST', '/users', { email, name: 'Ana', password: 'password123', role: 'agent' });
    const agent = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', { email, password: 'password123' })).body.token}` } };
    expect((await api(app, agent, 'PUT', '/platform/notifications', waha())).status).toBe(403);
    expect((await api(app, org, 'GET', '/platform/notifications')).status).toBe(403);

    const saved = await api(app, root, 'PUT', '/platform/notifications', waha({ wahaSession: 'plataforma' }));
    expect(saved.body.active).toBe('platform');
    expect((await api(app, org, 'GET', '/notifications/provider')).body.active).toBe('platform');

    const branch = (await api(app, org, 'GET', '/branches')).body[0];
    const service = (await api(app, org, 'GET', '/services')).body[0];
    const from = received.length;
    await api(app, org, 'POST', '/tickets', { branchId: branch.id, serviceId: service.id, customer: { phone: '0981500500' } });
    const [msg] = await waitFor(1, from);
    expect(JSON.parse(msg!.body).session).toBe('plataforma');
  });
});
