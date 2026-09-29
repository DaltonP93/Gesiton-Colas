import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenants } from '../src/db/schema';
import { api, createTestApp, registerTenant, uniqueEmail } from './helpers';

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

function lastMail(to: string, tag: string) {
  const mail = app.ctx.mailer.outbox().find((m) => m.to === to && m.tag === tag);
  if (!mail) throw new Error(`No se envió el correo ${tag} a ${to}`);
  return mail;
}
const linkToken = (text: string) => /token=([A-Za-z0-9]+)/.exec(text)![1]!;
const mailCode = (text: string) => /Código: (\d{6})/.exec(text)![1]!;
const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe('verificación de correo', () => {
  it('envía el correo al registrarse y lo confirma con el enlace', async () => {
    const email = uniqueEmail('verify');
    const res = await api(app, null, 'POST', '/auth/register', { organizationName: 'Verificar SA', name: 'Vera', email, password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.user.emailVerified).toBe(false);
    const mail = lastMail(email, 'verify_email');
    expect(mail.html).toContain('Confirmar mi correo');
    expect(mail.subject).toContain('Verificar SA');

    const verified = await api(app, null, 'POST', '/auth/verify-email', { token: linkToken(mail.text) });
    expect(verified.status).toBe(200);
    expect(verified.body.user.emailVerified).toBe(true);
    expect(verified.body.token).toBeTruthy();
    // El enlace es de un solo uso.
    expect((await api(app, null, 'POST', '/auth/verify-email', { token: linkToken(mail.text) })).status).toBe(400);
  });

  it('con verificación obligatoria no deja ingresar sin confirmar', async () => {
    const strict = await createTestApp({ EMAIL_VERIFICATION: 'required' });
    try {
      const email = uniqueEmail('strict');
      const res = await api(strict, null, 'POST', '/auth/register', { organizationName: 'Estricta', name: 'Ema', email, password: 'password123' });
      expect(res.body).toEqual({ verificationRequired: true, email });
      const login = await api(strict, null, 'POST', '/auth/login', { email, password: 'password123' });
      expect(login.status).toBe(403);
      expect(login.body.error).toBe('email_not_verified');
      const mail = strict.ctx.mailer.outbox().find((m) => m.to === email)!;
      await api(strict, null, 'POST', '/auth/verify-email', { token: linkToken(mail.text) });
      expect((await api(strict, null, 'POST', '/auth/login', { email, password: 'password123' })).status).toBe(200);
    } finally {
      await strict.close();
    }
  });
});

describe('olvidé mi contraseña', () => {
  it('restablece la contraseña y cierra las sesiones anteriores', async () => {
    const org = await registerTenant(app, 'Olvidadiza');
    const me = await api(app, org, 'GET', '/auth/me');
    const email = me.body.user.email as string;

    const unknown = await api(app, null, 'POST', '/auth/forgot-password', { email: 'nadie@test.local' });
    const known = await api(app, null, 'POST', '/auth/forgot-password', { email });
    expect(unknown.body).toEqual(known.body);

    const token = linkToken(lastMail(email, 'reset_password').text);
    await new Promise((r) => setTimeout(r, 1100)); // el token de sesión anterior queda en un segundo previo
    const reset = await api(app, null, 'POST', '/auth/reset-password', { token, password: 'nuevaClave456' });
    expect(reset.status).toBe(200);

    expect((await api(app, org, 'GET', '/auth/me')).status).toBe(401);
    expect((await api(app, bearer(reset.body.token), 'GET', '/auth/me')).status).toBe(200);
    expect((await api(app, null, 'POST', '/auth/login', { email, password: 'password123' })).status).toBe(401);
    expect((await api(app, null, 'POST', '/auth/login', { email, password: 'nuevaClave456' })).status).toBe(200);
    expect((await api(app, null, 'POST', '/auth/reset-password', { token, password: 'otraClave789' })).status).toBe(400);
  });
});

describe('acceso por correo sin contraseña', () => {
  it('ingresa con el código de 6 dígitos y bloquea tras varios intentos', async () => {
    const org = await registerTenant(app, 'Por código');
    const email = (await api(app, org, 'GET', '/auth/me')).body.user.email as string;

    await api(app, null, 'POST', '/auth/email-login', { email });
    const code = mailCode(lastMail(email, 'email_login').text);
    const ok = await api(app, null, 'POST', '/auth/email-login/verify', { email, code });
    expect(ok.status).toBe(200);
    expect(ok.body.user.emailVerified).toBe(true);

    await api(app, null, 'POST', '/auth/email-login', { email });
    const good = mailCode(lastMail(email, 'email_login').text);
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await api(app, null, 'POST', '/auth/email-login/verify', { email, code: bad })).status).toBe(400);
    }
    // Tras 5 intentos fallidos el código deja de valer aunque sea correcto.
    expect((await api(app, null, 'POST', '/auth/email-login/verify', { email, code: good })).status).toBe(400);
  });

  it('ingresa con el enlace del correo', async () => {
    const org = await registerTenant(app, 'Por enlace');
    const email = (await api(app, org, 'GET', '/auth/me')).body.user.email as string;
    await api(app, null, 'POST', '/auth/email-login', { email });
    const res = await api(app, null, 'POST', '/auth/email-login/verify', { token: linkToken(lastMail(email, 'email_login').text) });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });
});

describe('invitaciones', () => {
  it('invita por correo, el usuario acepta y elige su contraseña', async () => {
    const org = await registerTenant(app, 'Con equipo');
    const email = uniqueEmail('invitado');
    const created = await api(app, org, 'POST', '/users', { email, name: 'Iván Invitado', role: 'agent' });
    expect(created.status).toBe(201);
    expect(created.body.invitePending).toBe(true);
    expect((await api(app, null, 'POST', '/auth/login', { email, password: 'cualquiera' })).body.error).toBe('invite_pending');

    const mail = lastMail(email, 'invite');
    expect(mail.subject).toContain('Con equipo');
    const token = linkToken(mail.text);
    const info = await api(app, null, 'GET', `/auth/invite/${token}`);
    expect(info.body).toMatchObject({ email, organization: 'Con equipo' });

    const accepted = await api(app, null, 'POST', '/auth/accept-invite', { token, password: 'password123' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.user).toMatchObject({ invitePending: false, hasPassword: true, emailVerified: true });
    expect((await api(app, null, 'POST', '/auth/login', { email, password: 'password123' })).status).toBe(200);
    expect((await api(app, org, 'POST', `/users/${created.body.id}/invite`)).status).toBe(400);
  });
});

describe('demo por correo', () => {
  it('crea una organización de ejemplo con historial y la envía por correo', async () => {
    const email = uniqueEmail('demo');
    const res = await api(app, null, 'POST', '/auth/demo', { email, name: 'Diana Demo' });
    expect(res.status).toBe(200);
    const mail = lastMail(email, 'demo');
    expect(mail.subject).toContain('demo');

    const session = await api(app, null, 'POST', '/auth/email-login/verify', { token: linkToken(mail.text) });
    expect(session.status).toBe(200);
    expect(session.body.tenant.isDemo).toBe(true);
    expect(new Date(session.body.tenant.demoExpiresAt).getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 3600 * 1000);
    expect(session.body.user.hasPassword).toBe(false);
    const auth = bearer(session.body.token);

    const [branch] = (await api(app, auth, 'GET', '/branches')).body;
    const queue = await api(app, auth, 'GET', `/branches/${branch.id}/queue`);
    expect(queue.body.waiting).toHaveLength(6);
    const from = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const summary = await api(app, auth, 'GET', `/reports/summary?from=${from}&to=${new Date().toISOString().slice(0, 10)}`);
    expect(summary.body.totals.finished).toBeGreaterThan(20);
    expect(summary.body.byAgent.length).toBeGreaterThan(0);

    // Sin contraseña: la define desde el perfil sin necesitar la actual.
    expect((await api(app, null, 'POST', '/auth/login', { email, password: 'x' })).body.error).toBe('no_password');
    const profile = await api(app, auth, 'PUT', '/auth/me', { newPassword: 'miClaveDemo1' });
    expect(profile.body.token).toBeTruthy();
    expect((await api(app, null, 'POST', '/auth/login', { email, password: 'miClaveDemo1' })).status).toBe(200);

    // Pedir otra demo con el mismo correo envía el acceso a la existente.
    await api(app, null, 'POST', '/auth/demo', { email, name: 'Diana Demo' });
    expect(lastMail(email, 'email_login')).toBeTruthy();

    // Una demo vencida queda bloqueada.
    await app.ctx.db.update(tenants).set({ demoExpiresAt: new Date(Date.now() - 1000) }).where(eq(tenants.id, session.body.tenant.id));
    const blocked = await api(app, bearer(profile.body.token), 'GET', '/branches');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('demo_expired');
  });
});
