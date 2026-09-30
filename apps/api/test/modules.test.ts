import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, registerTenant, type TenantSession } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };
let app: FastifyInstance;
let root: { headers: { authorization: string } };
let org: TenantSession;

beforeAll(async () => {
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password });
  const res = await api(app, null, 'POST', '/auth/login', ROOT);
  root = { headers: { authorization: `Bearer ${res.body.token}` } };
  org = await registerTenant(app, 'Modular SA');
});

afterAll(async () => {
  await api(app, root, 'PUT', '/platform/settings', { plans: { free: { modules: ['displays', 'kiosks', 'advertising', 'reports', 'integrations'] } } });
  await app.close();
});

const setModules = (modules: Record<string, boolean | null>) => api(app, root, 'PUT', `/platform/tenants/${org.tenantId}`, { modules });

describe('módulos por organización', () => {
  it('los módulos del plan se ven en la sesión y se pueden forzar por organización', async () => {
    const me = await api(app, org, 'GET', '/auth/me');
    expect(me.body.modules).toEqual(expect.arrayContaining(['displays', 'kiosks', 'advertising', 'reports', 'integrations']));
    expect(me.body.modules).not.toContain('surveys');

    const displayToken = (await api(app, org, 'GET', '/displays')).body[0].token as string;
    const updated = await setModules({ displays: false, surveys: true });
    expect(updated.status).toBe(200);
    expect(updated.body.moduleOverrides).toEqual({ displays: false, surveys: true });
    expect(updated.body.modules).toContain('surveys');
    expect(updated.body.modules).not.toContain('displays');

    const displays = await api(app, org, 'GET', '/displays');
    expect(displays.status).toBe(403);
    expect(displays.body.error).toBe('module_disabled');
    // La pantalla pública también deja de funcionar; el kiosco (otro módulo) sigue.
    expect((await api(app, null, 'GET', `/public/displays/${displayToken}`)).status).toBe(403);
    const kioskToken = (await api(app, org, 'GET', '/kiosks')).body[0].token;
    expect((await api(app, null, 'GET', `/public/kiosks/${kioskToken}`)).status).toBe(200);

    // `null` vuelve a lo que diga el plan.
    const back = await setModules({ displays: null, surveys: null });
    expect(back.body.moduleOverrides).toEqual({});
    expect((await api(app, org, 'GET', '/displays')).status).toBe(200);
  });

  it('el superadministrador define qué incluye cada plan', async () => {
    await api(app, root, 'PUT', '/platform/settings', { plans: { free: { modules: ['displays', 'kiosks', 'integrations'], monthlyPrice: 150000, currency: 'PYG' } } });
    expect((await api(app, org, 'GET', '/reports/summary')).status).toBe(403);
    expect((await api(app, org, 'GET', '/playlists')).status).toBe(403);
    const settings = await api(app, root, 'GET', '/platform/settings');
    expect(settings.body.plans.free).toMatchObject({ monthlyPrice: 150000, currency: 'PYG' });
    expect(settings.body.plans.pro.modules).toContain('surveys');
    await api(app, root, 'PUT', '/platform/settings', { plans: { free: { modules: ['displays', 'kiosks', 'advertising', 'reports', 'integrations'] } } });
    expect((await api(app, org, 'GET', '/reports/summary')).status).toBe(200);
  });

  it('sin el módulo de integraciones las API keys dejan de funcionar', async () => {
    const created = await api(app, org, 'POST', '/api-keys', { name: 'ERP', scopes: ['catalog:read'] });
    const key = { headers: { 'x-api-key': created.body.key as string } };
    expect((await api(app, key, 'GET', '/services')).status).toBe(200);
    await setModules({ integrations: false });
    expect((await api(app, key, 'GET', '/services')).status).toBe(403);
    expect((await api(app, org, 'GET', '/api-keys')).status).toBe(403);
    await setModules({ integrations: null });
    expect((await api(app, key, 'GET', '/services')).status).toBe(200);
  });

  it('solo el superadministrador cambia los módulos', async () => {
    expect((await api(app, org, 'PUT', `/platform/tenants/${org.tenantId}`, { modules: { surveys: true } })).status).toBe(403);
    // Una organización no puede activarse módulos desde su propia configuración.
    await api(app, org, 'PUT', '/tenant', { modules: { surveys: true } });
    expect((await api(app, org, 'GET', '/auth/me')).body.modules).not.toContain('surveys');
  });
});

describe('numeración de turnos', () => {
  it('respeta el número inicial, vuelve a empezar después del máximo y se reinicia a mano', async () => {
    const branch = (await api(app, org, 'GET', '/branches')).body[0];
    const service = (await api(app, org, 'GET', '/services')).body[0];
    await api(app, org, 'PUT', '/tenant', { settings: { tickets: { digits: 1, startAt: 8, overflow: 'wrap', reset: 'daily', scope: 'service' } } });
    const issue = async () => (await api(app, org, 'POST', '/tickets', { branchId: branch.id, serviceId: service.id })).body.ticket.code as string;
    const p = service.prefix as string;
    expect([await issue(), await issue(), await issue()]).toEqual([`${p}8`, `${p}9`, `${p}8`]);

    const status = await api(app, org, 'GET', `/numbering?branchId=${branch.id}`);
    const row = status.body.rows.find((r: { scopeKey: string }) => r.scopeKey === service.id);
    expect(row).toMatchObject({ issued: 3, lastCode: `${p}8`, nextCode: `${p}9` });

    const reset = await api(app, org, 'POST', '/numbering/reset', { branchId: branch.id });
    expect(reset.body.reset).toBeGreaterThanOrEqual(1);
    expect(await issue()).toBe(`${p}8`);

    await api(app, org, 'PUT', '/tenant', { settings: { tickets: { overflow: 'grow' } } });
    expect([await issue(), await issue()]).toEqual([`${p}9`, `${p}10`]);
    await api(app, org, 'PUT', '/tenant', { settings: { tickets: { digits: 3, startAt: 1, overflow: 'wrap' } } });
  });
});
