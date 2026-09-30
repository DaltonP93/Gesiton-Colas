import { randomInt } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PairingDTO, PairingStatusDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { devicePairings, displays, kiosks } from '../../db/schema';
import { assertModuleActive, tenantIdOf } from '../../lib/auth';
import { randomToken, safeEqual, sha256 } from '../../lib/crypto';
import { badRequest, notFound } from '../../lib/errors';

const PAIRING_TTL_MS = 15 * 60_000;

/**
 * Vinculación de dispositivos: la TV o tablet abre /vincular y muestra un código de 6 dígitos;
 * desde el portal se ingresa el código y se elige qué pantalla o kiosco será ese equipo.
 */
export const pairingRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Vinculación de dispositivos'];

  app.post(
    '/public/pairings',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags, summary: 'El dispositivo solicita un código de vinculación', security: [] },
    },
    async (request, reply): Promise<PairingDTO> => {
      const now = new Date();
      let code = '';
      for (let i = 0; i < 10; i++) {
        const candidate = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const [taken] = await ctx.db
          .select({ id: devicePairings.id })
          .from(devicePairings)
          .where(and(eq(devicePairings.code, candidate), gt(devicePairings.expiresAt, now), isNull(devicePairings.claimedAt)))
          .limit(1);
        if (!taken) {
          code = candidate;
          break;
        }
      }
      if (!code) throw badRequest('No se pudo generar un código. Intente nuevamente.');
      const secret = randomToken(32);
      const [row] = await ctx.db
        .insert(devicePairings)
        .values({
          code,
          secretHash: sha256(secret),
          userAgent: String(request.headers['user-agent'] ?? '').slice(0, 300),
          expiresAt: new Date(now.getTime() + PAIRING_TTL_MS),
        })
        .returning();
      reply.code(201);
      return { id: row!.id, code, secret, expiresAt: row!.expiresAt.toISOString() };
    },
  );

  app.get(
    '/public/pairings/:id',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'El dispositivo consulta si ya fue vinculado',
        security: [],
        params: z.object({ id: z.uuid() }),
        querystring: z.object({ secret: z.string().min(10).max(100) }),
      },
    },
    async (request): Promise<PairingStatusDTO> => {
      const [row] = await ctx.db.select().from(devicePairings).where(eq(devicePairings.id, request.params.id)).limit(1);
      if (!row || !safeEqual(row.secretHash, sha256(request.query.secret))) throw notFound('Vinculación');
      if (!row.claimedAt || !row.targetId || !row.targetType) {
        return { status: row.expiresAt.getTime() < Date.now() ? 'expired' : 'pending' };
      }
      const table = row.targetType === 'display' ? displays : kiosks;
      const [target] = await ctx.db
        .select({ token: table.token, name: table.name })
        .from(table)
        .where(eq(table.id, row.targetId))
        .limit(1);
      if (!target) return { status: 'expired' };
      return { status: 'claimed', target: { type: row.targetType, token: target.token, name: target.name } };
    },
  );

  app.post(
    '/pairings/claim',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: ctx.auth.require({ role: 'manager', scope: 'displays:write' }),
      schema: {
        tags,
        summary: 'Vincular el dispositivo que muestra el código a una pantalla o kiosco',
        body: z.object({
          code: z.string().regex(/^\d{6}$/, 'El código tiene 6 dígitos'),
          type: z.enum(['display', 'kiosk']),
          targetId: z.uuid(),
        }),
      },
    },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const { code, type, targetId } = request.body;
      if (request.auth?.tenant) await assertModuleActive(ctx.modulesOf, request.auth.tenant, type === 'display' ? 'displays' : 'kiosks');
      const table = type === 'display' ? displays : kiosks;
      const [target] = await ctx.db
        .select({ id: table.id, name: table.name })
        .from(table)
        .where(and(eq(table.id, targetId), eq(table.tenantId, tenantId)))
        .limit(1);
      if (!target) throw notFound(type === 'display' ? 'Pantalla' : 'Kiosco');
      const [claimed] = await ctx.db
        .update(devicePairings)
        .set({ tenantId, targetType: type, targetId, claimedAt: new Date() })
        .where(and(eq(devicePairings.code, code), gt(devicePairings.expiresAt, new Date()), isNull(devicePairings.claimedAt)))
        .returning({ id: devicePairings.id });
      if (!claimed) throw badRequest('El código no es válido o venció. Verifique el número que muestra el dispositivo.');
      return { ok: true, name: target.name };
    },
  );
};
