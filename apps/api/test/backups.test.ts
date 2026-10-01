import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, backups } from '../src/db/schema';
import { restoreBackupArchive } from '../src/lib/backups';
import { api, createTestApp, registerTenant, type TenantSession } from './helpers';

// El mismo superadministrador que el resto de las pruebas (solo se crea si todavía no hay ninguno).
const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };
const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://gc:gc@127.0.0.1:5432/gestion_colas_test';
const SCRATCH = 'gestion_colas_restore_test';

let app: FastifyInstance;
let root: { headers: Record<string, string> };
let org: TenantSession;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'gc-backups-'));
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password, BACKUP_DIR: dir });
  await app.ctx.db.delete(backups);
  const login = await api(app, null, 'POST', '/auth/login', ROOT);
  root = { headers: { authorization: `Bearer ${login.body.token}` } };
  org = await registerTenant(app, 'Copias SA');
  writeFileSync(path.join(app.ctx.config.UPLOAD_DIR, 'logo.txt'), 'archivo subido');
});

afterAll(async () => {
  await api(app, root, 'PUT', '/platform/settings', { backups: { enabled: true, hour: 3 } });
  await app.close();
});

/** Espera a que termine la copia en curso. */
async function waitFor(id: string) {
  for (let i = 0; i < 100; i++) {
    const [row] = await app.ctx.db.select().from(backups).where(eq(backups.id, id));
    if (row && row.status !== 'running') return row;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('la copia no terminó');
}

const list = (archive: string) => execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });

describe('copias de seguridad', () => {
  let file = '';

  it('solo el superadministrador las ve', async () => {
    expect((await api(app, org, 'GET', '/platform/backups')).status).toBe(403);
    const status = await api(app, root, 'GET', '/platform/backups');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ ready: true, items: [], dir, settings: { enabled: true, hour: 3, keepDays: 14 } });
  });

  it('crea una copia en segundo plano con la base, los archivos y el manifiesto', async () => {
    const started = await api(app, root, 'POST', '/platform/backups');
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ status: 'running', trigger: 'manual' });
    // No se pueden hacer dos a la vez.
    expect((await api(app, root, 'POST', '/platform/backups')).status).toBe(409);

    const done = await waitFor(started.body.id);
    expect(done.status, done.error ?? '').toBe('ok');
    file = done.file;
    expect(file).toMatch(/^gestion-colas-\d{8}-\d{6}\.tar\.gz$/);
    const archive = path.join(dir, file);
    expect(statSync(archive).size).toBe(done.sizeBytes);
    expect(statSync(archive).mode & 0o777).toBe(0o600);
    const entries = list(archive);
    expect(entries).toContain('manifest.json');
    expect(entries).toContain('db.dump');
    expect(entries).toContain('uploads/logo.txt');

    const status = await api(app, root, 'GET', '/platform/backups');
    expect(status.body.items[0]).toMatchObject({ id: done.id, status: 'ok', available: true, includesUploads: true });
  });

  it('descarga la copia y deja registro de quién la bajó', async () => {
    const [row] = await app.ctx.db.select().from(backups).where(eq(backups.file, file));
    const res = await app.inject({ method: 'GET', url: `/api/v1/platform/backups/${row!.id}/download`, headers: root.headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/gzip');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${file}"`);
    expect(res.rawPayload.length).toBe(row!.sizeBytes);
    await new Promise((r) => setTimeout(r, 100));
    const logs = await app.ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'platform.backup_download'));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.summary).toContain(file);
  });

  it('se restaura en otra base (y quita lo que no estaba en la copia)', async () => {
    const admin = new pg.Pool({ connectionString: DB_URL, max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${SCRATCH}`);
    await admin.end();
    const url = new URL(DB_URL);
    url.pathname = `/${SCRATCH}`;
    const uploads = mkdtempSync(path.join(os.tmpdir(), 'gc-restored-'));
    // Un archivo posterior a la copia: después de restaurar no debe quedar.
    writeFileSync(path.join(uploads, 'posterior.txt'), 'no estaba en la copia');
    const config = { ...app.ctx.config, DATABASE_URL: url.toString(), UPLOAD_DIR: uploads };
    const scratch = new pg.Pool({ connectionString: url.toString(), max: 1 });
    try {
      await scratch.query('CREATE TABLE public.sobrante (id int)');
      await restoreBackupArchive(config, path.join(dir, file), () => undefined);
      const { rows } = await scratch.query("SELECT name FROM tenants WHERE name = 'Copias SA'");
      expect(rows).toHaveLength(1);
      const leftover = await scratch.query("SELECT to_regclass('public.sobrante') AS t");
      expect(leftover.rows[0].t).toBeNull();
      // El listado de copias no viaja dentro de la copia.
      expect((await scratch.query('SELECT count(*)::int AS n FROM backups')).rows[0].n).toBe(0);
      expect(existsSync(path.join(uploads, 'logo.txt'))).toBe(true);
      expect(existsSync(path.join(uploads, 'posterior.txt'))).toBe(false);
      // Restaurar de nuevo sobre la misma base también funciona.
      await restoreBackupArchive(config, path.join(dir, file), () => undefined);
      expect((await scratch.query("SELECT count(*)::int AS n FROM tenants WHERE name = 'Copias SA'")).rows[0].n).toBe(1);
    } finally {
      await scratch.end();
      const cleanup = new pg.Pool({ connectionString: DB_URL, max: 1 });
      await cleanup.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
      await cleanup.end();
    }
  });

  it('rechaza un archivo que no es una copia', async () => {
    const bogus = path.join(dir, 'otro.tar.gz');
    const work = mkdtempSync(path.join(os.tmpdir(), 'gc-bogus-'));
    writeFileSync(path.join(work, 'manifest.json'), JSON.stringify({ app: 'otra-cosa' }));
    execFileSync('tar', ['-czf', bogus, '-C', work, '.']);
    await expect(restoreBackupArchive(app.ctx.config, bogus, () => undefined)).rejects.toThrow('no es una copia');
  });

  it('agrega al listado las copias que están en la carpeta', async () => {
    copyFileSync(path.join(dir, file), path.join(dir, 'gestion-colas-20260101-030000.tar.gz'));
    const status = await api(app, root, 'GET', '/platform/backups');
    expect(status.body.items.map((b: { file: string }) => b.file)).toContain('gestion-colas-20260101-030000.tar.gz');
  });

  it('la copia automática se hace una vez por día a partir de la hora elegida', async () => {
    await api(app, root, 'PUT', '/platform/settings', { backups: { hour: 2, timezone: 'America/Asuncion' } });
    // 01:30 en Asunción: todavía no.
    expect(await app.ctx.backups.tick(new Date('2026-10-05T04:30:00Z'))).toBeNull();
    const first = await app.ctx.backups.tick(new Date('2026-10-05T05:30:00Z'));
    expect(first).toMatchObject({ status: 'ok', trigger: 'auto' });
    // Ese mismo día no se repite.
    expect(await app.ctx.backups.tick(new Date('2026-10-05T20:00:00Z'))).toBeNull();
    // Desactivada no hace nada.
    await api(app, root, 'PUT', '/platform/settings', { backups: { enabled: false } });
    expect(await app.ctx.backups.tick(new Date('2026-10-07T12:00:00Z'))).toBeNull();
    const settings = await api(app, root, 'GET', '/platform/settings');
    expect(settings.body.backups).toMatchObject({ enabled: false, hour: 2, keepDays: 14 });
  });

  it('borra las copias más viejas que el plazo y a pedido', async () => {
    const [old] = await app.ctx.db.select().from(backups).where(eq(backups.file, 'gestion-colas-20260101-030000.tar.gz'));
    await app.ctx.db.update(backups).set({ startedAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(backups.id, old!.id));
    await app.ctx.backups.rotate(14);
    expect(existsSync(path.join(dir, old!.file))).toBe(false);
    expect(await app.ctx.db.select().from(backups).where(eq(backups.id, old!.id))).toEqual([]);

    const [row] = await app.ctx.db.select().from(backups).where(eq(backups.file, file));
    expect((await api(app, org, 'DELETE', `/platform/backups/${row!.id}`)).status).toBe(403);
    expect((await api(app, root, 'DELETE', `/platform/backups/${row!.id}`)).status).toBe(204);
    expect(existsSync(path.join(dir, file))).toBe(false);
    expect((await api(app, root, 'GET', `/platform/backups/${row!.id}/download`)).status).toBe(404);
  });
});
