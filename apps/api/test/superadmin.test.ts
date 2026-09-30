import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mailSettings } from '../src/db/schema';
import { api, createTestApp, registerTenant, uniqueEmail, type TenantSession } from './helpers';

/** Servidor SMTP mínimo que acepta todo y guarda los mensajes recibidos. */
function fakeSmtp() {
  const received: { from: string; to: string[]; data: string }[] = [];
  const server: Server = createServer((socket) => {
    let buffer = '';
    let inData = false;
    let current = { from: '', to: [] as string[], data: '' };
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (inData) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        current.data = buffer.slice(0, end);
        received.push(current);
        current = { from: '', to: [], data: '' };
        buffer = buffer.slice(end + 5);
        inData = false;
        socket.write('250 OK queued\r\n');
      }
      let nl: number;
      while (!inData && (nl = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-fake\r\n250 8BITMIME\r\n');
        else if (cmd === 'MAIL') {
          current.from = line;
          socket.write('250 OK\r\n');
        } else if (cmd === 'RCPT') {
          current.to.push(line);
          socket.write('250 OK\r\n');
        } else if (cmd === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (cmd === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
  });
  return {
    received,
    listen: () => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };
let app: FastifyInstance;
let root: { headers: { authorization: string } };
let org: TenantSession;
const smtp = fakeSmtp();
let smtpPort = 0;

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
const login = (email: string, password: string) => api(app, null, 'POST', '/auth/login', { email, password });

beforeAll(async () => {
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password });
  smtpPort = await smtp.listen();
  const res = await login(ROOT.email, ROOT.password);
  root = bearer(res.body.token);
  org = await registerTenant(app, 'Sanatorio Prueba');
});

afterAll(async () => {
  await app.ctx.db.delete(mailSettings);
  await app.close();
  await smtp.close();
});

describe('organizaciones', () => {
  it('muestra el uso real de cada organización', async () => {
    const list = await api(app, root, 'GET', '/platform/tenants?q=Sanatorio Prueba');
    const row = list.body.find((t: { id: string }) => t.id === org.tenantId);
    expect(row.usage.users).toBe(1);
    expect(row.usage.branches).toBeGreaterThanOrEqual(1);
    expect(row.usage.displays).toBeGreaterThanOrEqual(1);
  });

  it('crea una organización con invitación y devuelve el enlace si no hay correo', async () => {
    const adminEmail = uniqueEmail('invitada');
    const res = await api(app, root, 'POST', '/platform/tenants', { organizationName: 'Clínica Invitada', adminName: 'Ana', adminEmail });
    expect(res.status).toBe(201);
    expect(res.body.invitation.emailSent).toBe(false);
    expect(res.body.invitation.inviteUrl).toMatch(/\/invitacion\?token=/);
    expect((await login(adminEmail, 'loQueSea123')).body.error).toBe('invite_pending');
    const token = /token=([A-Za-z0-9]+)/.exec(res.body.invitation.inviteUrl)![1];
    const accepted = await api(app, null, 'POST', '/auth/accept-invite', { token, password: 'claveNueva123' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.tenant.name).toBe('Clínica Invitada');
  });

  it('define contraseñas y genera enlaces de acceso para los usuarios', async () => {
    const users = await api(app, root, 'GET', `/platform/tenants/${org.tenantId}/users`);
    expect(users.body).toHaveLength(1);
    const user = users.body[0];
    expect((await api(app, root, 'PUT', `/platform/users/${user.id}/password`, { password: 'definida123' })).status).toBe(200);
    const ok = await login(user.email, 'definida123');
    expect(ok.status).toBe(200);
    expect(ok.body.tenant.id).toBe(org.tenantId);
    // Definir la contraseña cierra las sesiones anteriores del usuario: se sigue con la nueva.
    org = { ...org, token: ok.body.token, headers: bearer(ok.body.token).headers };

    const link = await api(app, root, 'POST', `/platform/users/${user.id}/access-link`);
    const token = /token=([A-Za-z0-9]+)/.exec(link.body.url)![1];
    const session = await api(app, null, 'POST', '/auth/email-login/verify', { token });
    expect(session.status).toBe(200);
    expect(session.body.user.id).toBe(user.id);
  });

  it('solo el superadministrador accede a la plataforma', async () => {
    expect((await api(app, org, 'GET', '/platform/admins')).status).toBe(403);
    expect((await api(app, org, 'PUT', '/platform/settings', { homePage: 'login' })).status).toBe(403);
    expect((await api(app, org, 'GET', '/platform/mail')).status).toBe(403);
  });
});

describe('superadministradores', () => {
  it('agrega, edita y quita superadministradores', async () => {
    const email = uniqueEmail('soporte');
    const created = await api(app, root, 'POST', '/platform/admins', { name: 'Soporte Dos', email, password: 'soporte123' });
    expect(created.status).toBe(201);
    expect(created.body.user.role).toBe('superadmin');
    expect((await login(email, 'soporte123')).body.user.role).toBe('superadmin');

    const list = await api(app, root, 'GET', '/platform/admins');
    expect(list.body.map((u: { email: string }) => u.email)).toEqual(expect.arrayContaining([ROOT.email, email]));

    const renamed = await api(app, root, 'PUT', `/platform/admins/${created.body.user.id}`, { name: 'Soporte Nivel 2', active: false });
    expect(renamed.body.user).toMatchObject({ name: 'Soporte Nivel 2', active: false });
    expect((await login(email, 'soporte123')).status).toBe(403);

    expect((await api(app, root, 'DELETE', `/platform/admins/${created.body.user.id}`)).status).toBe(204);
  });

  it('protege al propio usuario y al último superadministrador', async () => {
    const me = (await api(app, root, 'GET', '/auth/me')).body.user;
    expect((await api(app, root, 'DELETE', `/platform/admins/${me.id}`)).status).toBe(400);
    expect((await api(app, root, 'PUT', `/platform/admins/${me.id}`, { active: false })).status).toBe(400);
    // Cambiar el correo propio exige la contraseña actual.
    const noPass = await api(app, root, 'PUT', `/platform/admins/${me.id}`, { email: 'nuevo-root@plataforma.test' });
    expect(noPass.status).toBe(400);
    const changed = await api(app, root, 'PUT', `/platform/admins/${me.id}`, { email: 'nuevo-root@plataforma.test', currentPassword: ROOT.password });
    expect(changed.body.user.email).toBe('nuevo-root@plataforma.test');
    // Al reiniciar no se vuelve a crear el superadministrador de las variables de entorno.
    const again = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password });
    expect((await api(again, null, 'POST', '/auth/login', ROOT)).status).toBe(401);
    await again.close();
    await api(app, root, 'PUT', `/platform/admins/${me.id}`, { email: ROOT.email, currentPassword: ROOT.password });
  });
});

describe('ajustes de la plataforma', () => {
  it('configura la página de inicio, el registro y la marca del ingreso', async () => {
    const defaults = await api(app, null, 'GET', '/public/config');
    expect(defaults.body).toMatchObject({ homePage: 'landing', allowSignup: true, emailEnabled: false });
    expect(defaults.body.brand.appName).toBe('Gestión de Colas');

    const saved = await api(app, root, 'PUT', '/platform/settings', {
      homePage: 'login',
      allowSignup: false,
      allowDemo: false,
      brand: { appName: 'Turnos SAA', primaryColor: '#0f766e', loginTitle: 'Bienvenido' },
    });
    expect(saved.status).toBe(200);
    const config = (await api(app, null, 'GET', '/public/config')).body;
    expect(config).toMatchObject({ homePage: 'login', allowSignup: false, allowDemo: false });
    expect(config.brand).toMatchObject({ appName: 'Turnos SAA', primaryColor: '#0f766e', loginTitle: 'Bienvenido' });
    // El resto de la marca conserva sus valores.
    expect(config.brand.loginText).toContain('sucursales');

    const register = await api(app, null, 'POST', '/auth/register', { organizationName: 'Nueva', name: 'Nora', email: uniqueEmail('nora'), password: 'password123' });
    expect(register.status).toBe(403);
    expect((await api(app, root, 'PUT', '/platform/settings', { homePage: 'redirect', homeRedirectUrl: '' })).status).toBe(400);
    expect((await api(app, root, 'PUT', '/platform/settings', { brand: { primaryColor: 'verde' } })).status).toBe(400);

    await api(app, root, 'PUT', '/platform/settings', { homePage: 'landing', allowSignup: true, allowDemo: true, brand: { appName: 'Gestión de Colas' } });
  });
});

describe('correo saliente', () => {
  const settings = () => ({
    enabled: true,
    host: '127.0.0.1',
    port: smtpPort,
    security: 'none',
    username: '',
    password: 'secreta',
    fromName: 'Turnos',
    fromEmail: 'turnos@plataforma.test',
    replyTo: '',
  });

  it('valida, guarda cifrado y prueba el servidor de la plataforma', async () => {
    expect((await api(app, root, 'PUT', '/platform/mail', { ...settings(), host: '' })).status).toBe(400);
    const saved = await api(app, root, 'PUT', '/platform/mail', settings());
    expect(saved.status).toBe(200);
    expect(saved.body.active).toBe('platform');
    expect(saved.body.settings).toMatchObject({ host: '127.0.0.1', hasPassword: true });
    expect(saved.body.settings.password).toBeUndefined();
    const [row] = await app.ctx.db.select().from(mailSettings).where(eq(mailSettings.scope, 'platform'));
    expect(row!.passwordEnc).not.toContain('secreta');

    const test = await api(app, root, 'POST', '/platform/mail/test', { ...settings(), password: undefined, to: 'destino@plataforma.test' });
    expect(test.status).toBe(200);
    expect(smtp.received.at(-1)!.to[0]).toContain('destino@plataforma.test');

    const closed = await api(app, root, 'POST', '/platform/mail/test', { ...settings(), port: 1, to: 'destino@plataforma.test' });
    expect(closed.status).toBe(400);
    expect(closed.body.message).toMatch(/No se pudo conectar/);

    expect((await api(app, null, 'GET', '/public/config')).body.emailEnabled).toBe(true);
  });

  it('las invitaciones salen por SMTP y cada organización puede usar su servidor', async () => {
    const before = smtp.received.length;
    const invited = await api(app, org, 'POST', '/users', { name: 'Iván', email: uniqueEmail('ivan'), role: 'agent' });
    expect(invited.status).toBe(201);
    expect(invited.body.invitation).toMatchObject({ emailSent: true, emailError: null });
    expect(smtp.received.length).toBe(before + 1);
    expect(smtp.received.at(-1)!.data).toContain('From: Turnos <turnos@plataforma.test>');

    const status = await api(app, org, 'GET', '/mail-settings');
    expect(status.body.active).toBe('platform');
    const own = await api(app, org, 'PUT', '/mail-settings', { ...settings(), fromName: 'Sanatorio', fromEmail: 'avisos@sanatorio.test' });
    expect(own.body.active).toBe('tenant');
    await api(app, null, 'POST', '/auth/forgot-password', { email: (await api(app, org, 'GET', '/auth/me')).body.user.email });
    expect(smtp.received.at(-1)!.data).toContain('avisos@sanatorio.test');

    // Otra organización sigue usando el servidor de la plataforma.
    const other = await registerTenant(app, 'Otra Org');
    expect((await api(app, other, 'GET', '/mail-settings')).body.active).toBe('platform');
  });

  it('una organización no puede usar servidores de la red interna (salvo instalaciones propias)', async () => {
    const strict = await createTestApp({ WEBHOOKS_ALLOW_PRIVATE: 'false' });
    try {
      const tenant = await registerTenant(strict, 'Org Estricta');
      const saved = await api(strict, tenant, 'PUT', '/mail-settings', settings());
      expect(saved.status).toBe(400);
      expect(saved.body.message).toMatch(/red privada/);
      expect((await api(strict, tenant, 'POST', '/mail-settings/test', { ...settings(), to: 'x@plataforma.test' })).status).toBe(400);
    } finally {
      await strict.close();
    }
  });
});
