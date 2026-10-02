import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  backupTargetSummary,
  type BackupDTO,
  type BackupRemoteDTO,
  type BackupSettings,
  type BackupTargetDTO,
  type BackupTargetInput,
  type BackupTargetTestDTO,
  type PlatformSettings,
} from '@gc/shared';
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import { backupTargets, backups, users, type Backup, type BackupTarget } from '../db/schema';
import { friendlyTargetError, uploaderFor, type TargetSecrets } from './backupTargets';
import { decryptSecret, encryptSecret } from './crypto';
import { badRequest, notFound } from './errors';
import { assertPublicHost, assertPublicUrl } from './net';
import type { Mailer } from './mailer';
import type { PlatformNotices } from './platformNotices';

/*
 * Copias de seguridad: un archivo .tar.gz con la base (pg_dump, formato custom), los archivos
 * subidos (si se guardan en disco) y un manifiesto. Se restauran con:
 *   docker compose stop app
 *   docker compose run --rm app node apps/api/dist/db/admin-cli.js restore /data/backups/<archivo> --confirm
 *   docker compose start app
 * Contienen todos los datos (también claves de pasarelas y correos): se guardan con permisos 600
 * y solo el superadministrador las ve y descarga.
 */

export const backupDir = (config: Pick<AppConfig, 'BACKUP_DIR' | 'UPLOAD_DIR'>) =>
  path.resolve(config.BACKUP_DIR ?? path.join(path.dirname(path.resolve(config.UPLOAD_DIR)), 'backups'));

/** Variables de conexión para pg_dump / pg_restore (la contraseña no queda en la línea de comandos). */
function pgEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ''),
    ...(url.searchParams.get('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode')! } : {}),
  };
}

function bin(config: Pick<AppConfig, 'PG_BIN_DIR'>, name: string) {
  return config.PG_BIN_DIR ? path.join(config.PG_BIN_DIR, name) : name;
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: env ?? process.env, cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += String(c)));
    child.on('error', (error) => reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error(`No se encontró ${cmd} en el servidor`) : error));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} terminó con error ${code}: ${stderr.trim().slice(-400)}`))));
  });
}

export async function hasPgDump(config: Pick<AppConfig, 'PG_BIN_DIR'>) {
  try {
    await run(bin(config, 'pg_dump'), ['--version']);
    return true;
  } catch {
    return false;
  }
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
/** Nombre de los archivos de copia (también evita rutas fuera de la carpeta). */
export const BACKUP_FILE = /^gestion-colas-\d{8}-\d{6}(-[a-z]+)?\.tar\.gz$/;

/** Crea la copia en `dir` y devuelve el nombre y el tamaño del archivo. */
export async function createBackupArchive(config: AppConfig, options: { includeUploads: boolean; dir: string; suffix?: string }) {
  await mkdir(options.dir, { recursive: true });
  const work = await mkdtemp(path.join(os.tmpdir(), 'gc-backup-'));
  const file = `gestion-colas-${stamp(new Date())}${options.suffix ? `-${options.suffix}` : ''}.tar.gz`;
  try {
    // El listado de copias no se guarda dentro de la copia: al restaurar se arma de nuevo con los archivos de la carpeta.
    await run(
      bin(config, 'pg_dump'),
      ['--format=custom', '--no-owner', '--no-privileges', '--exclude-table-data=backups', '--file', path.join(work, 'db.dump')],
      pgEnv(config.DATABASE_URL),
    );
    const uploads = path.resolve(config.UPLOAD_DIR);
    const withUploads = options.includeUploads && config.STORAGE_DRIVER === 'local' && existsSync(uploads);
    await writeFile(
      path.join(work, 'manifest.json'),
      JSON.stringify({ app: 'gestion-colas', format: 1, createdAt: new Date().toISOString(), uploads: withUploads ? 'uploads' : null }, null, 2),
    );
    if (withUploads) await cp(uploads, path.join(work, 'uploads'), { recursive: true });
    await run('tar', ['-czf', path.join(options.dir, file), '-C', work, '.']);
    await chmod(path.join(options.dir, file), 0o600);
    const { size } = await stat(path.join(options.dir, file));
    return { file, size };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Restaura una copia (base y archivos): reemplaza todos los datos actuales. Todo en una sola
 * transacción: si algo falla, la base queda como estaba. Conviene detener la aplicación antes.
 */
export async function restoreBackupArchive(config: AppConfig, archive: string, log: (msg: string) => void = console.log) {
  const work = await mkdtemp(path.join(os.tmpdir(), 'gc-restore-'));
  try {
    await run('tar', ['-xzf', path.resolve(archive), '-C', work]);
    let manifest: { app?: string; uploads?: string | null; createdAt?: string };
    try {
      manifest = JSON.parse(await readFile(path.join(work, 'manifest.json'), 'utf8'));
    } catch {
      throw new Error('El archivo no es una copia de Gestión de Colas (falta el manifiesto)');
    }
    if (manifest.app !== 'gestion-colas' || !existsSync(path.join(work, 'db.dump'))) throw new Error('El archivo no es una copia de Gestión de Colas');
    log(`Restaurando la base de datos de la copia del ${manifest.createdAt ?? '?'}…`);
    const env = pgEnv(config.DATABASE_URL);
    // Se vacía el esquema y se carga la copia en la misma transacción (también quita tablas más nuevas que la copia).
    await writeFile(
      path.join(work, 'reset.sql'),
      [
        "SET lock_timeout = '30s';",
        'DROP SCHEMA IF EXISTS drizzle CASCADE;',
        'DROP SCHEMA IF EXISTS public CASCADE;',
        'CREATE SCHEMA public;',
        '',
      ].join('\n'),
    );
    await run(bin(config, 'pg_restore'), ['--no-owner', '--no-privileges', '--file', path.join(work, 'restore.sql'), path.join(work, 'db.dump')], env);
    await run(bin(config, 'psql'), ['--no-psqlrc', '--quiet', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', path.join(work, 'reset.sql'), '-f', path.join(work, 'restore.sql')], env);
    if (manifest.uploads && existsSync(path.join(work, manifest.uploads))) {
      log('Restaurando los archivos subidos…');
      const uploads = path.resolve(config.UPLOAD_DIR);
      await mkdir(uploads, { recursive: true });
      // Se vacía primero (sin borrar la carpeta: suele ser un volumen montado) para que no queden
      // archivos posteriores a la copia, cuyos registros ya no existen en la base restaurada.
      for (const entry of await readdir(uploads)) await rm(path.join(uploads, entry), { recursive: true, force: true });
      await cp(path.join(work, manifest.uploads), uploads, { recursive: true, force: true });
    }
    return { createdAt: manifest.createdAt ?? null, uploads: Boolean(manifest.uploads) };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* Servicio (programación, listado, S3, avisos)                        */
/* ------------------------------------------------------------------ */

interface BackupDeps {
  config: AppConfig;
  db: Database;
  log: FastifyBaseLogger;
  mailer: Mailer;
  platformSettings(): Promise<PlatformSettings>;
  /** Avisos de la plataforma: correo y/o WhatsApp a los superadministradores. */
  notices?: PlatformNotices;
}

export function toBackupDTO(row: Backup, dir: string): BackupDTO {
  return {
    id: row.id,
    file: row.file,
    sizeBytes: row.sizeBytes,
    status: row.status,
    error: row.error,
    trigger: row.trigger,
    includesUploads: row.includesUploads,
    s3Key: row.s3Key,
    remotes: row.remotes ?? [],
    available: row.status === 'ok' && existsSync(path.join(dir, row.file)),
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

const SECRET_PURPOSE = 'backup-targets';

export function toBackupTargetDTO(row: BackupTarget, secrets: TargetSecrets): BackupTargetDTO {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    enabled: row.enabled,
    config: row.config,
    secrets: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, Boolean(v)])),
    summary: backupTargetSummary(row.kind, row.config),
    lastTest: row.lastTestAt ? { at: row.lastTestAt.toISOString(), ok: Boolean(row.lastTestOk), message: row.lastTestMessage ?? '' } : null,
    lastUpload: row.lastUploadAt ? { at: row.lastUploadAt.toISOString(), ok: Boolean(row.lastUploadOk), message: row.lastUploadMessage ?? '' } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Una copia que quedó «en curso» más de este tiempo se dio por interrumpida (reinicio del servidor). */
const STALE_MS = 6 * 3_600_000;

export class Backups {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private readonly deps: BackupDeps) {}

  get dir() {
    return backupDir(this.deps.config);
  }

  get s3Available() {
    const c = this.deps.config;
    return Boolean(c.S3_BUCKET && c.S3_ACCESS_KEY && c.S3_SECRET_KEY);
  }

  start(intervalMs = 10 * 60_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((error) => this.deps.log.error({ err: error }, 'copias: error del programador')), intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Copias registradas (más las que están en la carpeta y no figuran, p. ej. después de restaurar). */
  async list(limit = 100): Promise<Backup[]> {
    await this.syncFromDisk();
    return this.deps.db.select().from(backups).orderBy(desc(backups.startedAt)).limit(limit);
  }

  /** Agrega al listado los archivos de copia de la carpeta que no están registrados. */
  async syncFromDisk() {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => BACKUP_FILE.test(n));
    } catch {
      return;
    }
    if (!names.length) return;
    const known = new Set((await this.deps.db.select({ file: backups.file }).from(backups).where(inArray(backups.file, names))).map((r) => r.file));
    for (const name of names.filter((n) => !known.has(n))) {
      const { size, mtime } = await stat(path.join(this.dir, name));
      await this.deps.db.insert(backups).values({ file: name, sizeBytes: size, status: 'ok', trigger: 'manual', includesUploads: false, startedAt: mtime, finishedAt: mtime });
    }
  }

  /** Una vez por día, a la hora elegida (zona horaria de la plataforma). */
  async tick(now = new Date()) {
    if (this.busy) return null;
    // Las que quedaron «en curso» por un reinicio se marcan como interrumpidas.
    await this.deps.db
      .update(backups)
      .set({ status: 'failed', error: 'Interrumpida (el servidor se reinició durante la copia)', finishedAt: now })
      .where(and(eq(backups.status, 'running'), lt(backups.startedAt, new Date(now.getTime() - STALE_MS))));
    const s = (await this.deps.platformSettings()).backups;
    if (!s.enabled) return null;
    const local = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: s.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(d);
    const [day, hourPart] = local(now).split(', ');
    if (Number(hourPart) < s.hour) return null;
    const started = await this.begin('auto', null, async (tx) => {
      // Con varias instancias, solo una hace la copia del día.
      const [last] = await tx
        .select()
        .from(backups)
        .where(and(eq(backups.trigger, 'auto'), or(eq(backups.status, 'ok'), and(eq(backups.status, 'running'), gte(backups.startedAt, new Date(now.getTime() - STALE_MS))))))
        .orderBy(desc(backups.startedAt))
        .limit(1);
      return !(last && local(last.startedAt).split(', ')[0] === day);
    }, now);
    return started ? started.done : null;
  }

  /** Crea una copia y espera a que termine. */
  async run(trigger: 'auto' | 'manual', userId: string | null): Promise<Backup> {
    const started = await this.begin(trigger, userId);
    return started!.done;
  }

  /**
   * Registra la copia como «en curso» y la hace en segundo plano. `shouldRun` (opcional) decide,
   * con un bloqueo entre instancias, si todavía hace falta.
   */
  async begin(
    trigger: 'auto' | 'manual',
    userId: string | null,
    shouldRun?: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<boolean>,
    at = new Date(),
  ): Promise<{ row: Backup; done: Promise<Backup> } | null> {
    if (this.busy) throw new Error('Ya hay una copia en curso');
    this.busy = true;
    let row: Backup | undefined;
    let s: BackupSettings;
    try {
      s = (await this.deps.platformSettings()).backups;
      row = await this.deps.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('gc:backups'))`);
        if (shouldRun && !(await shouldRun(tx))) return undefined;
        const [running] = await tx
          .select({ id: backups.id })
          .from(backups)
          .where(and(eq(backups.status, 'running'), gte(backups.startedAt, new Date(Date.now() - STALE_MS))))
          .limit(1);
        if (running) throw new Error('Ya hay una copia en curso');
        const [created] = await tx.insert(backups).values({ file: '', trigger, status: 'running', includesUploads: s.includeUploads, createdBy: userId, startedAt: at }).returning();
        return created;
      });
    } catch (error) {
      this.busy = false;
      throw error;
    }
    if (!row) {
      this.busy = false;
      return null;
    }
    const id = row.id;
    const done = this.execute(id, s).finally(() => {
      this.busy = false;
    });
    return { row, done };
  }

  private async execute(id: string, s: BackupSettings): Promise<Backup> {
    try {
      const { file, size } = await createBackupArchive(this.deps.config, { includeUploads: s.includeUploads, dir: this.dir });
      const remotes: BackupRemoteDTO[] = [];
      let s3Key: string | null = null;
      if (s.s3 && this.s3Available) {
        try {
          s3Key = await this.uploadToS3(file);
          remotes.push({ targetId: null, name: 'S3 del servidor', kind: 's3', ok: true, location: s3Key, error: null, at: new Date().toISOString() });
        } catch (error) {
          remotes.push({ targetId: null, name: 'S3 del servidor', kind: 's3', ok: false, location: null, error: friendlyTargetError(error), at: new Date().toISOString() });
        }
      }
      remotes.push(...(await this.uploadToTargets(file)));
      const [done] = await this.deps.db.update(backups).set({ file, sizeBytes: size, status: 'ok', s3Key, remotes, finishedAt: new Date() }).where(eq(backups.id, id)).returning();
      this.deps.log.info({ file, size, remotes: remotes.map((r) => `${r.name}:${r.ok ? 'ok' : 'error'}`) }, 'copias: copia de seguridad creada');
      const failed = remotes.filter((r) => !r.ok);
      if (failed.length) {
        await this.alert('No se pudo subir la copia de seguridad', `La copia ${file} se creó en el servidor, pero no se pudo subir a:\n\n${failed.map((r) => `- ${r.name}: ${r.error}`).join('\n')}`);
      }
      await this.rotate(s.keepDays).catch((error) => this.deps.log.warn({ err: error }, 'copias: no se pudieron borrar las copias viejas'));
      return done!;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error';
      const [failed] = await this.deps.db.update(backups).set({ status: 'failed', error: message.slice(0, 1000), finishedAt: new Date() }).where(eq(backups.id, id)).returning();
      this.deps.log.error({ err: error }, 'copias: falló la copia de seguridad');
      await this.alert('Falló la copia de seguridad', `La copia de seguridad automática no se pudo crear:\n\n${message}`);
      return failed!;
    }
  }

  private async s3() {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const c = this.deps.config;
    return new S3Client({
      region: c.S3_REGION,
      endpoint: c.S3_ENDPOINT || undefined,
      forcePathStyle: c.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: c.S3_ACCESS_KEY!, secretAccessKey: c.S3_SECRET_KEY! },
    });
  }

  private async uploadToS3(file: string) {
    const { Upload } = await import('@aws-sdk/lib-storage');
    const key = `backups/${file}`;
    await new Upload({ client: await this.s3(), params: { Bucket: this.deps.config.S3_BUCKET!, Key: key, Body: createReadStream(path.join(this.dir, file)), ContentType: 'application/gzip' } }).done();
    return key;
  }

  /** Borra las copias más viejas que `keepDays` (en disco, en S3 y del listado). */
  async rotate(keepDays: number) {
    const limit = new Date(Date.now() - keepDays * 86_400_000);
    const old = await this.deps.db.select().from(backups).where(and(lt(backups.startedAt, limit), or(eq(backups.status, 'ok'), eq(backups.status, 'failed'))));
    for (const b of old) await this.remove(b);
    // Archivos huérfanos (copias hechas a mano o de otra instalación) más viejos que el plazo.
    try {
      for (const name of await readdir(this.dir)) {
        if (!BACKUP_FILE.test(name)) continue;
        const { mtime } = await stat(path.join(this.dir, name));
        if (mtime < limit) await rm(path.join(this.dir, name), { force: true });
      }
    } catch {
      /* la carpeta todavía no existe */
    }
  }

  async remove(b: Backup) {
    if (b.file && BACKUP_FILE.test(b.file)) await rm(path.join(this.dir, b.file), { force: true });
    if (b.s3Key && this.s3Available) {
      try {
        const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        await (await this.s3()).send(new DeleteObjectCommand({ Bucket: this.deps.config.S3_BUCKET!, Key: b.s3Key }));
      } catch (error) {
        this.deps.log.warn({ err: error, key: b.s3Key }, 'copias: no se pudo borrar la copia en S3');
      }
    }
    for (const remote of b.remotes ?? []) {
      if (!remote.ok || !remote.location || !remote.targetId) continue;
      const target = await this.findTarget(remote.targetId).catch(() => null);
      if (!target) continue;
      await uploaderFor(target.kind, target.config, this.secretsOf(target))
        .remove(remote.location)
        .catch((error) => this.deps.log.warn({ err: error, target: target.name, location: remote.location }, 'copias: no se pudo borrar la copia en el destino'));
    }
    await this.deps.db.delete(backups).where(eq(backups.id, b.id));
  }

  /* --------------------------- Destinos externos --------------------------- */

  private secretsOf(row: Pick<BackupTarget, 'secret'>): TargetSecrets {
    if (!row.secret) return {};
    const json = decryptSecret(this.deps.config.JWT_SECRET, row.secret, SECRET_PURPOSE);
    if (!json) return {};
    try {
      return JSON.parse(json) as TargetSecrets;
    } catch {
      return {};
    }
  }

  async findTarget(id: string): Promise<BackupTarget> {
    const [row] = await this.deps.db.select().from(backupTargets).where(eq(backupTargets.id, id));
    if (!row) throw notFound('Destino');
    return row;
  }

  async listTargets(): Promise<BackupTargetDTO[]> {
    const rows = await this.deps.db.select().from(backupTargets).orderBy(backupTargets.createdAt);
    return rows.map((r) => toBackupTargetDTO(r, this.secretsOf(r)));
  }

  /** Une las claves nuevas con las guardadas (vacío = conservar). */
  private mergeSecrets(input: BackupTargetInput, existing?: BackupTarget): TargetSecrets {
    const previous = existing && existing.kind === input.kind ? this.secretsOf(existing) : {};
    const next: TargetSecrets = { ...previous };
    for (const [k, v] of Object.entries(input.secrets ?? {})) if (typeof v === 'string' && v.trim()) next[k as keyof TargetSecrets] = k === 'privateKey' ? v.trim() + '\n' : v.trim();
    return next;
  }

  private assertComplete(input: BackupTargetInput, secrets: TargetSecrets) {
    if (input.kind === 's3' && (!secrets.accessKeyId || !secrets.secretAccessKey)) throw badRequest('Indique la clave de acceso y la clave secreta');
    if (input.kind === 'sftp' && !secrets.password && !secrets.privateKey) throw badRequest('Indique la contraseña o la clave privada');
  }

  /** Evita SSRF: el destino no puede apuntar a direcciones privadas/internas (salvo WEBHOOKS_ALLOW_PRIVATE). */
  private async assertTargetReachable(input: BackupTargetInput) {
    if (this.deps.config.WEBHOOKS_ALLOW_PRIVATE) return;
    try {
      if (input.kind === 'webdav') await assertPublicUrl(input.config.url);
      else if (input.kind === 'sftp') await assertPublicHost(input.config.host);
      else if (input.kind === 's3' && input.config.endpoint) await assertPublicUrl(input.config.endpoint);
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : 'El destino apunta a una dirección no permitida');
    }
  }

  async saveTarget(input: BackupTargetInput, id?: string): Promise<BackupTargetDTO> {
    const existing = id ? await this.findTarget(id) : undefined;
    const secrets = this.mergeSecrets(input, existing);
    this.assertComplete(input, secrets);
    await this.assertTargetReachable(input);
    const values = {
      kind: input.kind,
      name: input.name,
      enabled: input.enabled,
      config: input.config,
      secret: encryptSecret(this.deps.config.JWT_SECRET, JSON.stringify(secrets), SECRET_PURPOSE),
    };
    const [row] = existing
      ? await this.deps.db.update(backupTargets).set(values).where(eq(backupTargets.id, existing.id)).returning()
      : await this.deps.db.insert(backupTargets).values(values).returning();
    return toBackupTargetDTO(row!, secrets);
  }

  async deleteTarget(id: string) {
    await this.findTarget(id);
    await this.deps.db.delete(backupTargets).where(eq(backupTargets.id, id));
  }

  /**
   * Prueba un destino escribiendo y borrando un archivo. Con `id` usa las claves guardadas que no se
   * enviaron, y guarda el resultado (y la huella del servidor SFTP la primera vez).
   */
  async testTarget(input: BackupTargetInput, id?: string): Promise<BackupTargetTestDTO> {
    const existing = id ? await this.findTarget(id) : undefined;
    const secrets = this.mergeSecrets(input, existing);
    this.assertComplete(input, secrets);
    await this.assertTargetReachable(input);
    let result: BackupTargetTestDTO;
    try {
      const { message, fingerprint } = await uploaderFor(input.kind, input.config, secrets).test();
      result = { ok: true, message, fingerprint };
    } catch (error) {
      result = { ok: false, message: friendlyTargetError(error) };
    }
    if (existing) {
      const config = input.kind === 'sftp' && result.ok && result.fingerprint && !input.config.hostFingerprint ? { ...input.config, hostFingerprint: result.fingerprint } : existing.config;
      await this.deps.db
        .update(backupTargets)
        .set({ lastTestAt: new Date(), lastTestOk: result.ok, lastTestMessage: result.message, config })
        .where(eq(backupTargets.id, existing.id));
    }
    return result;
  }

  /** Sube la copia a cada destino activo y anota el resultado. */
  private async uploadToTargets(file: string, only?: (t: BackupTarget) => boolean): Promise<BackupRemoteDTO[]> {
    const targets = (await this.deps.db.select().from(backupTargets).where(eq(backupTargets.enabled, true)).orderBy(backupTargets.createdAt)).filter((t) => !only || only(t));
    const results: BackupRemoteDTO[] = [];
    for (const target of targets) {
      const at = new Date();
      try {
        const location = await uploaderFor(target.kind, target.config, this.secretsOf(target)).upload(path.join(this.dir, file), file);
        results.push({ targetId: target.id, name: target.name, kind: target.kind, ok: true, location, error: null, at: at.toISOString() });
        await this.deps.db.update(backupTargets).set({ lastUploadAt: at, lastUploadOk: true, lastUploadMessage: `Se subió ${file}` }).where(eq(backupTargets.id, target.id));
      } catch (error) {
        const message = friendlyTargetError(error);
        this.deps.log.warn({ err: error, target: target.name }, 'copias: no se pudo subir la copia');
        results.push({ targetId: target.id, name: target.name, kind: target.kind, ok: false, location: null, error: message, at: at.toISOString() });
        await this.deps.db.update(backupTargets).set({ lastUploadAt: at, lastUploadOk: false, lastUploadMessage: message }).where(eq(backupTargets.id, target.id));
      }
    }
    return results;
  }

  /** Vuelve a subir una copia a los destinos activos donde todavía no está. */
  async retryUploads(b: Backup): Promise<Backup> {
    if (b.status !== 'ok' || !existsSync(path.join(this.dir, b.file))) throw badRequest('El archivo de la copia ya no está en el servidor');
    const done = new Set((b.remotes ?? []).filter((r) => r.ok && r.targetId).map((r) => r.targetId));
    const fresh = await this.uploadToTargets(b.file, (t) => !done.has(t.id));
    const retried = new Set(fresh.map((f) => f.targetId));
    const remotes = [...(b.remotes ?? []).filter((r) => !r.targetId || !retried.has(r.targetId)), ...fresh];
    const [row] = await this.deps.db.update(backups).set({ remotes }).where(eq(backups.id, b.id)).returning();
    return row!;
  }

  /** Avisa a los superadministradores cuando una copia falla o no se puede subir. */
  private async alert(subject: string, message: string) {
    if (this.deps.notices) {
      await this.deps.notices
        .toPlatform('backup_failed', { subject, title: subject, lines: message.split('\n').filter(Boolean), outro: ['Revise Plataforma → Copias.'], whatsapp: `${subject}: ${message.split('\n').filter(Boolean).join(' ').slice(0, 300)}` })
        .catch((error) => this.deps.log.error({ err: error }, 'copias: no se pudo avisar'));
      return;
    }
    const admins = await this.deps.db.select({ email: users.email }).from(users).where(and(eq(users.role, 'superadmin'), eq(users.active, true)));
    for (const a of admins) {
      try {
        await this.deps.mailer.send(
          {
            to: a.email,
            subject,
            text: `${message}\n\nRevise Plataforma → Copias.`,
            html: `<pre style="white-space:pre-wrap;font-family:inherit">${message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)}</pre><p>Revise Plataforma → Copias.</p>`,
            tag: 'backup_failed',
          },
          { tenantId: null },
        );
      } catch {
        /* sin correo configurado */
      }
    }
  }
}
