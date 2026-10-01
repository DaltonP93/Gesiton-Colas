import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoices, notifyMessages, notifyProviders, platformNoticeLog, tenants } from '../src/db/schema';
import { api, createTestApp, registerTenant, uniqueEmail, type TenantSession } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };

let app: FastifyInstance;
let root: { headers: Record<string, string> };
let org: TenantSession;
let fake: Server;
let base = '';
const sms: { to: string; text: string }[] = [];

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const outbox = () => app.ctx.mailer.outbox();

beforeAll(async () => {
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      sms.push({ to: url.searchParams.get('to') ?? '', text: JSON.parse(body || '{}').texto ?? '' });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password });
  root = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', ROOT)).body.token}` } };
  org = await registerTenant(app, 'Avisos de Plataforma SA');
});

afterAll(async () => {
  await api(app, root, 'PUT', '/platform/settings', {
    billing: { enabled: false },
    notices: { events: { invoice_due: { email: true, whatsapp: false }, tenant_created: { email: false, whatsapp: false }, invoice_issued: { email: true, whatsapp: false } }, adminPhones: [] },
  });
  await app.ctx.db.delete(notifyProviders).where(eq(notifyProviders.scope, 'platform'));
  await app.close();
  fake.close();
});

describe('avisos de la plataforma', () => {
  it('guarda los canales de cada aviso sin pisar los demás', async () => {
    const res = await api(app, root, 'PUT', '/platform/settings', { notices: { events: { invoice_due: { whatsapp: true } }, adminPhones: ['0981 500 500'] } });
    expect(res.status).toBe(200);
    expect(res.body.notices.events.invoice_due).toEqual({ email: true, whatsapp: true });
    expect(res.body.notices.events.backup_failed).toEqual({ email: true, whatsapp: false });
    expect(res.body.notices).toMatchObject({ dueDaysBefore: 3, adminPhones: ['0981 500 500'], countryCode: '595' });
    expect((await api(app, root, 'PUT', '/platform/settings', { notices: { events: { nada: { email: true } } } })).status).toBe(400);
    expect((await api(app, org, 'PUT', '/platform/settings', { notices: { adminPhones: [] } })).status).toBe(403);
  });

  it('avisa a los superadministradores de una nueva organización', async () => {
    await api(app, root, 'PUT', '/platform/settings', { notices: { events: { tenant_created: { email: true } } } });
    const email = uniqueEmail('nueva');
    await api(app, null, 'POST', '/auth/register', { organizationName: 'Óptica Nueva', name: 'Olga', email, password: 'password123' });
    await new Promise((r) => setTimeout(r, 300));
    const mail = outbox().find((m) => m.to === ROOT.email && m.subject === 'Nueva organización: Óptica Nueva');
    expect(mail?.text).toContain(email);
  });

  it('recuerda la factura por vencer por correo y WhatsApp una sola vez', async () => {
    await api(app, root, 'PUT', '/platform/notifications', {
      enabled: true,
      provider: 'http',
      httpMethod: 'POST',
      httpUrl: `${base}/sms?to={{phone}}`,
      httpBody: '{"texto":"{{message}}"}',
      httpContentType: 'application/json',
    });
    await api(app, root, 'PUT', '/platform/settings', { billing: { enabled: true, autoGenerate: false } });
    await api(app, org, 'PUT', '/tenant', { settings: { fiscal: { phone: '0981 222 333' } } });
    const created = await api(app, root, 'POST', '/platform/billing/invoices', { tenantId: org.tenantId, description: 'Plan Pro · octubre', amount: 250000, dueDate: day(2), notify: false });
    expect(created.status).toBe(201);

    const before = outbox().length;
    expect(await app.ctx.notices.runDaily()).toBeGreaterThanOrEqual(1);
    const mail = outbox().slice(0, outbox().length - before).find((m) => m.subject.startsWith('Recordatorio: la factura'));
    expect(mail?.text).toContain('Plan Pro · octubre');
    expect(sms.find((m) => m.to === '595981222333')?.text).toContain('vence el');
    const history = await app.ctx.db.select().from(notifyMessages).where(eq(notifyMessages.tenantId, org.tenantId));
    expect(history.some((m) => m.event === 'platform.invoice_due' && m.status === 'sent')).toBe(true);

    // La segunda pasada no repite el recordatorio.
    const smsCount = sms.length;
    const reminders = () => outbox().filter((m) => m.subject.startsWith('Recordatorio: la factura')).length;
    const count = reminders();
    await app.ctx.notices.runDaily();
    expect(sms.length).toBe(smsCount);
    expect(reminders()).toBe(count);
  });

  it('avisa la factura vencida con la fecha de suspensión', async () => {
    await api(app, root, 'PUT', '/platform/settings', { billing: { autoSuspend: true, graceDays: 5 } });
    const created = await api(app, root, 'POST', '/platform/billing/invoices', { tenantId: org.tenantId, description: 'Plan Pro · setiembre', amount: 250000, dueDate: day(-1), notify: false });
    await app.ctx.notices.runDaily();
    const mail = outbox().find((m) => m.subject === `La factura ${created.body.number} está vencida`);
    expect(mail?.text).toContain('Si no se paga, el servicio se suspende el');
    await app.ctx.db.delete(invoices).where(eq(invoices.tenantId, org.tenantId));
  });

  it('avisa la demo por vencer', async () => {
    await app.ctx.db.update(tenants).set({ isDemo: true, demoExpiresAt: new Date(Date.now() + 36 * 3_600_000) }).where(eq(tenants.id, org.tenantId));
    await app.ctx.notices.runDaily();
    expect(outbox().some((m) => m.subject === 'Su demo vence en 2 días')).toBe(true);
    await app.ctx.db.update(tenants).set({ isDemo: false, demoExpiresAt: null }).where(eq(tenants.id, org.tenantId));
    expect((await app.ctx.db.select().from(platformNoticeLog).where(eq(platformNoticeLog.event, 'demo_expiring'))).length).toBeGreaterThanOrEqual(1);
  });

  it('envía avisos de prueba y muestra los canales de cada organización', async () => {
    const test = await api(app, root, 'POST', '/platform/notices/test', { event: 'invoice_overdue' });
    expect(test.body).toEqual({ email: { sent: 1, error: null }, whatsapp: { sent: 1, error: null } });
    expect(sms.at(-1)).toMatchObject({ to: '595981500500' });
    expect(outbox().some((m) => m.to === ROOT.email && m.subject === 'Prueba: Factura vencida')).toBe(true);

    const channels = await api(app, root, 'GET', '/platform/notices/channels');
    const row = channels.body.find((c: { tenant: { id: string } }) => c.tenant.id === org.tenantId);
    expect(row).toMatchObject({ phone: true, admins: 1 });
    expect(['platform', 'none']).toContain(row.mail);
    expect(['off', 'platform']).toContain(row.whatsapp);
  });
});
