import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tickets } from '../src/db/schema';
import { runMaintenance } from '../src/lib/maintenance';
import { isPrivateAddress, outboundRequest } from '../src/lib/net';
import { api, createTestApp, registerTenant, uniqueEmail, type TenantSession } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };
let app: FastifyInstance;
let root: { headers: { authorization: string } };
let org: TenantSession;

beforeAll(async () => {
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password });
  root = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', ROOT)).body.token}` } };
  org = await registerTenant(app, 'Segura SA');
});

afterAll(async () => {
  await app.close();
});

describe('protección contra accesos a la red interna (SSRF)', () => {
  it('reconoce direcciones privadas en todas sus formas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1', 'ff02::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '200.85.10.1', '2001:4860:4860::8888', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('no conecta a la red interna aunque la dirección esté disfrazada', async () => {
    const server: Server = createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(outboundRequest(`http://[::ffff:7f00:1]:${port}/`)).rejects.toThrow(/privada/);
      await expect(outboundRequest(`http://127.0.0.1:${port}/`)).rejects.toThrow(/privada/);
      await expect(outboundRequest(`http://localhost:${port}/`)).rejects.toThrow(/privada/);
      // Con la red interna permitida (instalación propia) sí conecta.
      expect((await outboundRequest(`http://127.0.0.1:${port}/`, { allowPrivate: true })).body).toBe('ok');
    } finally {
      server.close();
    }
  });
});

describe('fuerza bruta', () => {
  it('bloquea la cuenta tras 5 contraseñas incorrectas', async () => {
    const email = uniqueEmail('bruta');
    await api(app, null, 'POST', '/auth/register', { organizationName: 'Bruta', name: 'Bruno', email, password: 'correcta123' });
    for (let i = 0; i < 5; i++) expect((await api(app, null, 'POST', '/auth/login', { email, password: `mala-${i}-xx` })).status).toBe(401);
    const blocked = await api(app, null, 'POST', '/auth/login', { email, password: 'correcta123' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/Demasiados intentos/);
  });

  it('un código de acceso no admite más de 5 intentos, ni en paralelo', async () => {
    const email = (await api(app, org, 'GET', '/auth/me')).body.user.email as string;
    await api(app, null, 'POST', '/auth/email-login', { email });
    const mail = app.ctx.mailer.outbox().find((m) => m.to === email && m.tag === 'email_login')!;
    const code = /Código: (\d{6})/.exec(mail.text)![1]!;
    const wrong = code === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 8 }, () => api(app, null, 'POST', '/auth/email-login/verify', { email, code: wrong })));
    const res = await api(app, null, 'POST', '/auth/email-login/verify', { email, code });
    expect([400, 429]).toContain(res.status);
  });
});

describe('datos personales', () => {
  it('un operador asignado a una sucursal no ve los turnos de otra', async () => {
    await api(app, root, 'PUT', `/platform/tenants/${org.tenantId}`, { plan: 'pro' });
    const [b1] = (await api(app, org, 'GET', '/branches')).body;
    const b2 = (await api(app, org, 'POST', '/branches', { name: 'Sucursal Norte', code: 'NOR' })).body;
    const service = (await api(app, org, 'GET', '/services')).body[0];
    await api(app, org, 'PUT', `/branches/${b2.id}/services`, { services: [{ serviceId: service.id, enabled: true }] }).catch(() => undefined);
    const email = uniqueEmail('operador');
    await api(app, org, 'POST', '/users', { email, name: 'Olga', password: 'password123', role: 'agent', branchIds: [b1.id] });
    const agent = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', { email, password: 'password123' })).body.token}` } };

    expect((await api(app, agent, 'GET', `/branches/${b2.id}/queue`)).status).toBe(403);
    expect((await api(app, agent, 'GET', `/branches/${b1.id}/queue`)).status).toBe(200);
    const list = await api(app, agent, 'GET', `/tickets?branchId=${b2.id}`);
    expect(list.body.items).toEqual([]);
  });

  it('el CSS propio no puede inyectar HTML', async () => {
    const kiosk = (await api(app, org, 'GET', '/kiosks')).body[0];
    const bad = await api(app, org, 'PUT', `/kiosks/${kiosk.id}`, { config: { print: { css: '.t{color:red}</sty</stylele><img src=x onerror=alert(1)>' } } });
    const stored = (await api(app, org, 'GET', `/kiosks/${kiosk.id}`)).body.config.print.css as string;
    expect(bad.status === 400 || !stored.includes('<')).toBe(true);
    expect(stored).not.toContain('<');
    expect((await api(app, org, 'PUT', '/tenant', { settings: { branding: { customCss: '</style><script>alert(1)</script>' } } })).status).toBe(400);
  });

  it('borra los datos de una persona a pedido y al vencer el plazo', async () => {
    const branch = (await api(app, org, 'GET', '/branches')).body[0];
    const service = (await api(app, org, 'GET', '/services')).body[0];
    const issue = (customer: Record<string, string>) => api(app, org, 'POST', '/tickets', { branchId: branch.id, serviceId: service.id, customer });
    const a = (await issue({ name: 'Ana Titular', document: '1.234.567' })).body.ticket;
    const b = (await issue({ name: 'Otra Persona', document: '7654321' })).body.ticket;

    const erased = await api(app, org, 'POST', '/privacy/erase', { field: 'document', value: '1234567' });
    expect(erased.body.erased).toBe(1);
    const [rowA] = await app.ctx.db.select().from(tickets).where(eq(tickets.id, a.id));
    const [rowB] = await app.ctx.db.select().from(tickets).where(eq(tickets.id, b.id));
    expect(rowA!.customer).toEqual({});
    expect(rowB!.customer).toMatchObject({ name: 'Otra Persona' });

    // Plazo de conservación: 30 días.
    await api(app, org, 'PUT', '/tenant', { settings: { privacy: { retentionDays: 30 } } });
    await app.ctx.db.update(tickets).set({ createdAt: sql`now() - interval '40 days'` }).where(eq(tickets.id, b.id));
    await runMaintenance(app.ctx);
    const [after] = await app.ctx.db.select().from(tickets).where(eq(tickets.id, b.id));
    expect(after!.customer).toEqual({});
  });

  it('el CSV solo incluye datos personales para administradores', async () => {
    const email = uniqueEmail('supervisor');
    await api(app, org, 'POST', '/users', { email, name: 'Sergio', password: 'password123', role: 'manager' });
    const manager = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', { email, password: 'password123' })).body.token}` } };
    const asManager = await api(app, manager, 'GET', '/reports/tickets.csv');
    const asAdmin = await api(app, org, 'GET', '/reports/tickets.csv');
    expect(asManager.res.body).not.toContain('Documento');
    expect(asAdmin.res.body).toContain('Documento');
  });
});
