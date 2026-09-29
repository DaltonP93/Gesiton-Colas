import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { deepMerge, displayConfigSchema, kioskConfigSchema, normalizeConfig } from '@gc/shared';
import type { AppContext } from '../../context';
import { branches, displays, kiosks, playlists } from '../../db/schema';
import { tenantIdOf } from '../../lib/auth';
import { randomToken } from '../../lib/crypto';
import { toDisplayDTO, toKioskDTO } from '../../lib/dto';
import { badRequest, notFound } from '../../lib/errors';
import { assertWithinLimit } from '../../lib/plans';
import { idParam } from '../../lib/schemas';

const configPatch = z.record(z.string(), z.unknown());

export const deviceRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const read = ctx.auth.require({ role: 'manager', scope: 'catalog:read' });
  const write = ctx.auth.require({ role: 'admin', scope: 'displays:write' });

  async function assertBranch(tenantId: string, branchId: string) {
    const [b] = await ctx.db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)));
    if (!b) throw notFound('Sucursal');
  }

  async function assertPlaylist(tenantId: string, playlistId: string | null | undefined) {
    if (!playlistId) return;
    const [p] = await ctx.db
      .select({ id: playlists.id })
      .from(playlists)
      .where(and(eq(playlists.id, playlistId), eq(playlists.tenantId, tenantId)));
    if (!p) throw notFound('Lista de reproducción');
  }

  function mergeDisplayConfig(current: unknown, patch?: Record<string, unknown>) {
    if (!patch) return normalizeConfig(displayConfigSchema, current);
    const parsed = displayConfigSchema.safeParse(deepMerge(normalizeConfig(displayConfigSchema, current), patch));
    if (!parsed.success) throw badRequest('Configuración inválida', parsed.error.issues);
    return parsed.data;
  }

  function mergeKioskConfig(current: unknown, patch?: Record<string, unknown>) {
    if (!patch) return normalizeConfig(kioskConfigSchema, current);
    const parsed = kioskConfigSchema.safeParse(deepMerge(normalizeConfig(kioskConfigSchema, current), patch));
    if (!parsed.success) throw badRequest('Configuración inválida', parsed.error.issues);
    return parsed.data;
  }

  /* ----------------------------- Pantallas ---------------------------- */
  const dtags = ['Pantallas'];
  const displayBody = z.object({
    branchId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    playlistId: z.uuid().nullable().optional(),
    config: configPatch.optional(),
  });

  app.get('/displays', { preHandler: read, schema: { tags: dtags } }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(displays)
      .where(eq(displays.tenantId, tenantIdOf(request)))
      .orderBy(asc(displays.name));
    return rows.map(toDisplayDTO);
  });

  app.get('/displays/:id', { preHandler: read, schema: { tags: dtags, params: idParam } }, async (request) => {
    const [row] = await ctx.db
      .select()
      .from(displays)
      .where(and(eq(displays.id, request.params.id), eq(displays.tenantId, tenantIdOf(request))));
    if (!row) throw notFound('Pantalla');
    return toDisplayDTO(row);
  });

  app.post('/displays', { preHandler: write, schema: { tags: dtags, body: displayBody } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    await assertBranch(tenantId, request.body.branchId);
    await assertPlaylist(tenantId, request.body.playlistId);
    await assertWithinLimit(ctx.db, tenantId, 'displays');
    const [row] = await ctx.db
      .insert(displays)
      .values({
        tenantId,
        branchId: request.body.branchId,
        name: request.body.name,
        playlistId: request.body.playlistId ?? null,
        token: randomToken(24),
        config: mergeDisplayConfig({}, request.body.config),
      })
      .returning();
    return reply.code(201).send(toDisplayDTO(row!));
  });

  app.put(
    '/displays/:id',
    { preHandler: write, schema: { tags: dtags, params: idParam, body: displayBody.partial() } },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const [current] = await ctx.db
        .select()
        .from(displays)
        .where(and(eq(displays.id, request.params.id), eq(displays.tenantId, tenantId)));
      if (!current) throw notFound('Pantalla');
      if (request.body.branchId) await assertBranch(tenantId, request.body.branchId);
      await assertPlaylist(tenantId, request.body.playlistId);
      const [row] = await ctx.db
        .update(displays)
        .set({
          ...(request.body.branchId ? { branchId: request.body.branchId } : {}),
          ...(request.body.name ? { name: request.body.name } : {}),
          ...(request.body.playlistId !== undefined ? { playlistId: request.body.playlistId } : {}),
          config: mergeDisplayConfig(current.config, request.body.config),
        })
        .where(eq(displays.id, current.id))
        .returning();
      ctx.refreshDevices(tenantId, { displayId: current.id });
      return toDisplayDTO(row!);
    },
  );

  app.post(
    '/displays/:id/rotate-token',
    { preHandler: write, schema: { tags: dtags, params: idParam, summary: 'Generar un nuevo enlace (invalida el anterior)' } },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const [row] = await ctx.db
        .update(displays)
        .set({ token: randomToken(24) })
        .where(and(eq(displays.id, request.params.id), eq(displays.tenantId, tenantId)))
        .returning();
      if (!row) throw notFound('Pantalla');
      ctx.refreshDevices(tenantId, { displayId: row.id });
      return toDisplayDTO(row);
    },
  );

  app.delete('/displays/:id', { preHandler: write, schema: { tags: dtags, params: idParam } }, async (request, reply) => {
    const deleted = await ctx.db
      .delete(displays)
      .where(and(eq(displays.id, request.params.id), eq(displays.tenantId, tenantIdOf(request))))
      .returning({ id: displays.id });
    if (deleted.length === 0) throw notFound('Pantalla');
    ctx.refreshDevices(tenantIdOf(request), { displayId: request.params.id });
    return reply.code(204).send();
  });

  /* ------------------------------ Kioscos ----------------------------- */
  const ktags = ['Kioscos'];
  const kioskBody = z.object({
    branchId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    config: configPatch.optional(),
  });

  app.get('/kiosks', { preHandler: read, schema: { tags: ktags } }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(kiosks)
      .where(eq(kiosks.tenantId, tenantIdOf(request)))
      .orderBy(asc(kiosks.name));
    return rows.map(toKioskDTO);
  });

  app.get('/kiosks/:id', { preHandler: read, schema: { tags: ktags, params: idParam } }, async (request) => {
    const [row] = await ctx.db
      .select()
      .from(kiosks)
      .where(and(eq(kiosks.id, request.params.id), eq(kiosks.tenantId, tenantIdOf(request))));
    if (!row) throw notFound('Kiosco');
    return toKioskDTO(row);
  });

  app.post('/kiosks', { preHandler: write, schema: { tags: ktags, body: kioskBody } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    await assertBranch(tenantId, request.body.branchId);
    await assertWithinLimit(ctx.db, tenantId, 'kiosks');
    const [row] = await ctx.db
      .insert(kiosks)
      .values({
        tenantId,
        branchId: request.body.branchId,
        name: request.body.name,
        token: randomToken(24),
        config: mergeKioskConfig({}, request.body.config),
      })
      .returning();
    return reply.code(201).send(toKioskDTO(row!));
  });

  app.put('/kiosks/:id', { preHandler: write, schema: { tags: ktags, params: idParam, body: kioskBody.partial() } }, async (request) => {
    const tenantId = tenantIdOf(request);
    const [current] = await ctx.db
      .select()
      .from(kiosks)
      .where(and(eq(kiosks.id, request.params.id), eq(kiosks.tenantId, tenantId)));
    if (!current) throw notFound('Kiosco');
    if (request.body.branchId) await assertBranch(tenantId, request.body.branchId);
    const [row] = await ctx.db
      .update(kiosks)
      .set({
        ...(request.body.branchId ? { branchId: request.body.branchId } : {}),
        ...(request.body.name ? { name: request.body.name } : {}),
        config: mergeKioskConfig(current.config, request.body.config),
      })
      .where(eq(kiosks.id, current.id))
      .returning();
    ctx.refreshDevices(tenantId, { kioskId: current.id });
    return toKioskDTO(row!);
  });

  app.post('/kiosks/:id/rotate-token', { preHandler: write, schema: { tags: ktags, params: idParam } }, async (request) => {
    const tenantId = tenantIdOf(request);
    const [row] = await ctx.db
      .update(kiosks)
      .set({ token: randomToken(24) })
      .where(and(eq(kiosks.id, request.params.id), eq(kiosks.tenantId, tenantId)))
      .returning();
    if (!row) throw notFound('Kiosco');
    ctx.refreshDevices(tenantId, { kioskId: row.id });
    return toKioskDTO(row);
  });

  app.delete('/kiosks/:id', { preHandler: write, schema: { tags: ktags, params: idParam } }, async (request, reply) => {
    const deleted = await ctx.db
      .delete(kiosks)
      .where(and(eq(kiosks.id, request.params.id), eq(kiosks.tenantId, tenantIdOf(request))))
      .returning({ id: kiosks.id });
    if (deleted.length === 0) throw notFound('Kiosco');
    ctx.refreshDevices(tenantIdOf(request), { kioskId: request.params.id });
    return reply.code(204).send();
  });
};
