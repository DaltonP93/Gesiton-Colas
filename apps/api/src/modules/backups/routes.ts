import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { backupTargetInputSchema, type BackupDTO, type BackupStatusDTO, type BackupTargetDTO, type BackupTargetTestDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { backups } from '../../db/schema';
import { userIdOf } from '../../lib/auth';
import { BACKUP_FILE, hasPgDump, toBackupDTO } from '../../lib/backups';
import { AppError, badRequest, notFound } from '../../lib/errors';

const idParam = z.object({ id: z.uuid() });

/** Copias de seguridad de toda la plataforma (solo superadministrador). */
export const backupRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Plataforma (superadmin)'];
  const superadmin = ctx.auth.require({ role: 'superadmin' });

  const find = async (id: string) => {
    const [row] = await ctx.db.select().from(backups).where(eq(backups.id, id));
    if (!row) throw notFound('Copia');
    return row;
  };

  app.get('/platform/backups', { preHandler: superadmin, schema: { tags, summary: 'Copias de seguridad y su configuración' } }, async (): Promise<BackupStatusDTO> => {
    const [settings, rows, ready, targets] = await Promise.all([ctx.platform.get(), ctx.backups.list(), hasPgDump(ctx.config), ctx.backups.listTargets()]);
    return {
      settings: settings.backups,
      items: rows.map((r) => toBackupDTO(r, ctx.backups.dir)),
      ready,
      dir: ctx.backups.dir,
      s3Available: ctx.backups.s3Available,
      targets,
    };
  });

  app.post(
    '/platform/backups',
    { preHandler: superadmin, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }, schema: { tags, summary: 'Crear una copia de seguridad ahora (se hace en segundo plano)' } },
    async (request, reply): Promise<BackupDTO> => {
      if (!(await hasPgDump(ctx.config))) throw badRequest('El servidor no tiene pg_dump instalado (vea DESPLIEGUE.md → Copias de seguridad)');
      let started;
      try {
        started = await ctx.backups.begin('manual', userIdOf(request));
      } catch (error) {
        throw new AppError(409, 'backup_running', error instanceof Error ? error.message : 'Ya hay una copia en curso');
      }
      void started!.done.catch((error) => request.log.error({ err: error }, 'copias: error en la copia manual'));
      return reply.code(202).send(toBackupDTO(started!.row, ctx.backups.dir));
    },
  );

  app.get(
    '/platform/backups/:id/download',
    { preHandler: superadmin, schema: { tags, summary: 'Descargar una copia de seguridad', params: idParam } },
    async (request, reply) => {
      const row = await find(request.params.id);
      const file = path.join(ctx.backups.dir, row.file);
      if (row.status !== 'ok' || !BACKUP_FILE.test(row.file) || !existsSync(file)) {
        throw new AppError(404, 'not_found', row.s3Key ? `El archivo ya no está en este servidor; descárguelo de S3 (${row.s3Key})` : 'El archivo de la copia ya no está en el servidor');
      }
      // Descargar una copia es acceder a todos los datos: queda registrado.
      const who = ctx.audit.actorOf(request);
      if (who) ctx.audit.record({ ...who, tenantId: null, action: 'platform.backup_download', entity: 'platform', entityId: row.id, summary: `Descargó la copia de seguridad ${row.file}` });
      return reply
        .header('content-type', 'application/gzip')
        .header('content-disposition', `attachment; filename="${row.file}"`)
        .header('content-length', String(row.sizeBytes))
        .header('cache-control', 'no-store')
        .send(createReadStream(file));
    },
  );

  app.delete(
    '/platform/backups/:id',
    { preHandler: superadmin, schema: { tags, summary: 'Borrar una copia de seguridad (del servidor y de S3)', params: idParam } },
    async (request, reply) => {
      const row = await find(request.params.id);
      if (row.status === 'running') throw badRequest('La copia todavía está en curso');
      await ctx.backups.remove(row);
      return reply.code(204).send();
    },
  );

  /* --------------------------- Destinos externos --------------------------- */

  app.post(
    '/platform/backups/targets',
    { preHandler: superadmin, schema: { tags, summary: 'Agregar un destino externo para las copias (S3, SFTP o WebDAV)', body: backupTargetInputSchema } },
    async (request): Promise<BackupTargetDTO> => ctx.backups.saveTarget(request.body),
  );

  app.put(
    '/platform/backups/targets/:id',
    {
      preHandler: superadmin,
      schema: { tags, summary: 'Modificar un destino (las claves vacías conservan las guardadas)', params: idParam, body: backupTargetInputSchema },
    },
    async (request): Promise<BackupTargetDTO> => ctx.backups.saveTarget(request.body, request.params.id),
  );

  app.delete(
    '/platform/backups/targets/:id',
    { preHandler: superadmin, schema: { tags, summary: 'Quitar un destino (las copias ya subidas quedan allí)', params: idParam } },
    async (request, reply) => {
      await ctx.backups.deleteTarget(request.params.id);
      return reply.code(204).send();
    },
  );

  app.post(
    '/platform/backups/targets/test',
    {
      preHandler: superadmin,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Probar un destino: escribe y borra un archivo de prueba',
        description: 'Con `id`, usa las claves guardadas que no se envíen y guarda el resultado.',
        body: z.intersection(backupTargetInputSchema, z.object({ id: z.uuid().optional() })),
      },
    },
    async (request): Promise<BackupTargetTestDTO> => {
      const { id, ...input } = request.body;
      return ctx.backups.testTarget(input as typeof request.body, id);
    },
  );

  app.post(
    '/platform/backups/:id/upload',
    { preHandler: superadmin, schema: { tags, summary: 'Volver a subir una copia a los destinos donde falló', params: idParam } },
    async (request): Promise<BackupDTO> => toBackupDTO(await ctx.backups.retryUploads(await find(request.params.id)), ctx.backups.dir),
  );
};
