import { mkdtempSync, statSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import ssh2 from 'ssh2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, backupTargets, backups } from '../src/db/schema';
import { api, createTestApp } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };

/* ------------------------- Servidores de prueba ------------------------- */

function listen(server: HttpServer | ssh2.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

/** WebDAV mínimo con usuario y contraseña. */
function fakeWebdav(user: string, password: string) {
  const files = new Map<string, Buffer>();
  const folders = new Set<string>();
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`) return void res.writeHead(401).end();
    const url = decodeURIComponent(req.url!);
    if (req.method === 'MKCOL') return void res.writeHead(folders.has(url) ? 405 : (folders.add(url), 201)).end();
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c)).on('end', () => {
        files.set(url, Buffer.concat(chunks));
        res.writeHead(201).end();
      });
      return;
    }
    if (req.method === 'DELETE') return void res.writeHead(files.delete(url) ? 204 : 404).end();
    res.writeHead(405).end();
  });
  return { server, files };
}

/** S3 mínimo (estilo de ruta): rechaza la clave «MALA». */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const server = createServer((req, res) => {
    if (/Credential=MALA/.test(req.headers.authorization ?? '')) {
      res.writeHead(403, { 'content-type': 'application/xml' });
      return void res.end('<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code><Message>bad</Message></Error>');
    }
    const key = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c)).on('end', () => {
        objects.set(key, Buffer.concat(chunks));
        res.writeHead(200, { etag: '"abc"' }).end();
      });
      return;
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      return void res.writeHead(204).end();
    }
    res.writeHead(405).end();
  });
  return { server, objects };
}

/** SFTP mínimo en memoria con usuario y contraseña. */
function fakeSftp() {
  const { STATUS_CODE } = ssh2.utils.sftp;
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>(['.']);
  const norm = (p: string) => path.posix.normalize(p);
  const attrs = (size: number, dir: boolean) => ({ mode: dir ? 0o40755 : 0o100644, uid: 0, gid: 0, size, atime: 0, mtime: 0 });
  const server = new ssh2.Server({ hostKeys: [ssh2.utils.generateKeyPairSync('ed25519').private] }, (client) => {
    client
      .on('authentication', (ctx) => (ctx.method === 'password' && ctx.username === 'copias' && ctx.password === 'clave-sftp' ? ctx.accept() : ctx.reject(['password'])))
      .on('ready', () =>
        client.on('session', (accept) =>
          accept().on('sftp', (acceptSftp) => {
            const sftp = acceptSftp();
            const open = new Map<number, { path: string; data: Buffer }>();
            let next = 0;
            const handleOf = (h: Buffer) => open.get(h.readUInt32BE(0));
            sftp
              .on('OPEN', (id, filename) => {
                const h = Buffer.alloc(4);
                h.writeUInt32BE(next);
                open.set(next++, { path: norm(filename), data: Buffer.alloc(0) });
                sftp.handle(id, h);
              })
              .on('WRITE', (id, handle, offset, data) => {
                const f = handleOf(handle)!;
                const end = offset + data.length;
                if (f.data.length < end) f.data = Buffer.concat([f.data, Buffer.alloc(end - f.data.length)]);
                data.copy(f.data, offset);
                sftp.status(id, STATUS_CODE.OK);
              })
              .on('FSTAT', (id, handle) => sftp.attrs(id, attrs(handleOf(handle)?.data.length ?? 0, false)))
              .on('FSETSTAT', (id) => sftp.status(id, STATUS_CODE.OK))
              .on('CLOSE', (id, handle) => {
                const f = handleOf(handle);
                if (f) files.set(f.path, f.data);
                open.delete(handle.readUInt32BE(0));
                sftp.status(id, STATUS_CODE.OK);
              })
              .on('STAT', (id, p) => {
                const n = norm(p);
                if (dirs.has(n)) sftp.attrs(id, attrs(0, true));
                else if (files.has(n)) sftp.attrs(id, attrs(files.get(n)!.length, false));
                else sftp.status(id, STATUS_CODE.NO_SUCH_FILE);
              })
              .on('MKDIR', (id, p) => {
                dirs.add(norm(p));
                sftp.status(id, STATUS_CODE.OK);
              })
              .on('REMOVE', (id, p) => sftp.status(id, files.delete(norm(p)) ? STATUS_CODE.OK : STATUS_CODE.NO_SUCH_FILE));
          }),
        ),
      )
      .on('error', () => undefined);
  });
  return { server, files, dirs };
}

/* -------------------------------- Pruebas -------------------------------- */

let app: FastifyInstance;
let root: { headers: Record<string, string> };
const dav = fakeWebdav('ana', 'clave-dav');
const s3 = fakeS3();
const sftp = fakeSftp();
let davPort = 0;
let s3Port = 0;
let sftpPort = 0;
/** Puerto donde no escucha nadie. */
let closedPort = 0;

beforeAll(async () => {
  [davPort, s3Port, sftpPort] = await Promise.all([listen(dav.server), listen(s3.server), listen(sftp.server)]);
  const probe = createServer();
  closedPort = await listen(probe);
  await new Promise((r) => probe.close(r));
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password, BACKUP_DIR: mkdtempSync(path.join(os.tmpdir(), 'gc-targets-')) });
  await app.ctx.db.delete(backups);
  await app.ctx.db.delete(backupTargets);
  const login = await api(app, null, 'POST', '/auth/login', ROOT);
  root = { headers: { authorization: `Bearer ${login.body.token}` } };
});

afterAll(async () => {
  await app.ctx.db.delete(backupTargets);
  await app.ctx.db.delete(backups);
  await app.close();
  dav.server.close();
  s3.server.close();
  sftp.server.close();
});

async function waitFor(id: string) {
  for (let i = 0; i < 150; i++) {
    const [row] = await app.ctx.db.select().from(backups).where(eq(backups.id, id));
    if (row && row.status !== 'running') return row;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('la copia no terminó');
}

const davInput = (password?: string, url = `http://127.0.0.1:${davPort}/dav/Copias/`) => ({
  kind: 'webdav',
  name: 'Nextcloud de la oficina',
  config: { provider: 'nextcloud', url, username: 'ana' },
  secrets: password === undefined ? {} : { password },
});
const s3Input = (accessKeyId = 'CLAVE', secretAccessKey = 'secreto-s3') => ({
  kind: 's3',
  name: 'MinIO',
  config: { provider: 'minio', endpoint: `http://127.0.0.1:${s3Port}`, region: 'us-east-1', bucket: 'copias', prefix: 'gc/', pathStyle: true },
  secrets: { accessKeyId, secretAccessKey },
});
const sftpInput = (hostFingerprint = '') => ({
  kind: 'sftp',
  name: 'NAS',
  config: { host: '127.0.0.1', port: sftpPort, username: 'copias', path: 'respaldo/diario', hostFingerprint },
  secrets: { password: 'clave-sftp' },
});

describe('destinos externos de las copias', () => {
  const ids: Record<string, string> = {};

  it('prueba la conexión antes de guardar y explica los errores', async () => {
    const bad = await api(app, root, 'POST', '/platform/backups/targets/test', davInput('otra'));
    expect(bad.body).toMatchObject({ ok: false, message: 'Usuario o contraseña incorrectos, o sin permiso de escritura.' });
    const ok = await api(app, root, 'POST', '/platform/backups/targets/test', davInput('clave-dav'));
    expect(ok.body.ok).toBe(true);
    expect(ok.body.message).toContain('/dav/Copias/');
    expect(dav.files.size).toBe(0);

    expect((await api(app, root, 'POST', '/platform/backups/targets/test', s3Input('MALA'))).body).toMatchObject({ ok: false, message: 'La clave secreta no es correcta.' });
    expect((await api(app, root, 'POST', '/platform/backups/targets/test', s3Input())).body.ok).toBe(true);
    const refused = await api(app, root, 'POST', '/platform/backups/targets/test', davInput('x', `http://127.0.0.1:${closedPort}/dav/`));
    expect(refused.body.message).toBe('El servidor rechazó la conexión: revise la dirección y el puerto.');
  });

  it('exige las claves y no las devuelve nunca', async () => {
    expect((await api(app, root, 'POST', '/platform/backups/targets', { ...s3Input(), secrets: {} })).status).toBe(400);
    expect((await api(app, root, 'POST', '/platform/backups/targets', { ...sftpInput(), secrets: {} })).status).toBe(400);
    expect((await api(app, org(), 'POST', '/platform/backups/targets', davInput('clave-dav'))).status).toBe(401);

    for (const [key, input] of Object.entries({ dav: davInput('clave-dav'), s3: s3Input(), sftp: sftpInput() })) {
      const res = await api(app, root, 'POST', '/platform/backups/targets', input);
      expect(res.status).toBe(200);
      ids[key] = res.body.id;
    }
    const status = await api(app, root, 'GET', '/platform/backups');
    expect(status.body.targets.map((t: { summary: string }) => t.summary)).toEqual([`127.0.0.1:${davPort}/dav/Copias/`, 'MinIO u otro compatible · copias/gc', `copias@127.0.0.1:${sftpPort}:respaldo/diario`]);
    expect(status.body.targets[1].secrets).toEqual({ accessKeyId: true, secretAccessKey: true });
    const json = JSON.stringify(status.body);
    for (const secret of ['clave-dav', 'secreto-s3', 'clave-sftp']) expect(json).not.toContain(secret);
    const [row] = await app.ctx.db.select().from(backupTargets).where(eq(backupTargets.id, ids.s3!));
    expect(row!.secret).not.toContain('secreto-s3');

    // Cambiar el nombre sin reenviar la contraseña la conserva.
    const renamed = await api(app, root, 'PUT', `/platform/backups/targets/${ids.dav}`, { ...davInput(), name: 'Nextcloud' });
    expect(renamed.body.secrets).toEqual({ password: true });
    expect((await api(app, root, 'POST', '/platform/backups/targets/test', { ...davInput(), id: ids.dav })).body.ok).toBe(true);
    const logs = await app.ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'platform.backup_target_create'));
    expect(JSON.stringify(logs.map((l) => l.changes))).not.toContain('clave-sftp');
  });

  it('SFTP guarda la huella del servidor y rechaza otra', async () => {
    const first = await api(app, root, 'POST', '/platform/backups/targets/test', { ...sftpInput(), id: ids.sftp });
    expect(first.body).toMatchObject({ ok: true });
    expect(first.body.fingerprint).toMatch(/^SHA256:/);
    const status = await api(app, root, 'GET', '/platform/backups');
    expect(status.body.targets[2].config.hostFingerprint).toBe(first.body.fingerprint);
    expect(status.body.targets[2].lastTest).toMatchObject({ ok: true });

    const changed = await api(app, root, 'POST', '/platform/backups/targets/test', { ...sftpInput('SHA256:otro'), id: ids.sftp });
    expect(changed.body).toMatchObject({ ok: false });
    expect(changed.body.message).toContain('huella del servidor SFTP cambió');
    expect(sftp.dirs.has('respaldo/diario')).toBe(true);
  });

  it('sube cada copia a los destinos activos y la borra de ellos', async () => {
    const created = await api(app, root, 'POST', '/platform/backups');
    expect(created.status).toBe(202);
    const done = await waitFor(created.body.id);
    expect(done.status).toBe('ok');
    const size = statSync(path.join(app.ctx.backups.dir, done.file)).size;
    expect(done.remotes.map((r) => [r.name, r.ok])).toEqual([
      ['Nextcloud', true],
      ['MinIO', true],
      ['NAS', true],
    ]);
    expect(dav.files.get(`/dav/Copias/${done.file}`)?.length).toBe(size);
    expect(s3.objects.get(`/copias/gc/${done.file}`)?.length).toBe(size);
    expect(sftp.files.get(`respaldo/diario/${done.file}`)?.length).toBe(size);

    await api(app, root, 'DELETE', `/platform/backups/${done.id}`);
    expect(dav.files.size).toBe(0);
    expect(s3.objects.size).toBe(0);
    expect(sftp.files.size).toBe(0);
  });

  it('si un destino falla la copia queda y se puede volver a subir', async () => {
    await api(app, root, 'PUT', `/platform/backups/targets/${ids.s3}`, { ...s3Input(), enabled: false });
    await api(app, root, 'PUT', `/platform/backups/targets/${ids.sftp}`, { ...sftpInput(), enabled: false });
    await api(app, root, 'PUT', `/platform/backups/targets/${ids.dav}`, davInput(undefined, `http://127.0.0.1:${closedPort}/dav/`));
    const created = await api(app, root, 'POST', '/platform/backups');
    const done = await waitFor(created.body.id);
    expect(done.status).toBe('ok');
    expect(done.remotes).toEqual([expect.objectContaining({ name: 'Nextcloud de la oficina', ok: false, error: 'El servidor rechazó la conexión: revise la dirección y el puerto.' })]);
    expect(app.ctx.mailer.outbox().some((m) => m.subject === 'No se pudo subir la copia de seguridad' && m.text.includes('Nextcloud de la oficina'))).toBe(true);
    const status = await api(app, root, 'GET', '/platform/backups');
    expect(status.body.targets[0].lastUpload).toMatchObject({ ok: false });

    await api(app, root, 'PUT', `/platform/backups/targets/${ids.dav}`, davInput());
    const retried = await api(app, root, 'POST', `/platform/backups/${done.id}/upload`);
    expect(retried.status).toBe(200);
    expect(retried.body.remotes).toEqual([expect.objectContaining({ ok: true, location: `http://127.0.0.1:${davPort}/dav/Copias/${done.file}` })]);
    expect(dav.files.has(`/dav/Copias/${done.file}`)).toBe(true);

    expect((await api(app, root, 'DELETE', `/platform/backups/targets/${ids.dav}`)).status).toBe(204);
    expect((await api(app, root, 'GET', '/platform/backups')).body.targets).toHaveLength(2);
  });
});

/** Sesión sin permisos (sin token). */
const org = () => ({ headers: {} as Record<string, string> });
