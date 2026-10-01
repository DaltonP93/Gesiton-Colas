import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sanitize } from '../src/lib/audit';
import { api, createTestApp, registerTenant, uniqueEmail, type TenantSession } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };
let app: FastifyInstance;
let root: { headers: { authorization: string } };
let org: TenantSession;

beforeAll(async () => {
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password });
  root = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', ROOT)).body.token}` } };
  org = await registerTenant(app, 'Auditada SA');
  await api(app, root, 'PUT', `/platform/tenants/${org.tenantId}`, { plan: 'pro' });
});

afterAll(async () => {
  await app.close();
});

type Log = { action: string; summary: string; support: boolean; actor: { name: string; kind: string }; changes: Record<string, unknown> | null; entityId: string | null };

/** Los registros se guardan sin demorar la respuesta: se espera a que aparezcan. */
async function logs(session: { headers: Record<string, string> } = org, path = '/audit?limit=200', until?: (items: Log[]) => boolean) {
  let items: Log[] = [];
  for (let i = 0; i < 50; i++) {
    items = (await api(app, session, 'GET', path)).body.items;
    if (!until || until(items)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return items;
}

describe('registro de auditoría', () => {
  it('oculta contraseñas y claves', () => {
    expect(sanitize({ name: 'x', password: 'abc', smtp: { secret: 's', host: 'h' }, apiKey: '', token: null })).toEqual({
      name: 'x',
      password: '••••',
      smtp: { secret: '••••', host: 'h' },
      apiKey: '',
      token: null,
    });
    expect((sanitize('x'.repeat(400)) as string).length).toBe(301);
  });

  it('registra quién cambió qué, con los datos enviados', async () => {
    const service = (await api(app, org, 'GET', '/services')).body[0];
    await api(app, org, 'PUT', `/services/${service.id}`, { name: 'Caja rápida', estimatedMinutes: 4 });
    const created = (await api(app, org, 'POST', '/branches', { name: 'Sucursal Este', code: 'EST' })).body;
    await api(app, org, 'PUT', '/tenant', { settings: { tickets: { digits: 4 } } });
    await api(app, org, 'POST', '/tickets', { branchId: created.id, serviceId: service.id }).catch(() => undefined);

    const items = await logs(org, '/audit?limit=200', (l) => l.some((x) => x.action === 'tenant.update'));
    const update = items.find((l) => l.action === 'service.update')!;
    expect(update).toMatchObject({ summary: 'Modificó el servicio «Caja rápida»', entityId: service.id, actor: { name: 'Admin', kind: 'user' }, support: false });
    expect(update.changes).toMatchObject({ name: 'Caja rápida', estimatedMinutes: 4 });
    expect(items.find((l) => l.action === 'branch.create')).toMatchObject({ summary: 'Creó la sucursal «Sucursal Este»', entityId: created.id });
    expect(items.find((l) => l.action === 'tenant.update')!.summary).toBe('Cambió la configuración: tickets');
    // La operación diaria (emitir turnos) no se registra acá: queda en el historial de cada turno.
    expect(items.some((l) => l.action.includes('/tickets'))).toBe(false);
  });

  it('no guarda secretos y registra ingresos e intentos fallidos', async () => {
    await api(app, org, 'PUT', '/mail-settings', { enabled: false, host: 'smtp.test', port: 587, security: 'starttls', username: 'u', password: 'super-secreta', fromName: '', fromEmail: '', replyTo: '' });
    const email = uniqueEmail('op');
    await api(app, org, 'POST', '/users', { email, name: 'Olga Operadora', password: 'password123', role: 'agent' });
    await api(app, null, 'POST', '/auth/login', { email, password: 'incorrecta1' });
    await api(app, null, 'POST', '/auth/login', { email, password: 'password123' });

    const items = await logs(org, '/audit?limit=200', (l) => l.some((x) => x.action === 'auth.login' && x.actor.name === 'Olga Operadora'));
    const mail = items.find((l) => l.action === 'mail.update')!;
    expect(mail.changes).toMatchObject({ host: 'smtp.test', password: '••••' });
    expect(JSON.stringify(items)).not.toContain('super-secreta');
    expect(JSON.stringify(items)).not.toContain('password123');
    expect(items.find((l) => l.action === 'user.create')!.summary).toBe('Creó el usuario «Olga Operadora»');
    expect(items.find((l) => l.action === 'auth.login_failed')).toMatchObject({ summary: 'Contraseña incorrecta al ingresar', actor: { name: 'Olga Operadora' } });
    expect(items.find((l) => l.action === 'auth.login' && l.actor.name === 'Olga Operadora')!.summary).toBe('Ingresó con contraseña');

    // Un operador no ve el registro.
    const agent = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', { email, password: 'password123' })).body.token}` } };
    expect((await api(app, agent, 'GET', '/audit')).status).toBe(403);
  });

  it('marca lo que hizo el soporte de la plataforma y aísla cada organización', async () => {
    const support = { headers: { ...root.headers, 'x-tenant-id': org.tenantId } };
    const svc = (await api(app, support, 'GET', '/services')).body[0];
    await api(app, support, 'PUT', `/services/${svc.id}`, { description: 'Ajustado por soporte' });
    await api(app, root, 'PUT', `/platform/tenants/${org.tenantId}`, { modules: { surveys: true } });

    const items = await logs(org, '/audit?limit=200', (l) => l.some((x) => x.action === 'platform.tenant_update'));
    expect(items.find((l) => l.support)).toMatchObject({ action: 'service.update', actor: { kind: 'user' } });
    expect(items.find((l) => l.action === 'platform.tenant_update')!.changes).toMatchObject({ modules: { surveys: true } });

    const other = await registerTenant(app, 'Ajena SA');
    const otherLogs = await logs(other);
    expect(otherLogs.some((l) => l.summary.includes('Caja rápida'))).toBe(false);

    const platform = await api(app, root, 'GET', `/platform/audit?tenantId=${org.tenantId}&entity=service`);
    expect(platform.body.total).toBeGreaterThanOrEqual(2);
    const search = await api(app, org, 'GET', '/audit?q=soporte');
    expect(search.body.items.length).toBeGreaterThanOrEqual(0);
    const csv = await api(app, org, 'GET', '/audit.csv');
    expect(csv.res.headers['content-type']).toContain('text/csv');
    expect(csv.res.body).toContain('Modificó el servicio');
  });
});
