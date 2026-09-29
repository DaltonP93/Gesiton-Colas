import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PLANS, UPLOAD_MIME_TYPES, detectMedia, scheduleSchema } from '@gc/shared';
import type { AppContext } from '../../context';
import { displays, media, playlistItems, playlists, tenants } from '../../db/schema';
import { tenantIdOf } from '../../lib/auth';
import { toMediaDTO } from '../../lib/dto';
import { AppError, badRequest, notFound, planLimit } from '../../lib/errors';
import { hexColor, idParam, updateSchema } from '../../lib/schemas';
import { loadPlaylist } from '../public/routes';

const EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

const textSchema = z.object({
  content: z.string().trim().min(1).max(500),
  subtitle: z.string().trim().max(300).optional(),
  background: hexColor.default('#1e3a8a'),
  color: hexColor.default('#ffffff'),
});

const mediaBody = z.object({
  /** URL de YouTube, Vimeo, TikTok, Instagram, Facebook, Twitch, Dailymotion, Google Drive/Slides, Canva, Loom, HLS, video/imagen o página web. */
  url: z.string().trim().max(2048).optional(),
  name: z.string().trim().max(200).optional(),
  text: textSchema.optional(),
  /** Duración en segundos (vacío = hasta que termine el video). */
  duration: z.number().int().min(1).max(86_400).nullable().optional(),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
});

const itemSchema = z.object({
  mediaId: z.uuid(),
  duration: z.number().int().min(1).max(86_400).nullable().default(null),
  muted: z.boolean().default(false),
  volume: z.number().min(0).max(1).nullable().default(null),
  schedule: scheduleSchema.nullable().default(null),
  active: z.boolean().default(true),
});

const playlistBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  items: z.array(itemSchema).max(500).optional(),
});

export const mediaRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Publicidad y contenido'];
  const read = ctx.auth.require({ role: 'manager', scope: 'displays:write' });
  const write = ctx.auth.require({ role: 'manager', scope: 'displays:write' });

  async function refreshPlaylistDisplays(tenantId: string, playlistIds: string[]) {
    if (playlistIds.length === 0) return;
    const rows = await ctx.db
      .select({ id: displays.id })
      .from(displays)
      .where(and(eq(displays.tenantId, tenantId), inArray(displays.playlistId, playlistIds)));
    for (const d of rows) ctx.refreshDevices(tenantId, { displayId: d.id });
  }

  async function playlistsUsingMedia(mediaId: string) {
    const rows = await ctx.db
      .selectDistinct({ id: playlistItems.playlistId })
      .from(playlistItems)
      .where(eq(playlistItems.mediaId, mediaId));
    return rows.map((r) => r.id);
  }

  /* --------------------------- Biblioteca ----------------------------- */

  app.get(
    '/media',
    { preHandler: read, schema: { tags, summary: 'Biblioteca de medios', querystring: z.object({ tag: z.string().optional() }) } },
    async (request) => {
      const rows = await ctx.db
        .select()
        .from(media)
        .where(
          and(
            eq(media.tenantId, tenantIdOf(request)),
            request.query.tag ? sql`${media.tags} @> ${JSON.stringify([request.query.tag])}::jsonb` : undefined,
          ),
        )
        .orderBy(desc(media.createdAt));
      return rows.map(toMediaDTO);
    },
  );

  app.post(
    '/media/detect',
    { preHandler: read, schema: { tags, summary: 'Detectar plataforma y datos de una URL', body: z.object({ url: z.string().max(2048) }) } },
    async (request) => {
      const detected = detectMedia(request.body.url);
      if (!detected) throw badRequest('URL inválida');
      return detected;
    },
  );

  app.post(
    '/media',
    {
      preHandler: write,
      schema: {
        tags,
        summary: 'Agregar contenido desde una URL (YouTube, Vimeo, TikTok, HLS, web...) o un anuncio de texto',
        body: mediaBody,
      },
    },
    async (request, reply) => {
      const tenantId = tenantIdOf(request);
      const body = request.body;
      let values: typeof media.$inferInsert;
      if (body.text) {
        values = {
          tenantId,
          name: body.name || body.text.content.slice(0, 60),
          kind: 'text',
          provider: 'text',
          url: '',
          text: body.text,
          duration: body.duration ?? 10,
          tags: body.tags,
        };
      } else {
        const detected = body.url ? detectMedia(body.url) : null;
        if (!detected) throw badRequest('Indique una URL válida o un texto');
        values = {
          tenantId,
          name: body.name || detected.suggestedName,
          kind: detected.kind,
          provider: detected.provider,
          url: detected.url,
          embedUrl: detected.embedUrl ?? null,
          externalId: detected.externalId ?? null,
          thumbnailUrl: detected.thumbnailUrl ?? (detected.kind === 'image' ? detected.url : null),
          duration: body.duration !== undefined ? body.duration : (detected.suggestedDuration ?? null),
          tags: body.tags,
        };
      }
      const [row] = await ctx.db.insert(media).values(values).returning();
      return reply.code(201).send(toMediaDTO(row!));
    },
  );

  app.post(
    '/media/upload',
    {
      preHandler: write,
      schema: {
        tags,
        summary: 'Subir un video o imagen (multipart/form-data: campos name, duration, tags y luego file)',
        consumes: ['multipart/form-data'],
      },
    },
    async (request, reply) => {
      const tenantId = tenantIdOf(request);
      const file = await request.file();
      if (!file) throw badRequest('Adjunte un archivo');
      const kind = UPLOAD_MIME_TYPES[file.mimetype];
      if (!kind) {
        file.file.resume();
        throw badRequest(`Tipo de archivo no permitido (${file.mimetype}). Use MP4, WebM, JPG, PNG, GIF, WebP o SVG.`);
      }
      const field = (name: string) => {
        const f = file.fields[name];
        const entry = Array.isArray(f) ? f[0] : f;
        return entry && 'value' in entry ? String(entry.value) : undefined;
      };

      const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
      const limits = PLANS[tenant!.plan];
      const key = `${tenantId}/${randomUUID()}.${EXTENSIONS[file.mimetype] ?? 'bin'}`;
      const stored = await ctx.storage.put(key, file.file, file.mimetype);

      const tooBig = file.file.truncated || stored.size > limits.maxUploadMb * 1024 * 1024;
      const overQuota = limits.storageMb !== null && tenant!.storageBytes + stored.size > limits.storageMb * 1024 * 1024;
      if (tooBig || overQuota) {
        await ctx.storage.remove(key).catch(() => undefined);
        if (tooBig) throw new AppError(413, 'file_too_large', `El archivo supera el máximo de ${Math.min(limits.maxUploadMb, ctx.config.MAX_UPLOAD_MB)} MB`);
        throw planLimit(`Se alcanzó el almacenamiento de su plan (${limits.storageMb} MB)`);
      }

      const durationField = Number(field('duration'));
      const tagsField = field('tags');
      const [row] = await ctx.db
        .insert(media)
        .values({
          tenantId,
          name: (field('name') || file.filename || 'Archivo').slice(0, 200),
          kind,
          provider: 'upload',
          url: stored.url,
          storageKey: key,
          mimeType: file.mimetype,
          sizeBytes: stored.size,
          duration: Number.isFinite(durationField) && durationField > 0 ? Math.round(durationField) : kind === 'image' ? 10 : null,
          thumbnailUrl: kind === 'image' ? stored.url : null,
          tags: tagsField ? tagsField.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20) : [],
        })
        .returning();
      await ctx.db
        .update(tenants)
        .set({ storageBytes: sql`${tenants.storageBytes} + ${stored.size}` })
        .where(eq(tenants.id, tenantId));
      return reply.code(201).send(toMediaDTO(row!));
    },
  );

  app.put(
    '/media/:id',
    {
      preHandler: write,
      schema: { tags, params: idParam, body: updateSchema(mediaBody.omit({ url: true })) },
    },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const { text, ...rest } = request.body;
      const [row] = await ctx.db
        .update(media)
        .set({ ...rest, ...(text ? { text } : {}) })
        .where(and(eq(media.id, request.params.id), eq(media.tenantId, tenantId)))
        .returning();
      if (!row) throw notFound('Contenido');
      await refreshPlaylistDisplays(tenantId, await playlistsUsingMedia(row.id));
      return toMediaDTO(row);
    },
  );

  app.delete('/media/:id', { preHandler: write, schema: { tags, params: idParam } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    const [row] = await ctx.db
      .select()
      .from(media)
      .where(and(eq(media.id, request.params.id), eq(media.tenantId, tenantId)));
    if (!row) throw notFound('Contenido');
    const affected = await playlistsUsingMedia(row.id);
    await ctx.db.delete(media).where(eq(media.id, row.id));
    if (row.storageKey) {
      await ctx.storage.remove(row.storageKey).catch((error) => ctx.log.warn({ err: error }, 'No se pudo borrar el archivo'));
      await ctx.db
        .update(tenants)
        .set({ storageBytes: sql`greatest(0, ${tenants.storageBytes} - ${row.sizeBytes})` })
        .where(eq(tenants.id, tenantId));
    }
    await refreshPlaylistDisplays(tenantId, affected);
    return reply.code(204).send();
  });

  /* --------------------------- Listas -------------------------------- */
  const ptags = ['Publicidad y contenido'];

  async function replaceItems(tenantId: string, playlistId: string, items: z.infer<typeof itemSchema>[]) {
    const ids = [...new Set(items.map((i) => i.mediaId))];
    if (ids.length) {
      const valid = await ctx.db
        .select({ id: media.id })
        .from(media)
        .where(and(eq(media.tenantId, tenantId), inArray(media.id, ids)));
      if (valid.length !== ids.length) throw badRequest('La lista contiene contenido inválido');
    }
    await ctx.db.transaction(async (tx) => {
      await tx.delete(playlistItems).where(eq(playlistItems.playlistId, playlistId));
      if (items.length) {
        await tx.insert(playlistItems).values(items.map((item, position) => ({ ...item, playlistId, position })));
      }
    });
  }

  app.get('/playlists', { preHandler: read, schema: { tags: ptags } }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(playlists)
      .where(eq(playlists.tenantId, tenantIdOf(request)))
      .orderBy(asc(playlists.name));
    return Promise.all(rows.map((p) => loadPlaylist(ctx.db, p.id)));
  });

  app.get('/playlists/:id', { preHandler: read, schema: { tags: ptags, params: idParam } }, async (request) => {
    const [row] = await ctx.db
      .select({ id: playlists.id })
      .from(playlists)
      .where(and(eq(playlists.id, request.params.id), eq(playlists.tenantId, tenantIdOf(request))));
    if (!row) throw notFound('Lista de reproducción');
    return loadPlaylist(ctx.db, row.id);
  });

  app.post('/playlists', { preHandler: write, schema: { tags: ptags, body: playlistBody } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    const { items, ...data } = request.body;
    const [row] = await ctx.db
      .insert(playlists)
      .values({ ...data, tenantId })
      .returning();
    if (items) await replaceItems(tenantId, row!.id, items);
    return reply.code(201).send(await loadPlaylist(ctx.db, row!.id));
  });

  app.put(
    '/playlists/:id',
    { preHandler: write, schema: { tags: ptags, summary: 'Actualizar lista (los ítems enviados reemplazan a los actuales)', params: idParam, body: updateSchema(playlistBody) } },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const { items, ...data } = request.body;
      const [row] = await ctx.db
        .update(playlists)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(playlists.id, request.params.id), eq(playlists.tenantId, tenantId)))
        .returning();
      if (!row) throw notFound('Lista de reproducción');
      if (items) await replaceItems(tenantId, row.id, items);
      await refreshPlaylistDisplays(tenantId, [row.id]);
      return loadPlaylist(ctx.db, row.id);
    },
  );

  app.delete('/playlists/:id', { preHandler: write, schema: { tags: ptags, params: idParam } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    const affected = await ctx.db
      .select({ id: displays.id })
      .from(displays)
      .where(and(eq(displays.tenantId, tenantId), eq(displays.playlistId, request.params.id)));
    const deleted = await ctx.db
      .delete(playlists)
      .where(and(eq(playlists.id, request.params.id), eq(playlists.tenantId, tenantId)))
      .returning({ id: playlists.id });
    if (deleted.length === 0) throw notFound('Lista de reproducción');
    for (const d of affected) ctx.refreshDevices(tenantId, { displayId: d.id });
    return reply.code(204).send();
  });
};
