import { existsSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema';
import { api, createTestApp, registerTenant, uniqueEmail, type TenantSession } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };
// PNG de 1x1
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let app: FastifyInstance;
let org: TenantSession;

function uploadAvatar(session: { headers: Record<string, string> }, data: Buffer, type = 'image/png') {
  const boundary = '----gcavatar';
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/me/avatar',
    headers: { ...session.headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="foto"\r\nContent-Type: ${type}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}

/** Archivo en disco de una dirección /uploads/… */
const fileOf = (url: string) => path.join(app.ctx.storage.localDir!, url.replace(/^\/uploads\//, ''));

beforeAll(async () => {
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password });
  org = await registerTenant(app, 'Perfiles SA');
});

afterAll(async () => {
  await app.close();
});

describe('foto de perfil', () => {
  it('sube, reemplaza y quita la foto borrando el archivo anterior', async () => {
    const first = await uploadAvatar(org, PNG);
    expect(first.statusCode).toBe(200);
    const url: string = first.json().user.avatarUrl;
    expect(url).toMatch(new RegExp(`^/uploads/avatars/${org.userId}/[0-9a-f-]+\\.png$`));
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);

    // El tipo se toma de los bytes, no de lo que declara el navegador.
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    const second = await uploadAvatar(org, jpeg, 'image/png');
    const next: string = second.json().user.avatarUrl;
    expect(next).toMatch(/\.jpg$/);
    expect(existsSync(fileOf(url))).toBe(false);
    expect(existsSync(fileOf(next))).toBe(true);

    const list = await api(app, org, 'GET', '/users');
    expect(list.body.find((u: { id: string }) => u.id === org.userId).avatarUrl).toBe(next);

    const removed = await api(app, org, 'DELETE', '/auth/me/avatar');
    expect(removed.body.user.avatarUrl).toBeNull();
    expect(existsSync(fileOf(next))).toBe(false);
  });

  it('rechaza lo que no es una foto JPG, PNG o WebP y las fotos muy grandes', async () => {
    const svg = await uploadAvatar(org, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml');
    expect(svg.statusCode).toBe(400);
    const fake = await uploadAvatar(org, Buffer.from('no soy una imagen'), 'image/png');
    expect(fake.statusCode).toBe(400);
    const big = await uploadAvatar(org, Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]));
    expect(big.statusCode).toBe(413);
    const [row] = await app.ctx.db.select().from(users).where(eq(users.id, org.userId));
    expect(row!.avatarUrl).toBeNull();
  });

  it('borra la foto cuando se elimina al usuario', async () => {
    const email = uniqueEmail('op');
    const created = await api(app, org, 'POST', '/users', { name: 'Operador Foto', email, password: 'password123', role: 'agent' });
    const login = await api(app, null, 'POST', '/auth/login', { email, password: 'password123' });
    const session = { headers: { authorization: `Bearer ${login.body.token}` } };
    const url: string = (await uploadAvatar(session, PNG)).json().user.avatarUrl;
    expect(existsSync(fileOf(url))).toBe(true);
    expect((await api(app, org, 'DELETE', `/users/${created.body.id}`)).status).toBe(204);
    expect(existsSync(fileOf(url))).toBe(false);
  });
});

describe('datos del perfil', () => {
  it('en una organización no se cambia el propio correo', async () => {
    const res = await api(app, org, 'PUT', '/auth/me', { email: uniqueEmail('otro'), currentPassword: 'password123' });
    expect(res.status).toBe(403);
    expect((await api(app, org, 'PUT', '/auth/me', { phone: 'llamame' })).status).toBe(400);
  });

  it('el superadministrador cambia su correo con la contraseña actual y carga su celular', async () => {
    const email = uniqueEmail('soporte');
    await api(app, { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', ROOT)).body.token}` } }, 'POST', '/platform/admins', {
      name: 'Soporte Dos',
      email,
      password: 'clave-soporte-1',
    });
    const session = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', { email, password: 'clave-soporte-1' })).body.token}` } };
    const next = uniqueEmail('soporte-nuevo');

    expect((await api(app, session, 'PUT', '/auth/me', { email: next })).status).toBe(400);
    expect((await api(app, session, 'PUT', '/auth/me', { email: next, currentPassword: 'otra' })).status).toBe(400);
    expect((await api(app, session, 'PUT', '/auth/me', { email: ROOT.email, currentPassword: 'clave-soporte-1' })).status).toBe(409);

    const ok = await api(app, session, 'PUT', '/auth/me', { email: next, currentPassword: 'clave-soporte-1', phone: '0981 444 555', name: 'Soporte Nuevo' });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ email: next, phone: '0981 444 555', name: 'Soporte Nuevo' });
    expect((await api(app, null, 'POST', '/auth/login', { email: next, password: 'clave-soporte-1' })).status).toBe(200);

    // Vaciar el celular lo borra.
    expect((await api(app, session, 'PUT', '/auth/me', { phone: '' })).body.user.phone).toBeNull();
  });
});
